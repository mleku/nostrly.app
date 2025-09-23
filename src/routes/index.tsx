import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query'
import { ndk, withTimeout, type LoggedInUser } from '@/lib/ndk'
import { type NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { useEffect, useMemo, useRef, useState } from 'react'

export const Route = createFileRoute('/')({
  component: Home,
})

type FeedMode = 'global' | 'user'

// Event kinds to include in feeds (global and user)
const FEED_KINDS: number[] = [1, 1111, 6, 30023, 9802, 1068, 1222, 1244, 20, 21, 22]

function Home() {
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

  const feedQuery = useInfiniteQuery({
    queryKey: mode === 'global' ? ['global-feed'] : ['user-feed', user?.pubkey ?? 'anon'],
    initialPageParam: null as number | null, // until cursor (unix seconds)
    queryFn: async ({ pageParam }) => {
      const filter: NDKFilter = {
        kinds: FEED_KINDS,
        limit: PAGE_SIZE,
      }
      if (mode === 'user' && user?.pubkey) {
        ;(filter as any).authors = [user.pubkey]
      }
      if (pageParam) {
        // Fetch older items before this timestamp
        ;(filter as any).until = pageParam
      }
      const events = await withTimeout(ndk.fetchEvents(filter), 8000, 'fetch older events')
      // Sort newest first and convert to array
      const list = Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      return list
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
      <div className="fixed left-0 top-[80px] z-40 flex flex-col gap-2 p-0 bg-black h-full">
        <button
            aria-label="Your posts"
            onClick={() => user ? setMode('user') : null}
            disabled={!user}
            className={`w-12 xl:w-32 h-12 bg-[#263238] hover:bg-[#1b3a40] flex items-center justify-center xl:justify-start xl:px-3 disabled:opacity-50 ${mode === 'user' ? 'outline outline-2 outline-[#00d4aa]' : ''}`}
            title={user ? 'Show your posts' : 'Login to enable'}
        >
          {user?.picture ? (
              <img src={user.picture} alt="avatar" className="w-7 h-7 rounded-full object-cover" />
          ) : (
              <UserIcon className="w-6 h-6 text-[#cccccc]" />
          )}
          <span className="hidden xl:inline ml-2 text-[#cccccc] select-none">Me</span>
        </button>
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
        <h2 className="text-[#fff3b0] mb-4 text-2xl">{mode === 'global' ? 'Global Feed' : 'Your Posts'}</h2>
        <p className="mb-6">{mode === 'global' ? 'Showing public notes from connected relays.' : (user ? 'Showing only your notes.' : 'Login to view your posts.')}</p>

        {mode === 'user' && !user ? (
          <div className="bg-[#263238] rounded-xl p-6 border border-black">
            <p>Please use the Login button in the top bar to view your posts.</p>
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
                  <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                    {ev.content}
                  </div>
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