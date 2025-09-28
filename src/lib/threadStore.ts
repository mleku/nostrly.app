import {QueryClient, useQueryClient, useQuery} from '@tanstack/react-query'
import {NDKEvent, type NDKFilter} from '@nostr-dev-kit/ndk'
import {ndk, withTimeout} from './ndk'
import {getParentEventHexId, getRootEventHexId} from './event'

export type ThreadData = {
  items: NDKEvent[]
  rootId: string
  openerId?: string
}

const THREAD_KEY = (rootId: string) => ['thread-full', rootId]

async function fetchEventById(id: string): Promise<NDKEvent | null> {
  try {
    const set = await withTimeout(ndk.fetchEvents({ids: [id]} as any), 8000, 'fetch event by id')
    const arr = Array.from(set) as NDKEvent[]
    return arr[0] || null
  } catch {
    return null
  }
}

async function fetchAllByRoot(rootId: string, since?: number): Promise<NDKEvent[]> {
  try {
    const filter: NDKFilter = { kinds: [1], '#e': [rootId] } as any
    if (since) (filter as any).since = since
    const set = await withTimeout(ndk.fetchEvents(filter as any), 12000, 'fetch thread events by root')
    const arr = Array.from(set) as NDKEvent[]
    // Keep only events that explicitly mark this root with marker 'root', excluding the root event itself
    return arr.filter(evv => {
      if (!evv || !Array.isArray((evv as any).tags)) return false
      if (evv.id === rootId) return false
      return (evv as any).tags.some((t: any[]) => t?.[0] === 'e' && t?.[1] === rootId && t?.[3] === 'root')
    })
  } catch {
    return []
  }
}

async function fetchParentChainFrom(ev: NDKEvent): Promise<NDKEvent[]> {
  const chain: NDKEvent[] = []
  const seen = new Set<string>()
  let current: NDKEvent | null = ev || null
  let safety = 0
  while (current && current.id && !seen.has(current.id) && safety < 100) {
    chain.push(current)
    seen.add(current.id)
    const pid = getParentEventHexId(current)
    if (!pid) break
    const parent = await fetchEventById(pid)
    if (!parent) break
    current = parent
    safety++
  }
  return chain
}

function mergeUniqueSort(items: NDKEvent[]): NDKEvent[] {
  const map = new Map<string, NDKEvent>()
  for (const it of items) {
    const id = it.id || ''
    if (!id) continue
    if (!map.has(id)) map.set(id, it)
  }
  return Array.from(map.values()).sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
}

export async function ensureThread(queryClient: QueryClient, rootId: string, openerId?: string) {
  if (!rootId) return
  // If already populated, keep but allow background enhancement
  const existing = queryClient.getQueryData<ThreadData>(THREAD_KEY(rootId))

  // Fetch root to know timestamp
  const root = await fetchEventById(rootId)
  const since = root?.created_at || undefined

  // Fetch all events by root and parent chain if opener specified
  const [related, openerEv] = await Promise.all([
    fetchAllByRoot(rootId, since),
    openerId ? fetchEventById(openerId) : Promise.resolve(null)
  ])
  const parentChain = openerEv ? await fetchParentChainFrom(openerEv) : []

  const items: NDKEvent[] = []
  if (root) items.push(root)
  items.push(...related)
  items.push(...parentChain)
  if (openerEv) items.push(openerEv)

  const merged = mergeUniqueSort(items)

  const data: ThreadData = { items: merged, rootId, openerId }

  // If there is existing data, merge to avoid losing items
  if (existing) {
    const merged2 = mergeUniqueSort([...(existing.items || []), ...merged])
    queryClient.setQueryData(THREAD_KEY(rootId), { items: merged2, rootId, openerId: openerId || existing.openerId })
  } else {
    queryClient.setQueryData(THREAD_KEY(rootId), data)
  }
}

export function useThread(rootId?: string) {
  const qc = useQueryClient()
  return useQuery<ThreadData>({
    queryKey: rootId ? THREAD_KEY(rootId) : ['thread-full', 'none'],
    enabled: !!rootId,
    // If not present, lazily populate a minimal shell by fetching only root
    queryFn: async () => {
      if (!rootId) return { items: [], rootId: '', openerId: undefined }
      const existing = qc.getQueryData<ThreadData>(THREAD_KEY(rootId))
      if (existing) return existing
      const root = await fetchEventById(rootId)
      const items = root ? [root] : []
      const data: ThreadData = { items, rootId }
      qc.setQueryData(THREAD_KEY(rootId), data)
      return data
    },
    staleTime: 1000 * 60 * 5,
    keepPreviousData: true,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
}

export async function ensureThreadForEvent(queryClient: QueryClient, ev: NDKEvent) {
  const rid = getRootEventHexId(ev) || ev.id || ''
  const openerId = ev.id || undefined
  if (!rid) return
  await ensureThread(queryClient, rid, openerId)
}
