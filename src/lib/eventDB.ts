import { NDKEvent } from '@nostr-dev-kit/ndk'

// IndexedDB database configuration
const DB_NAME = 'NostrEventsDB'
const DB_VERSION = 1
const EVENTS_STORE = 'events'
const THREADS_STORE = 'threads'

// Cache expiration time (7 days in milliseconds)
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000

export interface StoredEvent {
  id: string
  event: NDKEvent
  cachedAt: number
  expiresAt: number
}

export interface StoredThread {
  rootId: string
  eventIds: string[]
  cachedAt: number
  expiresAt: number
}

class EventDatabase {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null

  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(new Error('Failed to open IndexedDB'))

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create events store
        if (!db.objectStoreNames.contains(EVENTS_STORE)) {
          const eventsStore = db.createObjectStore(EVENTS_STORE, { keyPath: 'id' })
          eventsStore.createIndex('expiresAt', 'expiresAt')
        }

        // Create threads store for caching thread relationships
        if (!db.objectStoreNames.contains(THREADS_STORE)) {
          const threadsStore = db.createObjectStore(THREADS_STORE, { keyPath: 'rootId' })
          threadsStore.createIndex('expiresAt', 'expiresAt')
        }
      }
    })

    return this.initPromise
  }

  async storeEvent(event: NDKEvent): Promise<void> {
    if (!event.id) return

    try {
      const db = await this.init()
      const now = Date.now()
      const storedEvent: StoredEvent = {
        id: event.id,
        event,
        cachedAt: now,
        expiresAt: now + CACHE_EXPIRY
      }

      const transaction = db.transaction([EVENTS_STORE], 'readwrite')
      const store = transaction.objectStore(EVENTS_STORE)
      await new Promise<void>((resolve, reject) => {
        const request = store.put(storedEvent)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(new Error('Failed to store event'))
      })
    } catch (error) {
      console.warn('Failed to store event in IndexedDB:', error)
    }
  }

  async getEvent(id: string): Promise<NDKEvent | null> {
    try {
      const db = await this.init()
      const transaction = db.transaction([EVENTS_STORE], 'readonly')
      const store = transaction.objectStore(EVENTS_STORE)

      return new Promise<NDKEvent | null>((resolve) => {
        const request = store.get(id)
        request.onsuccess = () => {
          const result = request.result as StoredEvent | undefined
          if (!result) {
            resolve(null)
            return
          }

          // Check if expired
          if (Date.now() > result.expiresAt) {
            // Clean up expired entry
            this.deleteEvent(id)
            resolve(null)
            return
          }

          resolve(result.event)
        }
        request.onerror = () => resolve(null) // Fail gracefully
      })
    } catch (error) {
      console.warn('Failed to get event from IndexedDB:', error)
      return null
    }
  }

  async storeEvents(events: NDKEvent[]): Promise<void> {
    if (events.length === 0) return

    try {
      const db = await this.init()
      const now = Date.now()
      const transaction = db.transaction([EVENTS_STORE], 'readwrite')
      const store = transaction.objectStore(EVENTS_STORE)

      const promises = events.map(event => {
        if (!event.id) return Promise.resolve()
        
        const storedEvent: StoredEvent = {
          id: event.id,
          event,
          cachedAt: now,
          expiresAt: now + CACHE_EXPIRY
        }

        return new Promise<void>((resolve, reject) => {
          const request = store.put(storedEvent)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(new Error(`Failed to store event ${event.id}`))
        })
      })

      await Promise.all(promises)
    } catch (error) {
      console.warn('Failed to store events in IndexedDB:', error)
    }
  }

  async getEvents(ids: string[]): Promise<Map<string, NDKEvent>> {
    const results = new Map<string, NDKEvent>()
    
    try {
      const db = await this.init()
      const transaction = db.transaction([EVENTS_STORE], 'readonly')
      const store = transaction.objectStore(EVENTS_STORE)
      const now = Date.now()

      const promises = ids.map(id => 
        new Promise<void>((resolve) => {
          const request = store.get(id)
          request.onsuccess = () => {
            const result = request.result as StoredEvent | undefined
            if (result && now <= result.expiresAt) {
              results.set(id, result.event)
            } else if (result && now > result.expiresAt) {
              // Clean up expired entry
              this.deleteEvent(id)
            }
            resolve()
          }
          request.onerror = () => resolve() // Fail gracefully
        })
      )

      await Promise.all(promises)
    } catch (error) {
      console.warn('Failed to get events from IndexedDB:', error)
    }

    return results
  }

  async deleteEvent(id: string): Promise<void> {
    try {
      const db = await this.init()
      const transaction = db.transaction([EVENTS_STORE], 'readwrite')
      const store = transaction.objectStore(EVENTS_STORE)
      
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(id)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(new Error('Failed to delete event'))
      })
    } catch (error) {
      console.warn('Failed to delete event from IndexedDB:', error)
    }
  }

  async storeThreadEvents(rootId: string, eventIds: string[]): Promise<void> {
    try {
      const db = await this.init()
      const now = Date.now()
      const storedThread: StoredThread = {
        rootId,
        eventIds,
        cachedAt: now,
        expiresAt: now + CACHE_EXPIRY
      }

      const transaction = db.transaction([THREADS_STORE], 'readwrite')
      const store = transaction.objectStore(THREADS_STORE)
      await new Promise<void>((resolve, reject) => {
        const request = store.put(storedThread)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(new Error('Failed to store thread'))
      })
    } catch (error) {
      console.warn('Failed to store thread in IndexedDB:', error)
    }
  }

  async getThreadEvents(rootId: string): Promise<string[] | null> {
    try {
      const db = await this.init()
      const transaction = db.transaction([THREADS_STORE], 'readonly')
      const store = transaction.objectStore(THREADS_STORE)

      return new Promise<string[] | null>((resolve) => {
        const request = store.get(rootId)
        request.onsuccess = () => {
          const result = request.result as StoredThread | undefined
          if (!result) {
            resolve(null)
            return
          }

          // Check if expired
          if (Date.now() > result.expiresAt) {
            // Clean up expired entry
            this.deleteThread(rootId)
            resolve(null)
            return
          }

          resolve(result.eventIds)
        }
        request.onerror = () => resolve(null) // Fail gracefully
      })
    } catch (error) {
      console.warn('Failed to get thread from IndexedDB:', error)
      return null
    }
  }

  async deleteThread(rootId: string): Promise<void> {
    try {
      const db = await this.init()
      const transaction = db.transaction([THREADS_STORE], 'readwrite')
      const store = transaction.objectStore(THREADS_STORE)
      
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(rootId)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(new Error('Failed to delete thread'))
      })
    } catch (error) {
      console.warn('Failed to delete thread from IndexedDB:', error)
    }
  }

  async cleanupExpired(): Promise<void> {
    try {
      const db = await this.init()
      const now = Date.now()
      
      // Clean up expired events
      const eventsTransaction = db.transaction([EVENTS_STORE], 'readwrite')
      const eventsStore = eventsTransaction.objectStore(EVENTS_STORE)
      const eventsIndex = eventsStore.index('expiresAt')
      const eventsRange = IDBKeyRange.upperBound(now)
      
      await new Promise<void>((resolve) => {
        const request = eventsIndex.openCursor(eventsRange)
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result
          if (cursor) {
            cursor.delete()
            cursor.continue()
          } else {
            resolve()
          }
        }
        request.onerror = () => resolve()
      })

      // Clean up expired threads
      const threadsTransaction = db.transaction([THREADS_STORE], 'readwrite')
      const threadsStore = threadsTransaction.objectStore(THREADS_STORE)
      const threadsIndex = threadsStore.index('expiresAt')
      
      await new Promise<void>((resolve) => {
        const request = threadsIndex.openCursor(eventsRange)
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result
          if (cursor) {
            cursor.delete()
            cursor.continue()
          } else {
            resolve()
          }
        }
        request.onerror = () => resolve()
      })
    } catch (error) {
      console.warn('Failed to cleanup expired entries:', error)
    }
  }
}

// Singleton instance
export const eventDB = new EventDatabase()

// Initialize cleanup routine (run every hour)
if (typeof window !== 'undefined') {
  setInterval(() => {
    eventDB.cleanupExpired().catch(console.warn)
  }, 60 * 60 * 1000)

  // Also run cleanup on page load
  setTimeout(() => {
    eventDB.cleanupExpired().catch(console.warn)
  }, 5000)
}