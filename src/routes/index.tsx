import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query'
import { ndk, withTimeout, type LoggedInUser } from '@/lib/ndk'
import { type NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { useEffect, useMemo, useRef, useState } from 'react'

export const Route = createFileRoute('/')({
  component: Home,
})

type FeedMode = 'global' | 'user' | 'follows'

// Event kinds to include in feeds (global and user)
const FEED_KINDS: number[] = [1, 1111, 6, 30023, 9802, 1068, 1222, 1244, 20, 21, 22]

type MediaType = 'image' | 'video'
type MediaItem = { url: string; type: MediaType }
// Gallery of media within a single note
type MediaGallery = { items: MediaItem[]; index: number }

const URL_REGEX = /(https?:\/\/[^\s]+)/g
const MEDIA_EXT_REGEX = /\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|webm|mov|m4v|avi|mkv)(?:\?.*)?$/i
function classifyMedia(url: string): MediaItem | null {
  if (!MEDIA_EXT_REGEX.test(url)) return null
  const isVideo = /\.(mp4|webm|mov|m4v|avi|mkv)(?:\?.*)?$/i.test(url)
  return { url, type: isVideo ? 'video' : 'image' }
}

function renderContent(text: string, openMedia: (g: MediaGallery) => void) {
  if (!text) return null
  // Pre-extract all media items in the content to build a gallery for navigation
  const urls = (text.match(URL_REGEX) || []) as string[]
  const medias: MediaItem[] = urls
    .map(u => classifyMedia(u))
    .filter((m): m is MediaItem => !!m)

  const parts = text.split(URL_REGEX)
  return parts.map((part, idx) => {
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
    return <span key={idx}>{part}</span>
  })
}

