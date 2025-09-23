import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query'
import { ndk, withTimeout, type LoggedInUser } from '@/lib/ndk'
import { type NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { nip19 } from 'nostr-tools'

export const Route = createFileRoute('/')({
  component: Home,
})

type FeedMode = 'global' | 'user' | 'follows' | 'profile'

// Event kinds to include in feeds (global and user)
const FEED_KINDS: number[] = [1, 1111, 6, 30023, 9802, 1068, 1222, 1244, 20, 21, 22]

type MediaType = 'image' | 'video'
type MediaItem = { url: string; type: MediaType }
// Gallery of media within a single note
type MediaGallery = { items: MediaItem[]; index: number }

const URL_REGEX = /(https?:\/\/[^\s]+)/g
const NOSTR_REF_REGEX = /(nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+|nevent1[0-9a-z]+))/gi
const MEDIA_EXT_REGEX = /\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|webm|mov|m4v|avi|mkv)(?:\?.*)?$/i
function classifyMedia(url: string): MediaItem | null {
  if (!MEDIA_EXT_REGEX.test(url)) return null
  const isVideo = /\.(mp4|webm|mov|m4v|avi|mkv)(?:\?.*)?$/i.test(url)
  return { url, type: isVideo ? 'video' : 'image' }
}

function renderContent(text: string, openMedia: (g: MediaGallery) => void, openProfile?: (bech: string) => void) {
  if (!text) return null
  // Pre-extract all media items in the content to build a gallery for navigation
  const urls = (text.match(URL_REGEX) || []) as string[]
  const medias: MediaItem[] = urls
    .map(u => classifyMedia(u))
    .filter((m): m is MediaItem => !!m)

  const parts = text.split(URL_REGEX)
  return parts.flatMap((part, idx) => {
    if (!part) return null
    if (/^https?:\/\//i.test(part)) {
      const media = classifyMedia(part)
      if (media) {
        const index = medias.findIndex(m => m.url === media.url)
        return (
          <a
            key={idx}
            href={part}
            onClick={(e) => { e.preventDefault(); openMedia({ items: medias, index: Math.max(0, index) }) }}
            className="underline text-[#9ecfff] hover:text-white"
          >
            {part}
          </a>
        )
      }
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-[#9ecfff] hover:text-white"
        >
          {part}
        </a>
      )
    }
    // Process nostr: profile references and nevent references inside plain text segments
    const subparts = part.split(NOSTR_REF_REGEX)
    if (subparts.length === 1) return <span key={idx}>{part}</span>
    const nodes: any[] = []
    for (let i = 0; i < subparts.length; i++) {
      const seg = subparts[i]
      if (!seg) continue
      const m = seg.match(/^nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+|nevent1[0-9a-z]+)/i)
      if (m) {
        const bech = m[1]
        if (/^(npub1|nprofile1)/i.test(bech) && openProfile) {
          nodes.push(
            <InlineProfile key={`${idx}-prof-${i}`} bech={bech} onOpen={(b) => openProfile(b)} />
          )
          // Skip the next captured subgroup to avoid rendering raw text
          i += 1
          continue
        } else if (/^nevent1/i.test(bech)) {
          nodes.push(
            <div key={`${idx}-nevent-${i}`} className="mt-3">
              <InlineNeventNote bech={bech} openMedia={openMedia} openProfile={openProfile} />
            </div>
          )
          // Skip the next captured subgroup to avoid rendering raw text
          i += 1
          continue
        }
      }
      nodes.push(<span key={`${idx}-t-${i}`}>{seg}</span>)
    }
    return nodes
  })
}

