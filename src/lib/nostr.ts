import { SimplePool, Filter, Event, nip19 } from 'nostr-tools'
import { get, set, createStore, UseStore } from 'idb-keyval'

// Default relays as specified in the issue
const DEFAULT_RELAYS = [
  'wss://nostr.wine',
  'wss://relay.orly.dev',
  'wss://theforest.nostr1.com',
  'wss://nostr.land'
]

export interface UserMetadata {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  website?: string
  banner?: string
  nip05?: string
  bot?: boolean
  birthday?: {
    year?: number
    month?: number
    day?: number
  }
  lud06?: string
  lud16?: string
}

// Create IndexedDB stores for caching
const eventsStore = createStore('nostr-events', 'events')
const metadataStore = createStore('nostr-metadata', 'metadata')

export interface NostrEvent extends Event {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

class NostrService {
  private pool: SimplePool
  private relays: string[]

  constructor(relays: string[] = DEFAULT_RELAYS) {
    this.pool = new SimplePool()
    this.relays = relays
  }

  /**
   * Cache events in IndexedDB
   */
  private async cacheEvents(events: NostrEvent[]) {
    const promises = events.map(event => 
      set(event.id, event, eventsStore)
    )
    await Promise.all(promises)
  }

  /**
   * Get cached events from IndexedDB
   */
  private async getCachedEvents(eventIds: string[]): Promise<NostrEvent[]> {
    const promises = eventIds.map(id => get(id, eventsStore))
    const results = await Promise.all(promises)
    return results.filter(Boolean) as NostrEvent[]
  }

  /**
   * Fetch events with infinite scroll support for kinds 1, 111, 6, 7
   */
  async fetchEvents(options: {
    limit?: number
    until?: number
    since?: number
    authors?: string[]
  } = {}): Promise<NostrEvent[]> {
    try {
      const { limit = 20, until, since, authors } = options
      
      const filter: Filter = {
        kinds: [1, 111, 6], // Text notes, long-form articles, reposts (excluding reactions)
        limit,
        ...(until && { until }),
        ...(since && { since }),
        ...(authors && { authors })
      }

      const events = await this.pool.querySync(this.relays, filter)
      const nostrEvents = events as NostrEvent[]
      
      // Cache the events
      if (nostrEvents.length > 0) {
        await this.cacheEvents(nostrEvents)
      }
      
      // Also cache metadata for all authors
      const uniqueAuthors = [...new Set(nostrEvents.map(e => e.pubkey))]
      const metadataPromises = uniqueAuthors.map(pubkey => 
        this.fetchUserMetadata(pubkey).catch(() => null)
      )
      await Promise.all(metadataPromises)
      
      return nostrEvents
    } catch (error) {
      console.error('Failed to fetch events:', error)
      return []
    }
  }

  /**
   * Fetch reactions (kind 7) for a specific event
   */
  async fetchReactions(eventId: string): Promise<NostrEvent[]> {
    try {
      const filter: Filter = {
        kinds: [7], // Reactions
        '#e': [eventId], // Events that reference this event
        limit: 100
      }

      const events = await this.pool.querySync(this.relays, filter)
      const reactions = events as NostrEvent[]
      
      // Cache the reactions
      if (reactions.length > 0) {
        await this.cacheEvents(reactions)
      }
      
      return reactions
    } catch (error) {
      console.error('Failed to fetch reactions:', error)
      return []
    }
  }

  /**
   * Fetch kind 0 metadata for a given pubkey
   */
  async fetchUserMetadata(pubkey: string): Promise<UserMetadata | null> {
    try {
      const filter: Filter = {
        kinds: [0],
        authors: [pubkey],
        limit: 1
      }

      const events = await this.pool.querySync(this.relays, filter)
      
      if (events.length === 0) {
        return null
      }

      // Get the most recent event (they should already be sorted by created_at desc)
      const event = events[0]
      
      try {
        const metadata = JSON.parse(event.content) as UserMetadata
        return metadata
      } catch (parseError) {
        console.warn('Failed to parse metadata JSON:', parseError)
        return null
      }
    } catch (error) {
      console.error('Failed to fetch user metadata:', error)
      return null
    }
  }

  /**
   * Fetch a specific event by ID
   */
  async fetchEventById(eventId: string): Promise<NostrEvent | null> {
    try {
      // First check cache
      const cached = await get(eventId, eventsStore) as NostrEvent | undefined
      if (cached) {
        return cached
      }

      const filter: Filter = {
        ids: [eventId],
        limit: 1
      }

      const events = await this.pool.querySync(this.relays, filter)
      
      if (events.length === 0) {
        return null
      }

      const event = events[0] as NostrEvent
      
      // Cache the event
      await set(eventId, event, eventsStore)
      
      return event
    } catch (error) {
      console.error('Failed to fetch event by ID:', error)
      return null
    }
  }

  /**
   * Fetch replies to a specific event
   */
  async fetchReplies(eventId: string): Promise<NostrEvent[]> {
    try {
      const filter: Filter = {
        kinds: [1], // Text notes (replies)
        '#e': [eventId], // Events that reference this event
        limit: 100
      }

      const events = await this.pool.querySync(this.relays, filter)
      const replies = events as NostrEvent[]
      
      // Cache the replies
      if (replies.length > 0) {
        await this.cacheEvents(replies)
      }
      
      return replies
    } catch (error) {
      console.error('Failed to fetch replies:', error)
      return []
    }
  }

  /**
   * Fetch follow list (kind 3) for a given pubkey
   */
  async fetchFollowList(pubkey: string): Promise<string[]> {
    try {
      const filter: Filter = {
        kinds: [3], // Follow list
        authors: [pubkey],
        limit: 1
      }

      const events = await this.pool.querySync(this.relays, filter)
      
      if (events.length === 0) {
        return []
      }

      // Get the most recent follow list event
      const event = events[0]
      
      // Extract pubkeys from 'p' tags
      const followedPubkeys: string[] = []
      if (event.tags) {
        for (const tag of event.tags) {
          if (tag[0] === 'p' && tag[1]) {
            followedPubkeys.push(tag[1])
          }
        }
      }
      
      return followedPubkeys
    } catch (error) {
      console.error('Failed to fetch follow list:', error)
      return []
    }
  }

  /**
   * Close all relay connections
   */
  close() {
    this.pool.close(this.relays)
  }

  /**
   * Get the configured relays
   */
  getRelays(): string[] {
    return [...this.relays]
  }

  /**
   * Update the relay list
   */
  setRelays(relays: string[]) {
    this.close()
    this.relays = relays
  }
}

// Export a singleton instance
export const nostrService = new NostrService()
export default NostrService