function Home() {
  const [mediaToShow, setMediaToShow] = useState<MediaGallery | null>(null)
  // Infinite feed query using NDK. When a signer is present, NDK auto-connects
  // to user relays; otherwise it uses default relays configured in ndk.ts.
  const PAGE_SIZE = 4

  // Feed mode and user info (from localStorage saved by Root)
  const [mode, setMode] = useState<FeedMode>('global')
  const [user, setUser] = useState<LoggedInUser | null>(null)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nostrUser')
      if (saved) setUser(JSON.parse(saved))
    } catch {}
  }, [])

  // Ensure unavailable tabs are not active when logged out
  useEffect(() => {
    if (!user && mode !== 'global') {
      setMode('global')
    }
  }, [user])

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

  const feedQuery = useInfiniteQuery({
    queryKey:
      mode === 'global'
        ? ['global-feed']
        : mode === 'user'
        ? ['user-feed', user?.pubkey ?? 'anon']
        : ['follows-feed', user?.pubkey ?? 'anon', (followsQuery.data || []).length],
    initialPageParam: null as number | null, // until cursor (unix seconds)
    queryFn: async ({ pageParam }) => {
      // Global and user modes use a single filter
      if (mode === 'global' || mode === 'user') {
        const filter: NDKFilter = {
          kinds: FEED_KINDS,
          limit: PAGE_SIZE,
        }
        if (mode === 'user' && user?.pubkey) {
          ;(filter as any).authors = [user.pubkey]
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
    enabled: mode === 'global' || !!user?.pubkey,
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
      if (mode === 'global' || mode === 'user') {
        const filter: NDKFilter = {
          kinds: FEED_KINDS,
          limit: PAGE_SIZE,
        }
        if (mode === 'user' && user?.pubkey) {
          ;(filter as any).authors = [user.pubkey]
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

  return (
    <>
      {/* Left sidebar with feed mode buttons */}
      <div className="fixed left-0 top-16 z-40 flex flex-col gap-2 p-0 bg-black h-full">
        {user && (
            <button
                aria-label="Follows feed"
                onClick={() => setMode('follows')}
                className={`w-12 xl:w-32 h-12 bg-[#263238] hover:bg-[#1b3a40] flex items-center justify-center xl:justify-start xl:px-3 ${mode === 'follows' ? 'outline outline-2 outline-[#00d4aa]' : ''}`}
                title={'Show posts from people you follow'}
            >
              <UsersIcon className="w-6 h-6 text-[#cccccc]" />
              <span className="hidden xl:inline ml-2 text-[#cccccc] select-none">Follows</span>
            </button>
        )}
        {user && (
          <button
            aria-label="Your posts"
            onClick={() => setMode('user')}
            className={`w-12 xl:w-32 h-12 bg-[#263238] hover:bg-[#1b3a40] flex items-center justify-center xl:justify-start xl:px-3 ${mode === 'user' ? 'outline outline-2 outline-[#00d4aa]' : ''}`}
            title={'Show your posts'}
          >
            {user.picture ? (
              <img src={user.picture} alt="avatar" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <UserIcon className="w-6 h-6 text-[#cccccc]" />
            )}
            <span className="hidden xl:inline ml-2 text-[#cccccc] select-none">Me</span>
          </button>
        )}
        <button
          aria-label="Global feed"
          onClick={() => setMode('global')}
          className={`w-12 xl:w-32 h-12 bg-[#263238] hover:bg-[#1b3a40] flex items-center justify-center xl:justify-start xl:px-3 ${mode === 'global' ? 'outline outline-2 outline-[#00d4aa]' : ''}`}
        >
          <GlobeIcon className="w-6 h-6 text-[#cccccc]" />
          <span className="hidden xl:inline ml-2 text-[#cccccc] select-none">Global</span>
        </button>
      </div>

      <div className="max-w-2xl relative ml-[calc(3rem+1em)] xl:ml-[calc(8rem+1em)]">
        <h2 className="text-[#fff3b0] mb-4 text-2xl">
          {mode === 'global' ? 'Global Feed' : mode === 'user' ? 'Your Posts' : 'Follows Feed'}
        </h2>
        <p className="mb-6">
          {mode === 'global'
            ? 'Showing public notes from connected relays.'
            : mode === 'user'
            ? (user ? 'Showing only your notes.' : 'Login to view your posts.')
            : (user ? `Showing notes from ${followsQuery.data?.length ?? 0} people you follow.` : 'Login to view your follows feed.')}
        </p>

        {(mode === 'user' || mode === 'follows') && !user ? (
          <div className="bg-[#263238] rounded-xl p-6 border border-black">
            <p>Please use the Login button in the top bar to view this feed.</p>
          </div>
        ) : (
          <div className="bg-[#263238] rounded-xl divide-y divide-[#37474f] overflow-hidden shadow-lg relative">
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
                <article key={ev.id || `${ev.created_at}-${Math.random()}`} className="p-4">
                  <header className="mb-2 flex items-center gap-2 text-sm text-[#cccccc]">
                    <AuthorLabel pubkey={ev.pubkey || ''} />
                    <span className="opacity-50">·</span>
                    <time className="opacity-70">{formatTime(ev.created_at)}</time>
                  </header>
                  {ev.kind === 6 ? (
                    <RepostNote ev={ev} openMedia={setMediaToShow} />
                  ) : (
                    <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                      {renderContent(ev.content, setMediaToShow)}
                    </div>
                  )}
                </article>
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
          </div>
        )}
      </div>

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

function RepostNote({ ev, openMedia }: { ev: NDKEvent, openMedia: (g: MediaGallery) => void }) {
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
      <div className="rounded-lg border border-black bg-[#1a2529] p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-[#cccccc]">
          {target?.pubkey ? <AuthorLabel pubkey={String(target.pubkey)} /> : <span className="opacity-70">Unknown author</span>}
          <span className="opacity-50">·</span>
          <time className="opacity-70">{formatTime((target as any)?.created_at)}</time>
        </div>
        {!target ? (
          <div className="text-xs text-[#cccccc]">Loading…</div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[#cccccc]">
            {renderContent((target as any)?.content || '', openMedia)}
          </div>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
      aria-hidden="true"
    />
  )
}

function AuthorLabel({ pubkey }: { pubkey: string }) {
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