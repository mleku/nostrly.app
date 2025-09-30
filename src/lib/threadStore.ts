import {QueryClient, useQueryClient, useQuery} from '@tanstack/react-query'
import {NDKEvent, type NDKFilter} from '@nostr-dev-kit/ndk'
import {ndk, withTimeout} from './ndk'
import {getParentEventHexId, getRootEventHexId} from './event'
import {eventDB} from './eventDB'

export type ThreadData = {
  items: NDKEvent[]
  rootId: string
  openerId?: string
}

const THREAD_KEY = (rootId: string) => ['thread-full', rootId]
const EVENT_CACHE = new Map<string, Promise<NDKEvent | null>>()

async function fetchEventById(id: string): Promise<NDKEvent | null> {
  // Check in-memory cache first to avoid duplicate requests
  if (EVENT_CACHE.has(id)) {
    return EVENT_CACHE.get(id)!
  }
  
  const promise = (async () => {
    try {
      // First check IndexedDB for persistent cache
      const cachedEvent = await eventDB.getEvent(id)
      if (cachedEvent) {
        return cachedEvent
      }
      
      // If not in persistent cache, fetch from network
      const set = await withTimeout(ndk.fetchEvents({ids: [id]} as any), 8000, 'fetch event by id')
      const arr = Array.from(set) as NDKEvent[]
      const event = arr[0] || null
      
      // Store in IndexedDB for future use
      if (event) {
        await eventDB.storeEvent(event)
      }
      
      return event
    } catch {
      return null
    }
  })()
  
  EVENT_CACHE.set(id, promise)
  
  // Clear cache entry after 5 minutes to prevent memory leaks
  setTimeout(() => EVENT_CACHE.delete(id), 5 * 60 * 1000)
  
  return promise
}

async function fetchAllByRoot(rootId: string, since?: number): Promise<NDKEvent[]> {
  try {
    // Check if we have cached thread events in IndexedDB
    const cachedEventIds = await eventDB.getThreadEvents(rootId)
    if (cachedEventIds && cachedEventIds.length > 0) {
      const cachedEvents = await eventDB.getEvents(cachedEventIds)
      const eventArray = Array.from(cachedEvents.values())
      // If we have a good cache, use it (unless we have a 'since' parameter indicating we want newer events)
      if (!since && eventArray.length > 0) {
        return eventArray
      }
    }
    
    const filter: NDKFilter = { kinds: [1], '#e': [rootId] } as any
    if (since) (filter as any).since = since
    const set = await withTimeout(ndk.fetchEvents(filter as any), 12000, 'fetch thread events by root')
    const arr = Array.from(set) as NDKEvent[]
    
    // Keep only events that explicitly mark this root with marker 'root', excluding the root event itself
    const filtered = arr.filter(evv => {
      if (!evv || !Array.isArray((evv as any).tags)) return false
      if (evv.id === rootId) return false
      return (evv as any).tags.some((t: any[]) => t?.[0] === 'e' && t?.[1] === rootId && t?.[3] === 'root')
    })
    
    // Store events and thread relationship in IndexedDB
    if (filtered.length > 0) {
      await eventDB.storeEvents(filtered)
      const eventIds = filtered.map(e => e.id).filter(Boolean) as string[]
      await eventDB.storeThreadEvents(rootId, eventIds)
    }
    
    return filtered
  } catch {
    return []
  }
}

async function fetchParentChainFrom(ev: NDKEvent): Promise<NDKEvent[]> {
  const chain: NDKEvent[] = []
  const seen = new Set<string>()
  const toFetch: string[] = []
  
  // First pass: collect all parent IDs to fetch in batch
  let current: NDKEvent | null = ev || null
  let safety = 0
  while (current && current.id && !seen.has(current.id) && safety < 100) {
    chain.push(current)
    seen.add(current.id)
    const pid = getParentEventHexId(current)
    if (!pid || seen.has(pid)) break
    toFetch.push(pid)
    current = null // Will be set from batch fetch
    safety++
  }
  
  // Batch fetch all parent events at once
  if (toFetch.length > 0) {
    try {
      // First check IndexedDB for cached parent events
      const cachedEvents = await eventDB.getEvents(toFetch)
      const eventMap = new Map<string, NDKEvent>(cachedEvents)
      
      // Identify which events we still need to fetch from network
      const missingIds = toFetch.filter(id => !eventMap.has(id))
      
      // Fetch missing events from network
      if (missingIds.length > 0) {
        const filter: NDKFilter = { ids: missingIds } as any
        const set = await withTimeout(ndk.fetchEvents(filter as any), 10000, 'fetch parent chain batch')
        const parentEvents = Array.from(set) as NDKEvent[]
        
        // Add newly fetched events to the map and store in IndexedDB
        const newEvents: NDKEvent[] = []
        for (const event of parentEvents) {
          if (event.id) {
            eventMap.set(event.id, event)
            newEvents.push(event)
          }
        }
        
        // Store newly fetched events in IndexedDB
        if (newEvents.length > 0) {
          await eventDB.storeEvents(newEvents)
        }
      }
      
      // Second pass: build the complete chain using fetched events
      current = ev
      const finalChain: NDKEvent[] = []
      const finalSeen = new Set<string>()
      safety = 0
      while (current && current.id && !finalSeen.has(current.id) && safety < 100) {
        finalChain.push(current)
        finalSeen.add(current.id)
        const pid = getParentEventHexId(current)
        if (!pid || finalSeen.has(pid)) break
        current = eventMap.get(pid) || null
        safety++
      }
      return finalChain
    } catch {
      // Fallback to original chain if batch fetch fails
      return chain
    }
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

  // Fetch all data in parallel for maximum performance
  const [root, related, openerEv] = await Promise.all([
    fetchEventById(rootId),
    fetchAllByRoot(rootId), // Remove since parameter to avoid dependency on root fetch
    openerId ? fetchEventById(openerId) : Promise.resolve(null)
  ])
  
  // Fetch parent chain in parallel if opener exists
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
    placeholderData: (previousData) => previousData,
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