// Inline component to render a referenced nevent as its own note row
function InlineNeventNote({ bech, openMedia, openProfile }: { bech: string; openMedia: (g: MediaGallery) => void; openProfile?: (bech: string) => void }) {
  const decoded = useMemo(() => {
    try {
      const val = nip19.decode(bech.startsWith('nostr:') ? bech.slice(6) : bech)
      if (val.type === 'nevent' && (val.data as any)?.id) return (val.data as any).id as string
    } catch {}
    return null as string | null
  }, [bech])

  const evQuery = useQuery<NDKEvent | null>({
    queryKey: ['nevent-inline', decoded ?? 'invalid'],
    enabled: !!decoded,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      if (!decoded) return null
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [decoded] } as any), 7000, 'fetch nevent')
        const list = Array.from(set)
        return list[0] || null
      } catch {
        return null
      }
    },
  })

  return (
    <div className="border border-black rounded bg-[#10181b]">
      <div className="p-3">
        {!decoded ? (
          <div className="text-sm opacity-70">Invalid note reference.</div>
        ) : evQuery.isLoading ? (
          <div className="text-sm opacity-70">Loading referenced note…</div>
        ) : !evQuery.data ? (
          <div className="text-sm opacity-70">Referenced note not found.</div>
        ) : (
          <div>
            <header className="mb-2 flex items-center gap-2 text-sm text-[#cccccc]">
              <AuthorLabel pubkey={evQuery.data.pubkey || ''} />
              <span className="opacity-50">·</span>
              <time className="opacity-70">{formatTime(evQuery.data.created_at)}</time>
            </header>
            {evQuery.data.kind === 6 ? (
              <RepostNote ev={evQuery.data} openMedia={openMedia} openProfile={openProfile} openProfileByPubkey={undefined as any} />
            ) : (
              <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                {renderContent(evQuery.data.content, openMedia, openProfile)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Home() {
  // Thread modal state (narrow) and side panel state (wide)
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const [threadOpenSeed, setThreadOpenSeed] = useState<string | null>(null) // store clicked event id for context
  const [sideThreadRootId, setSideThreadRootId] = useState<string | null>(null)
  const [mediaToShow, setMediaToShow] = useState<MediaGallery | null>(null)
  const [profilePubkey, setProfilePubkey] = useState<string | null>(null)
  type OpenedProfile = { pubkey: string; npub: string; name?: string; picture?: string; about?: string }
  const [openedProfiles, setOpenedProfiles] = useState<OpenedProfile[]>([])
  const [prevView, setPrevView] = useState<{ mode: FeedMode; profilePubkey: string | null } | null>(null)
  // Infinite feed query using NDK. When a signer is present, NDK auto-connects
  // to user relays; otherwise it uses default relays configured in ndk.ts.
  const PAGE_SIZE = 4

  // Feed mode and user info (from localStorage saved by Root)
  const [mode, setMode] = useState<FeedMode>('global')
  const [user, setUser] = useState<LoggedInUser | null>(null)
  const [isWide, setIsWide] = useState<boolean>(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nostrUser')
      if (saved) setUser(JSON.parse(saved))
    } catch {}
  }, [])
  // Track wide-mode (>= xl breakpoint ~1280px)
  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 1280)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // When entering wide mode with an open modal thread, move it to the side panel; when leaving wide, close side panel
  useEffect(() => {
    if (isWide && threadRootId) {
      setSideThreadRootId(threadRootId)
      setThreadRootId(null)
    }
    if (!isWide && sideThreadRootId) {
      setSideThreadRootId(null)
    }
  }, [isWide])

  // Hydrate previously opened profiles from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('openedProfiles')
      if (saved) setOpenedProfiles(JSON.parse(saved))
    } catch {}
  }, [])

  // Ensure unavailable tabs are not active when logged out; also prune self profile tab on login
  useEffect(() => {
    if (!user && (mode === 'user' || mode === 'follows')) {
      setMode('global')
    }
    // Remove self from openedProfiles if present when user changes
    if (user?.pubkey) {
      setOpenedProfiles(prev => prev.filter(p => p.pubkey !== user.pubkey))
    }
  }, [user])

  // Persist opened profiles
  useEffect(() => {
    try { localStorage.setItem('openedProfiles', JSON.stringify(openedProfiles)) } catch {}
  }, [openedProfiles])

  // Action handlers (stubs/minimal)
  const onReply = (ev: NDKEvent) => {
    try { console.log('Reply to', ev.id) } catch {}
    // Also open thread view for the note
    openThreadFor(ev)
  }
  const onRepost = (ev: NDKEvent) => {
    try { console.log('Repost', ev.id) } catch {}
    // Also open thread view for the note
    openThreadFor(ev)
  }
  const onQuote = (ev: NDKEvent) => {
    try {
      const bech = (() => { try { return nip19.neventEncode({ id: ev.id! }) } catch { return '' } })()
      navigator.clipboard?.writeText(`nostr:${bech}`).catch(() => {})
      console.log('Quote copied to clipboard', bech)
    } catch {}
    // Also open thread view for the note
    openThreadFor(ev)
  }

  const getThreadRootId = (ev: NDKEvent): string => {
    const eTags = (ev.tags || []).filter(t => t[0] === 'e')
    const root = eTags.find(t => (t[3] === 'root'))?.[1] as string | undefined
    const reply = eTags.find(t => (t[3] === 'reply'))?.[1] as string | undefined
    const any = eTags[0]?.[1] as string | undefined
    return (root || reply || any || ev.id || '')
  }
  const openThreadFor = (ev: NDKEvent) => {
    const root = getThreadRootId(ev)
    if (!root) return
    if (isWide) {
      setSideThreadRootId(root)
      setThreadRootId(null)
      // Ensure only one view at a time in wide mode
      setMediaToShow(null)
    } else {
      setThreadRootId(root)
    }
    setThreadOpenSeed(ev.id || null)
  }

  // Open a profile from a nostr bech32 identifier (npub or nprofile) and switch to profile mode
  const openProfileByBech = (bech: string) => {
    try {
      let u: any
      if (/^npub1[0-9a-z]+$/i.test(bech)) {
        u = ndk.getUser({ npub: bech } as any)
      } else if (/^nprofile1[0-9a-z]+$/i.test(bech)) {
        u = ndk.getUser({ nprofile: bech } as any)
      } else {
        return
      }
      const pub = (u as any).pubkey as string
      if (!pub) return
      const npubVal = (u as any).npub || (bech.startsWith('npub1') ? bech : '')
      // If opening own profile, switch to Me view (profile mode with own pubkey) and do not add a sidebar tab
      if (user?.pubkey && pub === user.pubkey) {
        if (!(mode === 'profile' && profilePubkey === pub)) {
          setPrevView({ mode, profilePubkey })
        }
        setProfilePubkey(pub)
        setMode('profile')
        // Remove any existing self tab from openedProfiles
        setOpenedProfiles(prev => prev.filter(p => p.pubkey !== pub))
        return
      }
      if (!(mode === 'profile' && profilePubkey === pub)) {
        setPrevView({ mode, profilePubkey })
      }
      setProfilePubkey(pub)
      setMode('profile')
      setOpenedProfiles(prev => {
        const exists = prev.find(p => p.pubkey === pub)
        if (exists) return prev
        return [{ pubkey: pub, npub: npubVal, name: undefined, picture: undefined, about: undefined }, ...prev].slice(0, 12)
      })
    } catch {
      // ignore
    }
  }

  // Open a profile directly from a hex pubkey
  const openProfileByPubkey = (pub: string) => {
    if (!pub) return
    try {
      const u: any = ndk.getUser({ pubkey: pub } as any)
      const npubVal: string = (u as any).npub || ''
      // If opening own profile, switch to Me view and avoid adding a tab
      if (user?.pubkey && pub === user.pubkey) {
        if (!(mode === 'profile' && profilePubkey === pub)) {
          setPrevView({ mode, profilePubkey })
        }
        setProfilePubkey(pub)
        setMode('profile')
        setOpenedProfiles(prev => prev.filter(p => p.pubkey !== pub))
        return
      }
      if (!(mode === 'profile' && profilePubkey === pub)) {
        setPrevView({ mode, profilePubkey })
      }
      setProfilePubkey(pub)
      setMode('profile')
      setOpenedProfiles(prev => {
        const exists = prev.find(p => p.pubkey === pub)
        if (exists) return prev
        return [{ pubkey: pub, npub: npubVal, name: undefined, picture: undefined, about: undefined }, ...prev].slice(0, 12)
      })
    } catch {
      // ignore
    }
  }

  // Listen for login/logout events from Root and update feed immediately
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<LoggedInUser | null>
      const nextUser = (ce as any).detail as (LoggedInUser | null)
      setUser(nextUser)
      if (nextUser) {
        // On login, default to Follows feed
        setMode('follows')
      } else {
        // On logout, switch back to Global
        setMode('global')
      }
    }
    window.addEventListener('nostr-user-changed', handler as any)
    return () => window.removeEventListener('nostr-user-changed', handler as any)
  }, [])

  // Listen for header 'open me' action
  useEffect(() => {
    const openMe = () => {
      if (!user?.pubkey) return
      if (!(mode === 'profile' && profilePubkey === user.pubkey)) {
        setPrevView({ mode, profilePubkey })
      }
      setProfilePubkey(user.pubkey)
      setMode('profile')
    }
    window.addEventListener('nostr-open-me', openMe as any)
    return () => window.removeEventListener('nostr-open-me', openMe as any)
  }, [user?.pubkey, mode, profilePubkey])

  // Fetch follows (kind 3) list when user is present
  const followsQuery = useQuery({
    queryKey: ['contacts', user?.pubkey ?? 'anon'],
    enabled: !!user?.pubkey,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      if (!user?.pubkey) return [] as string[]
      try {
        const filter: NDKFilter = { kinds: [3], authors: [user.pubkey], limit: 1 }
        const set = await withTimeout(ndk.fetchEvents(filter), 7000, 'fetch follows')
        const latest = Array.from(set).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]
        if (!latest) return [] as string[]
        const pubs = latest.tags
          .filter(t => t[0] === 'p' && typeof t[1] === 'string')
          .map(t => t[1] as string)
        return Array.from(new Set(pubs))
      } catch {
        return [] as string[]
      }
    },
  })

  // Utility to chunk an array
  function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }

  // Profile metadata for profile mode (avatar, name, about, banner)
  const profileMeta = useQuery<{ name: string; picture?: string; about?: string; banner?: string }>({
    queryKey: ['profile-meta', profilePubkey ?? 'none'],
    enabled: mode === 'profile' && !!profilePubkey,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const pub = profilePubkey as string
      const u = ndk.getUser({ pubkey: pub } as any)
      try { await withTimeout(u.fetchProfile(), 5000, 'profile fetch') } catch {}
      const prof: any = (u as any).profile || {}
      const name: string = prof.displayName || prof.display_name || prof.name || prof.nip05 || ''
      const picture: string | undefined = prof.picture || undefined
      const about: string | undefined = prof.about || ''
      const banner: string | undefined = prof.banner || prof.image || undefined
      return { name, picture, about, banner }
    },
  })

  // Detect banner brightness to choose text color
  const [bannerIsLight, setBannerIsLight] = useState<boolean | null>(null)
  useEffect(() => {
    const url = profileMeta.data?.banner
    setBannerIsLight(null)
    if (!url) return
    let cancelled = false
    try {
      const img = new Image()
      ;(img as any).crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const w = 16, h = 16
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) { if (!cancelled) setBannerIsLight(false); return }
          ctx.drawImage(img, 0, 0, w, h)
          const data = ctx.getImageData(0, 0, w, h).data
          let r = 0, g = 0, b = 0, count = 0
          for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; count++ }
          r /= count; g /= count; b /= count
          const L = 0.2126*(r/255) + 0.7152*(g/255) + 0.0722*(b/255)
          if (!cancelled) setBannerIsLight(L > 0.6)
        } catch {
          if (!cancelled) setBannerIsLight(false)
        }
      }
      img.onerror = () => { if (!cancelled) setBannerIsLight(false) }
      img.src = url
    } catch {
      setBannerIsLight(false)
    }
    return () => { cancelled = true }
  }, [profileMeta.data?.banner])

  // When metadata loads, update openedProfiles entry
  useEffect(() => {
    if (mode !== 'profile' || !profilePubkey) return
    const meta = profileMeta.data
    if (!meta) return
    setOpenedProfiles(prev => prev.map(p => p.pubkey === profilePubkey ? { ...p, name: p.name || meta.name, picture: p.picture || meta.picture, about: p.about || meta.about } : p))
  }, [profileMeta.data, profilePubkey, mode])

  // Broadcast active view label to header
  useEffect(() => {
    let label = ''
    if (mode === 'global') label = 'Global'
    else if (mode === 'follows') label = 'Follows'
    else if (mode === 'user') label = 'Me'
    else if (mode === 'profile') {
      if (profilePubkey && user?.pubkey && profilePubkey === user.pubkey) label = 'Me'
      else label = (profileMeta.data?.name || (profilePubkey ? shorten(profilePubkey) : 'Profile'))
    }
    try { window.dispatchEvent(new CustomEvent('nostr-active-view', { detail: { label } })) } catch {}
  }, [mode, user?.pubkey, profilePubkey, profileMeta.data?.name])

  const feedQuery = useInfiniteQuery({
    queryKey:
      mode === 'global'
        ? ['global-feed']
        : mode === 'user'
        ? ['user-feed', user?.pubkey ?? 'anon']
        : mode === 'profile'
        ? ['profile-feed', profilePubkey ?? 'none']
        : ['follows-feed', user?.pubkey ?? 'anon', (followsQuery.data || []).length],
    initialPageParam: null as number | null, // until cursor (unix seconds)
    queryFn: async ({ pageParam }) => {
      // Global, user and profile modes use a single filter
      if (mode === 'global' || mode === 'user' || mode === 'profile') {
        const filter: NDKFilter = {
          kinds: FEED_KINDS,
          limit: PAGE_SIZE,
        }
        if (mode === 'user' && user?.pubkey) {
          ;(filter as any).authors = [user.pubkey]
        }
        if (mode === 'profile' && profilePubkey) {
          ;(filter as any).authors = [profilePubkey]
        }
        if (pageParam) {
          ;(filter as any).until = pageParam
        }
        const events = await withTimeout(ndk.fetchEvents(filter), 8000, 'fetch older events')
        const list = Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        return list
      }

      // Follows mode: batch authors into groups of 20 per filter
      const follows = (followsQuery.data || []) as string[]
      if (!user?.pubkey) return []
      if (!follows.length) return []

      const filters: NDKFilter[] = chunk(follows, 20).map(group => {
        const f: NDKFilter = { kinds: FEED_KINDS, authors: group as any, limit: PAGE_SIZE }
        if (pageParam) (f as any).until = pageParam
        return f
      })
      const eventsSet = await withTimeout(ndk.fetchEvents(filters as any), 10000, 'fetch follows older events')
      const merged = Array.from(eventsSet).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      return merged.slice(0, PAGE_SIZE)
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.length === 0) return null
      const oldest = lastPage[lastPage.length - 1]
      const ts = (oldest.created_at || 0) - 1
      return ts > 0 ? ts : null
    },
    refetchOnWindowFocus: false,
    enabled: mode === 'global' || (mode === 'profile' ? !!profilePubkey : !!user?.pubkey),
  })

  // IntersectionObservers to trigger loading more (bottom) and fetching newer (top)
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const queryClient = useQueryClient()
  const [isFetchingNewer, setIsFetchingNewer] = useState(false)
  const lastTopFetchRef = useRef<number>(0)

  // Pull-to-refresh state (top)
  const [pullDistance, setPullDistance] = useState(0)
  const startYRef = useRef<number | null>(null)
  const isPullingRef = useRef(false)
  const PULL_THRESHOLD = 80
  const PULL_MAX = 140

  // Pull-to-load state (bottom)
  const [bottomPullDistance, setBottomPullDistance] = useState(0)
  const bottomStartYRef = useRef<number | null>(null)
  const isBottomPullingRef = useRef(false)
  const BOTTOM_PULL_THRESHOLD = 80
  const BOTTOM_PULL_MAX = 140

  // Back-to-top visibility
  const [showBackToTop, setShowBackToTop] = useState(false)

  // Bottom IO: older pages
  useEffect(() => {
    const el = bottomSentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
          feedQuery.fetchNextPage()
        }
      }
    }, { rootMargin: '120px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [feedQuery.hasNextPage, feedQuery.isFetchingNextPage])

  // Helper: compute newest timestamp in current cache
  const newestTs = useMemo(() => {
    let max = 0
    for (const page of feedQuery.data?.pages || []) {
      for (const ev of page) {
        if (ev.created_at && ev.created_at > max) max = ev.created_at
      }
    }
    return max
  }, [feedQuery.data])

  // Function to fetch newer events and prepend to cache
  const fetchNewer = async () => {
    if (isFetchingNewer) return
    const now = Date.now()
    // throttle: avoid spamming while at top
    if (now - lastTopFetchRef.current < 8000) return
    lastTopFetchRef.current = now
    setIsFetchingNewer(true)
    try {
      if (mode === 'global' || mode === 'user' || mode === 'profile') {
        const filter: NDKFilter = {
          kinds: FEED_KINDS,
          limit: PAGE_SIZE,
        }
        if (mode === 'user' && user?.pubkey) {
          ;(filter as any).authors = [user.pubkey]
        }
        if (mode === 'profile' && profilePubkey) {
          ;(filter as any).authors = [profilePubkey]
        }
        if (newestTs > 0) {
          ;(filter as any).since = newestTs + 1
        }
        const eventsSet = await withTimeout(ndk.fetchEvents(filter), 8000, 'fetch newer events')
        const fresh = Array.from(eventsSet).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        if (fresh.length > 0) {
          const key: any = mode === 'global' ? ['global-feed'] : ['user-feed', user?.pubkey ?? 'anon']
          queryClient.setQueryData<any>(key, (oldData: any) => {
            if (!oldData) return { pages: [fresh], pageParams: [null] }
            return {
              ...oldData,
              pages: [fresh, ...oldData.pages],
              pageParams: [oldData.pageParams?.[0] ?? null, ...oldData.pageParams],
            }
          })
        }
      } else if (mode === 'follows') {
        const follows = (followsQuery.data || []) as string[]
        if (!user?.pubkey || !follows.length) return
        const filters: NDKFilter[] = chunk(follows, 20).map(group => {
          const f: NDKFilter = { kinds: FEED_KINDS, authors: group as any, limit: PAGE_SIZE }
          if (newestTs > 0) (f as any).since = newestTs + 1
          return f
        })
        const eventsSet = await withTimeout(ndk.fetchEvents(filters as any), 10000, 'fetch follows newer events')
        const fresh = Array.from(eventsSet).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        if (fresh.length > 0) {
          const key: any = ['follows-feed', user?.pubkey ?? 'anon']
          queryClient.setQueryData<any>(key, (oldData: any) => {
            if (!oldData) return { pages: [fresh], pageParams: [null] }
            return {
              ...oldData,
              pages: [fresh, ...oldData.pages],
              pageParams: [oldData.pageParams?.[0] ?? null, ...oldData.pageParams],
            }
          })
        }
      }
    } catch (e) {
      // ignore errors; next attempt will retry
    } finally {
      setIsFetchingNewer(false)
    }
  }

  // Top IO: trigger fetchNewer when top sentinel visible (fallback if pull not used)
  useEffect(() => {
    const el = topSentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          fetchNewer()
        }
      }
    }, { rootMargin: '0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [newestTs])

  // Window-level touch handlers for pull-to-refresh (top) and pull-to-load (bottom)
  useEffect(() => {
    const nearBottom = () => {
      const doc = document.documentElement
      return window.scrollY + window.innerHeight >= doc.scrollHeight - 2
    }

    const onTouchStart = (e: TouchEvent) => {
      const y0 = e.touches[0]?.clientY ?? null
      // Top pull only if at absolute top
      if (window.scrollY <= 0) {
        startYRef.current = y0
        isPullingRef.current = y0 !== null
      }
      // Bottom pull only if at (or extremely near) bottom
      if (nearBottom()) {
        bottomStartYRef.current = y0
        isBottomPullingRef.current = y0 !== null
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0
      // Top pull handling
      if (isPullingRef.current && startYRef.current !== null) {
        const deltaDown = y - startYRef.current
        if (deltaDown > 0) {
          const eased = Math.min(PULL_MAX, deltaDown * 0.6)
          setPullDistance(eased)
        } else {
          setPullDistance(0)
        }
      }
      // Bottom pull handling (dragging up)
      if (isBottomPullingRef.current && bottomStartYRef.current !== null) {
        const deltaUp = bottomStartYRef.current - y
        if (deltaUp > 0) {
          const eased = Math.min(BOTTOM_PULL_MAX, deltaUp * 0.6)
          setBottomPullDistance(eased)
        } else {
          setBottomPullDistance(0)
        }
      }
    }
    const onTouchEnd = () => {
      // Trigger top refresh if threshold met
      if (pullDistance >= PULL_THRESHOLD) {
        fetchNewer()
      }
      // Trigger bottom load if threshold met
      if (
        bottomPullDistance >= BOTTOM_PULL_THRESHOLD &&
        feedQuery.hasNextPage &&
        !feedQuery.isFetchingNextPage
      ) {
        feedQuery.fetchNextPage()
      }
      // Reset state
      setPullDistance(0)
      startYRef.current = null
      isPullingRef.current = false

      setBottomPullDistance(0)
      bottomStartYRef.current = null
      isBottomPullingRef.current = false
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart as any)
      window.removeEventListener('touchmove', onTouchMove as any)
      window.removeEventListener('touchend', onTouchEnd as any)
    }
  }, [pullDistance, bottomPullDistance, feedQuery.hasNextPage, feedQuery.isFetchingNextPage])

  // Show back-to-top button after half-screen scroll
  useEffect(() => {
    const onScroll = () => {
      try {
        setShowBackToTop(window.scrollY > window.innerHeight / 2)
      } catch {}
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true } as any)
    return () => window.removeEventListener('scroll', onScroll as any)
  }, [])

  // Scroll to top and then trigger a refresh for newer items
  const goTopAndRefresh = () => {
    const trigger = () => {
      // small delay to ensure layout settled at top
      setTimeout(() => { fetchNewer() }, 50)
    }
    if (window.scrollY <= 0) {
      trigger()
      return
    }
    let done = false
    const onTop = () => {
      if (!done && window.scrollY <= 0) {
        done = true
        window.removeEventListener('scroll', onTop)
        trigger()
      }
    }
    window.addEventListener('scroll', onTop)
    // Fast smooth scroll
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      window.scrollTo(0, 0)
    }
    // Fallback timeout in case scroll event doesn't fire
    setTimeout(() => {
      if (!done) {
        done = true
        window.removeEventListener('scroll', onTop)
        trigger()
      }
    }, 1200)
  }

  // Flatten and de-duplicate by event id
  const events: NDKEvent[] = useMemo(() => {
    const map = new Map<string, NDKEvent>()
    for (const page of feedQuery.data?.pages || []) {
      for (const ev of page) {
        if (ev.id && !map.has(ev.id)) map.set(ev.id, ev)
      }
    }
    // Return in newest-first order
    return Array.from(map.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  }, [feedQuery.data])

  // Close the current profile and restore the previous view
  const closeCurrentProfileAndRestore = () => {
    const current = profilePubkey
    if (!current) return
    const restore = prevView
    // remove current from opened list
    const after = openedProfiles.filter(p => p.pubkey !== current)
    setOpenedProfiles(after)

    if (restore) {
      if (restore.mode === 'profile' && restore.profilePubkey && after.some(p => p.pubkey === restore.profilePubkey)) {
        setProfilePubkey(restore.profilePubkey)
        setMode('profile')
      } else {
        setProfilePubkey(null)
        setMode(restore.mode)
      }
      setPrevView(null)
      return
    }

    // Fallback behavior: go to another opened profile if any, else Global
    if (after.length > 0) {
      setProfilePubkey(after[0].pubkey)
      setMode('profile')
    } else {
      setProfilePubkey(null)
      setMode('global')
    }
  }

  return (
    <>
      {/* Left sidebar with feed mode buttons */}
      <div className="fixed left-0 top-12 z-40 flex flex-col gap-2 p-0 bg-black h-full">
        {/* Opened profile tabs */}
        {openedProfiles.filter(p => !(user && p.pubkey === user.pubkey)).map((p) => (
          <div key={p.pubkey} className="relative inline-block">
            <button
              aria-label={`Profile ${p.name || p.npub || p.pubkey}`}
              onClick={() => { if (!(mode === 'profile' && profilePubkey === p.pubkey)) { setPrevView({ mode, profilePubkey }) }; setProfilePubkey(p.pubkey); setMode('profile') }}
              className={`w-12 xl:w-32 h-12 ${mode === 'profile' && profilePubkey === p.pubkey ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-center xl:justify-start xl:px-3`}
              title={`Open ${p.name || p.npub || 'profile'}`}
            >
              {p.picture ? (
                <img src={p.picture} alt="avatar" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <UserIcon className="w-6 h-6 text-[#cccccc]" />
              )}
              <span className="hidden xl:inline ml-2 text-[#cccccc] select-none truncate">{p.name || (p.npub ? p.npub.slice(0, 10) + '…' : shorten(p.pubkey))}</span>
            </button>
          </div>
        ))}
        {user && (
            <button
                aria-label="Follows feed"
                onClick={() => setMode('follows')}
                className={`w-12 xl:w-32 h-12 ${mode === 'follows' ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-center xl:justify-start xl:px-3`}
                title={'Show posts from people you follow'}
            >
              <UsersIcon className="w-6 h-6 text-[#cccccc]" />
              <span className="hidden xl:inline ml-2 text-[#cccccc] select-none">Follows</span>
            </button>
        )}
        <button
          aria-label="Global feed"
          onClick={() => setMode('global')}
          className={`w-12 xl:w-32 h-12 ${mode === 'global' ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-center xl:justify-start xl:px-3`}
        >
          <GlobeIcon className="w-6 h-6 text-[#cccccc]" />
          <span className="hidden xl:inline ml-2 text-[#cccccc] select-none">Global</span>
        </button>
      </div>

      <div className="relative ml-[calc(3rem+1em)] xl:ml-[calc(8rem+1em)] xl:flex xl:items-start xl:gap-4">
        <div className="w-full max-w-2xl">
          {(mode === 'user' || mode === 'follows') && !user ? (
            <div className="bg-[#162a2f] rounded-xl p-6">
              <p>Please use the Login button in the top bar to view this feed.</p>
            </div>
          ) : (
            <div className="bg-[#162a2f] rounded-xl divide-y divide-[#37474f] overflow-hidden shadow-lg relative">
              {/* Profile header */}
              {mode === 'profile' && (
                <div className={`relative w-full ${profileMeta.data?.banner ? '' : 'bg-[#1a2529]'}`}>
                  {/* Banner background */}
                  {profileMeta.data?.banner && (
                    <div
                      className="absolute inset-0 bg-center bg-cover"
                      style={{ backgroundImage: `url(${profileMeta.data.banner})` }}
                      aria-hidden="true"
                    />
                  )}
                  {/* Overlay to ensure readability */}
                  {profileMeta.data?.banner && <div className="absolute inset-0 bg-black/30" aria-hidden="true" />}
                  <div className="relative p-4 flex items-start gap-4">
                    {profileMeta.data?.picture ? (
                      <img src={profileMeta.data.picture} alt="avatar" className="w-16 h-16 rounded-full object-cover ring-2 ring-black/40" />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center text-[#cccccc] ring-2 ring-black/40">
                        <UserIcon className="w-8 h-8" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="bg-black/60 rounded p-[0.5em]">
                        <div className="text-[#f0f0f0] text-xl font-semibold mb-1 truncate">
                          {profileMeta.data?.name || shorten(profilePubkey || '')}
                        </div>
                        {profileMeta.data?.about ? (
                          <div className="whitespace-pre-wrap break-words text-[#f0f0f0]">
                            {profileMeta.data.about}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {!(user && profilePubkey && user.pubkey === profilePubkey) && (
                      <div className="ml-2">
                        <button
                          type="button"
                          aria-label="Close profile view"
                          onClick={closeCurrentProfileAndRestore}
                          className={`${bannerIsLight ? 'bg-white/70 text-black hover:bg-white' : 'bg-[#162a2f] text-[#cccccc] hover:bg-[#1b3a40]'} px-3 py-1 rounded`}
                          title="Close profile"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Pull-to-refresh area (appears when pulling or fetching newer) */}
              <div
                className="w-full bg-black text-white flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
                style={{ height: (isFetchingNewer ? 64 : Math.max(0, Math.min(120, pullDistance))) + 'px' }}
                aria-live="polite"
                aria-atomic="true"
              >
                {(pullDistance > 0 || isFetchingNewer) && (
                  <div className="flex items-center gap-2 py-2">
                    <Spinner />
                    <span className="text-sm">{isFetchingNewer ? 'Refreshing…' : pullDistance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}</span>
                  </div>
                )}
              </div>
              {/* Top sentinel for fetching newer events */}
              <div ref={topSentinelRef} />
              {events.length === 0 && feedQuery.isLoading ? (
                <div className="p-6">Loading feed…</div>
              ) : (
                events.map((ev) => (
                  <NoteCard
                    key={ev.id || `${ev.created_at}-${Math.random()}`}
                    ev={ev}
                    onReply={onReply}
                    onRepost={onRepost}
                    onQuote={onQuote}
                    onOpenThread={openThreadFor}
                    openMedia={setMediaToShow}
                    openProfileByBech={openProfileByBech}
                    openProfileByPubkey={openProfileByPubkey}
                    activeThreadRootId={sideThreadRootId || threadRootId}
                  />
                ))
              )}
              {!feedQuery.hasNextPage && events.length > 0 && (
                <div className="p-4 text-sm opacity-60">No more results.</div>
              )}

              {/* Bottom pull-to-load area (appears when pulling up or fetching next) */}
              <div
                className="w-full bg-black text-white flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
                style={{ height: ((feedQuery.isFetchingNextPage ? 64 : Math.max(0, Math.min(120, bottomPullDistance)))) + 'px' }}
                aria-live="polite"
                aria-atomic="true"
              >
                {(bottomPullDistance > 0 || feedQuery.isFetchingNextPage) && (
                  <div className="flex items-center gap-2 py-2">
                    <Spinner />
                    <span className="text-sm">{feedQuery.isFetchingNextPage ? 'Loading more…' : bottomPullDistance >= BOTTOM_PULL_THRESHOLD ? 'Release to load more' : 'Pull up to load more'}</span>
                  </div>
                )}
              </div>

              {/* Bottom sentinel for infinite scroll */}
              <div ref={bottomSentinelRef} />

              {threadRootId && (
                <ThreadModal
                  rootId={threadRootId}
                  seedId={threadOpenSeed || undefined}
                  onClose={() => setThreadRootId(null)}
                  openMedia={setMediaToShow}
                  openProfileByBech={openProfileByBech}
                  openProfileByPubkey={openProfileByPubkey}
                />
              )}
            </div>
          )}
        </div>
        <div className="hidden xl:block fixed top-12 right-0 bottom-0 w-full max-w-2xl z-[60] overflow-auto pr-2">
          <div className="px-2 pt-2 pb-4">
            {sideThreadRootId ? (
              <ThreadPanel
                rootId={sideThreadRootId}
                seedId={threadOpenSeed || undefined}
                onClose={() => setSideThreadRootId(null)}
                openMedia={setMediaToShow}
                openProfileByBech={openProfileByBech}
                openProfileByPubkey={openProfileByPubkey}
              />
            ) : (
              <div className="bg-[#162a2f] rounded-xl p-6 text-sm opacity-60">Select a thread…</div>
            )}
          </div>
        </div>
      </div>

      {showBackToTop && (
        <div className="fixed bottom-6 right-6 z-[100] flex items-center gap-3">
          <button
            type="button"
            onClick={goTopAndRefresh}
            className="rounded-full bg-[#162a2f] text-[#cccccc] shadow hover:bg-[#1b3a40] px-4 h-12 flex items-center"
            title="Back to top"
          >
            Back to top
          </button>
          <button
              type="button"
              aria-label="Back to top"
              onClick={goTopAndRefresh}
              className="w-12 h-12 rounded-full bg-[#162a2f] text-[#cccccc] shadow hover:bg-[#1b3a40] flex items-center justify-center"
              title="Back to top"
          >
            <UpArrowIcon className="w-6 h-6" />
          </button>
        </div>
      )}

      {mediaToShow && (
        <MediaModal gallery={mediaToShow} onClose={() => setMediaToShow(null)} />
      )}
    </>
  )
}

function shorten(s: string, n = 8) {
  if (!s) return ''
  return s.length <= n ? s : `${s.slice(0, n)}…`
}

function formatTime(ts?: number) {
  if (!ts) return ''
  try {
    const d = new Date(ts * 1000)
    return d.toLocaleString()
  } catch {
    return ''
  }
}

function ThreadModal({ rootId, seedId: _seedId, onClose, openMedia, openProfileByBech, openProfileByPubkey }: { rootId: string; seedId?: string; onClose: () => void; openMedia: (g: MediaGallery) => void; openProfileByBech: (bech: string) => void; openProfileByPubkey: (pubkey: string) => void }) {
  // Fetch root event
  const { data: root } = useQuery<NDKEvent | null>({
    queryKey: ['thread-root', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [rootId] } as any), 8000, 'fetch thread root')
        return Array.from(set)[0] || null
      } catch {
        return null
      }
    },
  })

  // Fetch thread events referencing the root via e-tag
  const { data: children } = useQuery<NDKEvent[]>({
    queryKey: ['thread-children', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        const filter: NDKFilter = { kinds: [1, 6, 1111, 30023, 9802, 1068, 1222, 1244, 20, 21, 22], '#e': [rootId] as any, limit: 500 }
        const set = await withTimeout(ndk.fetchEvents(filter as any), 10000, 'fetch thread')
        const list = Array.from(set)
        return list.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
      } catch {
        return []
      }
    },
  })

  const all = useMemo(() => {
    const arr: NDKEvent[] = []
    if (root) arr.push(root)
    for (const c of (children || [])) arr.push(c)
    // Ensure unique by id
    const map = new Map<string, NDKEvent>()
    for (const ev of arr) { if (ev.id) map.set(ev.id, ev) }
    return Array.from(map.values())
  }, [root, children])

  // Build parent-child relationships using tags
  const { tree, order, truncated } = useMemo(() => {
    const byId = new Map<string, NDKEvent>()
    for (const ev of all) if (ev.id) byId.set(ev.id, ev)
    const parentOf = new Map<string, string | null>()
    for (const ev of all) {
      const eTags = (ev.tags || []).filter(t => t[0] === 'e')
      let parent: string | null = null
      const reply = eTags.find(t => t[3] === 'reply')?.[1] as string | undefined
      const rootTag = eTags.find(t => t[3] === 'root')?.[1] as string | undefined
      if (reply) parent = reply
      else if (rootTag && rootTag !== ev.id) parent = rootTag
      else if (eTags.length > 0) parent = (eTags[eTags.length - 1][1] as string)
      else parent = null
      if (parent && !byId.has(parent)) {
        // If parent is outside current set, attach to root
        parent = rootId
      }
      parentOf.set(ev.id as string, parent)
    }
    const childrenMap = new Map<string, string[]>()
    for (const [id, p] of parentOf) {
      const key = p || 'root'
      if (!childrenMap.has(key)) childrenMap.set(key, [])
      childrenMap.get(key)!.push(id)
    }
    // Sort children by created_at
    for (const [k, arr] of childrenMap) {
      arr.sort((a, b) => ((byId.get(a)?.created_at || 0) - (byId.get(b)?.created_at || 0)))
    }
    // Determine traversal order starting from rootId using an iterative DFS to avoid call stack overflow
    const order: string[] = []
    let truncated = false
    const MAX_VISIT = 1000
    try {
      if (byId.has(rootId)) {
        const stack: string[] = [rootId]
        while (stack.length > 0) {
          const id = stack.pop() as string
          order.push(id)
          if (order.length >= MAX_VISIT) { truncated = true; break }
          const kids = childrenMap.get(id) || []
          // push in reverse so that earlier-created children appear first in order
          for (let i = kids.length - 1; i >= 0; i--) {
            stack.push(kids[i])
          }
        }
      }
    } catch {
      truncated = true
    }
    return { tree: { byId, childrenMap }, order, truncated }
  }, [all, rootId])

  const onBackdrop = (e: any) => { e.stopPropagation(); onClose() }

  return (
    <div className="fixed inset-0 z-[1200] bg-black/70" onClick={onBackdrop} role="dialog" aria-modal="true">
      <button type="button" onClick={(e) => { e.stopPropagation(); onClose() }} className="fixed top-3 right-3 z-[1300] w-10 h-10 rounded-full bg-black/70 text-white hover:bg-black/90" aria-label="Close thread view">×</button>
      <div className="absolute inset-y-2 left-[10%] right-[10%] bg-[#0f1a1d] rounded-lg shadow-xl overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4">
          {!root ? (
            <div className="text-sm text-[#cccccc]">Loading thread…</div>
          ) : (
            <div className="space-y-4">
              {order.map((id) => {
                const ev = tree.byId.get(id) as NDKEvent
                if (!ev) return null
                // Compute depth by walking up parents
                let depth = 0
                while (true) {
                  const p = (() => {
                    const eTags = (ev.tags || []).filter(t => t[0] === 'e')
                    const reply = eTags.find(t => t[3] === 'reply')?.[1] as string | undefined
                    const rootTag = eTags.find(t => t[3] === 'root')?.[1] as string | undefined
                    if (reply) return reply
                    if (rootTag && rootTag !== ev.id) return rootTag
                    if (eTags.length > 0) return eTags[eTags.length - 1][1] as string
                    return null
                  })()
                  if (!p || p === rootId) break
                  depth++
                  break
                }
                return (
                  <div key={id} className="border border-black rounded bg-[#10181b]" style={{ marginLeft: Math.min(24, depth) * 16 }}>
                    <div className="p-3">
                      <header className="mb-2 flex items-center gap-2 text-xs text-[#cccccc]">
                        <AuthorLabel pubkey={ev.pubkey || ''} onOpen={(pk) => openProfileByPubkey(pk)} />
                        <span className="opacity-50">·</span>
                        <time className="opacity-70">{formatTime(ev.created_at)}</time>
                      </header>
                      {ev.kind === 6 ? (
                        <RepostNote ev={ev} openMedia={openMedia} openProfile={openProfileByBech} openProfileByPubkey={openProfileByPubkey} />
                      ) : (
                        <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                          {renderContent(ev.content, openMedia, openProfileByBech)}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {truncated && (
                <div className="text-xs text-[#cccccc] opacity-70">Thread truncated due to size. Some replies may be hidden.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function NoteCard({ ev, onReply, onRepost, onQuote, onOpenThread, openMedia, openProfileByBech, openProfileByPubkey, activeThreadRootId }: { ev: NDKEvent; onReply: (e: NDKEvent) => void; onRepost: (e: NDKEvent) => void; onQuote: (e: NDKEvent) => void; onOpenThread: (e: NDKEvent) => void; openMedia: (g: MediaGallery) => void; openProfileByBech: (bech: string) => void; openProfileByPubkey: (pubkey: string) => void; activeThreadRootId?: string | null }) {
  const getThreadRootIdLocal = (ev: NDKEvent): string => {
    const eTags = (ev.tags || []).filter(t => t[0] === 'e')
    const root = eTags.find(t => (t[3] === 'root'))?.[1] as string | undefined
    const reply = eTags.find(t => (t[3] === 'reply'))?.[1] as string | undefined
    const any = eTags[0]?.[1] as string | undefined
    return (root || reply || any || ev.id || '')
  }
  const thisRootId = getThreadRootIdLocal(ev)
  const isActiveThread = !!activeThreadRootId && activeThreadRootId === thisRootId

  const [expanded, setExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const calc = () => {
      const inner = innerRef.current
      if (!inner) { setIsOverflowing(false); return }
      const maxPx = Math.max(0, Math.floor(window.innerHeight * 0.5))
      // Measure natural content height
      const natural = inner.scrollHeight
      setIsOverflowing(natural > maxPx + 4)
    }
    calc()
    const ro = new ResizeObserver(() => calc())
    if (innerRef.current) ro.observe(innerRef.current)
    window.addEventListener('resize', calc)
    return () => {
      try { ro.disconnect() } catch {}
      window.removeEventListener('resize', calc)
    }
  }, [])

  return (
    <article className="p-3 relative">
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <header className="mb-1 flex items-center gap-2 text-sm text-[#cccccc]">
            <AuthorLabel pubkey={ev.pubkey || ''} onOpen={(pk) => openProfileByPubkey(pk)} />
            <span className="opacity-50">·</span>
            <time className="opacity-70">{formatTime(ev.created_at)}</time>
          </header>

          {/* Collapsible content wrapper capped at 50vh when not expanded */}
          <div
            ref={wrapperRef}
            className="relative"
            style={{ maxHeight: expanded ? 'none' as any : '50vh', overflow: expanded ? 'visible' : 'hidden' }}
          >
            <div ref={innerRef} className="whitespace-pre-wrap break-words text-[#cccccc]">
              {ev.kind === 6 ? (
                <RepostNote ev={ev} openMedia={openMedia} openProfile={openProfileByBech} openProfileByPubkey={openProfileByPubkey} />
              ) : (
                <div className="contents">{renderContent(ev.content, openMedia, openProfileByBech)}</div>
              )}
            </div>
            {!expanded && isOverflowing && (
              <div className="absolute left-0 right-0 bottom-0 h-16 bg-gradient-to-t from-[#162a2f] to-transparent pointer-events-none" aria-hidden="true" />
            )}
          </div>

          {/* Revealer button */}
          {!expanded && isOverflowing && (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="px-3 py-1 rounded-full bg-black/60 text-white hover:bg-black/80 text-sm"
                title="Show more"
                aria-label="Show more"
              >
                Show more
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0 self-start">
          <button type="button" onClick={() => onOpenThread(ev)} className={`${isActiveThread ? 'bg-[#fff3b0] text-black' : 'bg-black/60 text-white hover:bg-black/80'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Open thread">
            <ThreadReelIcon className="w-8 h-8" />
          </button>
          <button type="button" onClick={() => onQuote(ev)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Quote">
            <QuoteIcon className="w-8 h-8" />
          </button>
          <button type="button" onClick={() => onRepost(ev)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Repost">
            <RepostEllipsisBubbleIcon className="w-8 h-8" />
          </button>
          <button type="button" onClick={() => onReply(ev)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Reply">
            <ReplyBubbleIcon className="w-8 h-8" />
          </button>
        </div>
      </div>
    </article>
  )
}

function MediaModal({ gallery, onClose }: { gallery: MediaGallery; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [index, setIndex] = useState(gallery.index)
  const items = gallery.items

  const goPrev = () => setIndex((i) => (i - 1 + items.length) % items.length)
  const goNext = () => setIndex((i) => (i + 1) % items.length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+') setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))
      if (e.key === '-') setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))
      if (e.key.toLowerCase() === 'r') setZoom(1)
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, items.length])

  // Reset zoom when image/video changes
  useEffect(() => { setZoom(1) }, [index])

  const current = items[index] || items[0]

  return (
    <div className="fixed inset-0 z-[2000] bg-black/80 flex flex-col" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex justify-end gap-2 p-2" onClick={(e) => e.stopPropagation()}>
        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2))) }} className="bg-[#162a2f] text-white px-3 py-1 rounded hover:bg-[#1b3a40]" aria-label="Zoom out">-</button>
        <button onClick={(e) => { e.stopPropagation(); setZoom(1) }} className="bg-[#162a2f] text-white px-3 py-1 rounded hover:bg-[#1b3a40]" aria-label="Reset zoom">Reset</button>
        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(4, +(z + 0.25).toFixed(2))) }} className="bg-[#162a2f] text-white px-3 py-1 rounded hover:bg-[#1b3a40]" aria-label="Zoom in">+</button>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} className="bg-[#162a2f] text-white px-3 py-1 rounded hover:bg-[#1b3a40]" aria-label="Close">Close</button>
      </div>
      <div className="relative flex-1 flex items-center justify-center p-4">
        {/* Left/Right arrows */}
        {items.length > 1 && (
          <>
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/60 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/80"
              onClick={(e) => { e.stopPropagation(); goPrev() }}
              aria-label="Previous"
            >
              <span className="text-xl select-none">‹</span>
            </button>
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/60 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/80"
              onClick={(e) => { e.stopPropagation(); goNext() }}
              aria-label="Next"
            >
              <span className="text-xl select-none">›</span>
            </button>
          </>
        )}
        <div className="max-w-[95vw] max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
          {current.type === 'image' ? (
            <img src={current.url} alt="media" style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }} className="max-w-full max-h-[85vh] object-contain select-none" />
          ) : (
            <video src={current.url} controls autoPlay className="max-w-full max-h-[85vh]" style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }} />
          )}
        </div>
      </div>
    </div>
  )
}

function RepostNote({ ev, openMedia, openProfile, openProfileByPubkey }: { ev: NDKEvent, openMedia: (g: MediaGallery) => void, openProfile: (bech: string) => void, openProfileByPubkey: (pubkey: string) => void }) {
  // Attempt to parse embedded original event JSON (classic kind 6 style)
  let embedded: any = null
  try {
    if (ev.content) {
      const parsed = JSON.parse(ev.content)
      if (parsed && typeof parsed === 'object' && parsed.id && parsed.pubkey) {
        embedded = parsed
      }
    }
  } catch {}

  // Fallback: use first 'e' tag as the target id
  const targetId = useMemo(() => {
    if (embedded?.id) return embedded.id as string
    const eTag = (ev.tags || []).find(t => t[0] === 'e' && t[1])
    return eTag ? (eTag[1] as string) : ''
  }, [ev, embedded?.id])

  const { data: original } = useQuery<{ id: string; pubkey: string; created_at?: number } | null>({
    queryKey: ['repost-target', targetId],
    enabled: !!targetId && !embedded,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [targetId] } as any), 6000, 'fetch repost target')
        const first = Array.from(set)[0] as any
        if (!first) return null
        // Return a minimal serializable snapshot
        return {
          id: first.id,
          pubkey: first.pubkey,
          created_at: first.created_at,
          kind: (first as any).kind,
          content: first.content,
          tags: first.tags,
        } as any
      } catch {
        return null
      }
    },
  })

  const target = embedded || original

  return (
    <div className="mt-2">
      <div className="rounded-lg bg-[#1a2529] p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-[#cccccc]">
          {target?.pubkey ? <AuthorLabel pubkey={String(target.pubkey)} onOpen={(pk) => openProfileByPubkey(pk)} /> : <span className="opacity-70">Unknown author</span>}
          <span className="opacity-50">·</span>
          <time className="opacity-70">{formatTime((target as any)?.created_at)}</time>
        </div>
        {!target ? (
          <div className="text-xs text-[#cccccc]">Loading…</div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[#cccccc]">
            {renderContent((target as any)?.content || '', openMedia, openProfile)}
          </div>
        )}
      </div>
    </div>
  )
}

function InlineProfile({ bech, onOpen }: { bech: string; onOpen: (bech: string) => void }) {
  const { data } = useQuery<{ pubkey: string; name: string; picture?: string }>({
    queryKey: ['inline-profile', bech],
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      try {
        let u: any
        if (/^npub1[0-9a-z]+$/i.test(bech)) u = ndk.getUser({ npub: bech } as any)
        else if (/^nprofile1[0-9a-z]+$/i.test(bech)) u = ndk.getUser({ nprofile: bech } as any)
        else return { pubkey: '', name: bech }
        try { await withTimeout(u.fetchProfile?.(), 4000, 'inline profile fetch') } catch {}
        const prof: any = u.profile || {}
        const name: string = prof.displayName || prof.display_name || prof.name || prof.nip05 || ''
        const picture: string | undefined = prof.picture || undefined
        const pubkey: string = u.pubkey || ''
        return { pubkey, name, picture }
      } catch {
        return { pubkey: '', name: bech }
      }
    },
  })
  const label = data?.name || (bech.startsWith('npub1') ? bech.slice(0, 12) + '…' : 'Profile')
  const pic = data?.picture
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); onOpen(bech) }}
      className="inline-flex items-center gap-1 align-middle rounded-full bg-black/30 px-2 py-0.5 hover:bg-black/50 text-[#9ecfff] focus:outline-none"
      title={bech}
    >
      {pic ? <img src={pic} alt="avatar" className="w-4 h-4 rounded-full object-cover" /> : <UserIcon className="w-4 h-4" />}
      <span className="text-sm">{label}</span>
    </button>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4  rounded-full animate-spin"
      aria-hidden="true"
    />
  )
}

function AuthorLabel({ pubkey, onOpen }: { pubkey: string, onOpen?: (pubkey: string) => void }) {
  const { data } = useQuery({
    queryKey: ['profile', pubkey],
    enabled: !!pubkey,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      try {
        const user = ndk.getUser({ pubkey })
        try {
          await withTimeout(user.fetchProfile(), 5000, 'profile fetch')
        } catch {}
        const prof: any = user.profile || {}
        const name: string = prof.displayName || prof.display_name || prof.name || prof.nip05 || ''
        const picture: string | undefined = prof.picture || undefined
        return { name, picture }
      } catch {
        return { name: '', picture: undefined as string | undefined }
      }
    },
  })
  const name = (data?.name && String(data.name)) || shorten(pubkey)
  const pic = data?.picture
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen(pubkey)}
        className="flex items-center gap-2 hover:underline cursor-pointer focus:outline-none"
        title={name}
      >
        {pic ? (
          <img src={pic} alt="avatar" className="w-6 h-6 rounded-full object-cover" />
        ) : null}
        <span className="opacity-90">{name}</span>
      </button>
    )
  }
  return (
    <>
      {pic ? (
        <img src={pic} alt="avatar" className="w-6 h-6 rounded-full object-cover" />
      ) : null}
      <span className="opacity-90">{name}</span>
    </>
  )
}

function GlobeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 21c4.971 0 9-4.029 9-9s-4.029-9-9-9-9 4.029-9 9 4.029 9 9 9z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 12h18M12 3c2.5 2.5 3.75 5.5 3.75 9S14.5 17.5 12 21M12 3C9.5 5.5 8.25 8.5 8.25 12S9.5 17.5 12 21" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 21c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function UsersIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 11c2.209 0 4-1.791 4-4S11.209 3 9 3 5 4.791 5 7s1.791 4 4 4z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 21c0-3.314 2.686-6 6-6h2c3.314 0 6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17 11c1.657 0 3-1.343 3-3s-1.343-3-3-3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M22 21c0-2.209-1.791-4-4-4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function UpArrowIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 19V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ThreadReelIcon({ className = '' }: { className?: string }) {
  // Simple spool/reel: two discs with thread lines
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6" y="5" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8h8M8 11h8M8 14h8M8 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ReplyBubbleIcon({ className = '' }: { className?: string }) {
  // Speech bubble
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 5h12a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H10l-5 4v-4H4a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" transform="translate(2 1)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function QuoteIcon({ className = '' }: { className?: string }) {
  // Heavy quote marks
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 7c-2.761 0-5 2.239-5 5v5h5v-5H7c0-1.105.895-2 2-2V7z" fill="currentColor" />
      <path d="M20 7c-2.761 0-5 2.239-5 5v5h5v-5h-2c0-1.105.895-2 2-2V7z" fill="currentColor" />
    </svg>
  )
}

function RepostEllipsisBubbleIcon({ className = '' }: { className?: string }) {
  // Speech bubble with three dots
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 5h12a4 4 0 0 1 4 4v3a4 4 0 0 1-4 4H10l-5 4v-4H4a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" transform="translate(2 1)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="9" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="15" cy="12" r="1.25" fill="currentColor" />
    </svg>
  )
}


function ThreadPanel({ rootId, seedId: _seedId, onClose, openMedia, openProfileByBech, openProfileByPubkey }: { rootId: string; seedId?: string; onClose: () => void; openMedia: (g: MediaGallery) => void; openProfileByBech: (bech: string) => void; openProfileByPubkey: (pubkey: string) => void }) {
  const { data: root } = useQuery<NDKEvent | null>({
    queryKey: ['thread-root', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [rootId] } as any), 8000, 'fetch thread root')
        return Array.from(set)[0] || null
      } catch {
        return null
      }
    },
  })
  const { data: children } = useQuery<NDKEvent[]>({
    queryKey: ['thread-children', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        const filter: NDKFilter = { kinds: [1, 6, 1111, 30023, 9802, 1068, 1222, 1244, 20, 21, 22], '#e': [rootId] as any, limit: 500 }
        const set = await withTimeout(ndk.fetchEvents(filter as any), 10000, 'fetch thread')
        const list = Array.from(set)
        return list.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
      } catch {
        return []
      }
    },
  })
  const all = useMemo(() => {
    const arr: NDKEvent[] = []
    if (root) arr.push(root)
    for (const c of (children || [])) arr.push(c)
    const map = new Map<string, NDKEvent>()
    for (const ev of arr) { if (ev.id) map.set(ev.id, ev) }
    return Array.from(map.values())
  }, [root, children])
  const { tree, order, truncated } = useMemo(() => {
    const byId = new Map<string, NDKEvent>()
    for (const ev of all) if (ev.id) byId.set(ev.id, ev)
    const parentOf = new Map<string, string | null>()
    for (const ev of all) {
      const eTags = (ev.tags || []).filter(t => t[0] === 'e')
      let parent: string | null = null
      const reply = eTags.find(t => t[3] === 'reply')?.[1] as string | undefined
      const rootTag = eTags.find(t => t[3] === 'root')?.[1] as string | undefined
      if (reply) parent = reply
      else if (rootTag && rootTag !== ev.id) parent = rootTag
      else if (eTags.length > 0) parent = (eTags[eTags.length - 1][1] as string)
      else parent = null
      if (parent && !byId.has(parent)) parent = rootId
      parentOf.set(ev.id as string, parent)
    }
    const childrenMap = new Map<string, string[]>()
    for (const [id, p] of parentOf) {
      const key = p || 'root'
      if (!childrenMap.has(key)) childrenMap.set(key, [])
      childrenMap.get(key)!.push(id)
    }
    for (const [k, arr] of childrenMap) {
      arr.sort((a, b) => ((byId.get(a)?.created_at || 0) - (byId.get(b)?.created_at || 0)))
    }
    const order: string[] = []
    let truncated = false
    const MAX_VISIT = 1000
    try {
      if (byId.has(rootId)) {
        const stack: string[] = [rootId]
        while (stack.length > 0) {
          const id = stack.pop() as string
          order.push(id)
          if (order.length >= MAX_VISIT) { truncated = true; break }
          const kids = childrenMap.get(id) || []
          for (let i = kids.length - 1; i >= 0; i--) {
            stack.push(kids[i])
          }
        }
      }
    } catch {
      truncated = true
    }
    return { tree: { byId, childrenMap }, order, truncated }
  }, [all, rootId])
  return (
    <div className="bg-[#0f1a1d] rounded-lg shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-black/50">
        <div className="text-[#fff3b0] font-semibold">Thread</div>
        <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-black/70 text-white hover:bg-black/90" aria-label="Close thread panel">×</button>
      </div>
      <div className="max-h-[calc(100vh-7rem)] overflow-auto">
        <div className="p-4">
          {!root ? (
            <div className="text-sm text-[#cccccc]">Loading thread…</div>
          ) : (
            <div className="space-y-4">
              {order.map((id) => {
                const ev = tree.byId.get(id) as NDKEvent
                if (!ev) return null
                let depth = 0
                while (true) {
                  const p = (() => {
                    const eTags = (ev.tags || []).filter(t => t[0] === 'e')
                    const reply = eTags.find(t => t[3] === 'reply')?.[1] as string | undefined
                    const rootTag = eTags.find(t => t[3] === 'root')?.[1] as string | undefined
                    if (reply) return reply
                    if (rootTag && rootTag !== ev.id) return rootTag
                    if (eTags.length > 0) return eTags[eTags.length - 1][1] as string
                    return null
                  })()
                  if (!p || p === rootId) break
                  depth++
                  break
                }
                return (
                  <div key={id} className="border border-black rounded bg-[#10181b]" style={{ marginLeft: Math.min(24, depth) * 16 }}>
                    <div className="p-3">
                      <header className="mb-2 flex items-center gap-2 text-xs text-[#cccccc]">
                        <AuthorLabel pubkey={ev.pubkey || ''} onOpen={(pk) => openProfileByPubkey(pk)} />
                        <span className="opacity-50">·</span>
                        <time className="opacity-70">{formatTime(ev.created_at)}</time>
                      </header>
                      {ev.kind === 6 ? (
                        <RepostNote ev={ev} openMedia={openMedia} openProfile={openProfileByBech} openProfileByPubkey={openProfileByPubkey} />
                      ) : (
                        <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                          {renderContent(ev.content, openMedia, openProfileByBech)}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {truncated && (
                <div className="text-xs text-[#cccccc] opacity-70">Thread truncated due to size. Some replies may be hidden.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
