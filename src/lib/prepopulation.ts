import { NDKEvent, NDKFilter, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, withTimeout, initializeNDK } from './ndk'
import { eventDB } from './eventDB'

// Event kinds to prepopulate (same as feed kinds)
const PREPOPULATE_KINDS: NDKKind[] = [1, 1111, 6, 7, 30023, 9802, 1068, 1222, 1244, 20, 21, 22] as unknown as NDKKind[]

/**
 * Prepopulate the database with events from the last 24 hours
 * This runs on application startup to improve initial load performance
 */
export async function prepopulateDatabase(): Promise<void> {
  try {
    console.log('Starting database prepopulation...')
    
    // Ensure NDK is initialized
    await initializeNDK(10000)
    
    // Calculate timestamp for 24 hours ago
    const twentyFourHoursAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000)
    
    // Check if we already have recent data to avoid unnecessary fetching
    const hasRecentData = await checkForRecentData(twentyFourHoursAgo)
    if (hasRecentData) {
      console.log('Database already contains recent data, skipping prepopulation')
      return
    }
    
    console.log('Fetching events from the last 24 hours...')
    
    // Fetch events in smaller batches to avoid overwhelming the relays
    const batchSize = 500
    const batches = 4 // Total of 2000 events maximum
    let totalFetched = 0
    
    for (let i = 0; i < batches; i++) {
      try {
        const filter: NDKFilter = {
          kinds: PREPOPULATE_KINDS,
          since: twentyFourHoursAgo,
          limit: batchSize
        }
        
        console.log(`Fetching batch ${i + 1}/${batches}...`)
        
        // Fetch events with timeout
        const eventSet = await withTimeout(
          ndk.fetchEvents(filter),
          15000, // 15 second timeout per batch
          `prepopulate batch ${i + 1}`
        )
        
        const events = Array.from(eventSet) as NDKEvent[]
        
        if (events.length === 0) {
          console.log('No more events found, stopping prepopulation')
          break
        }
        
        // Filter out events we already have
        const newEvents: NDKEvent[] = []
        for (const event of events) {
          if (event.id) {
            const existing = await eventDB.getEvent(event.id)
            if (!existing) {
              newEvents.push(event)
            }
          }
        }
        
        // Store new events in batch
        if (newEvents.length > 0) {
          await eventDB.storeEvents(newEvents)
          totalFetched += newEvents.length
          console.log(`Stored ${newEvents.length} new events (batch ${i + 1})`)
        } else {
          console.log(`No new events in batch ${i + 1}`)
        }
        
        // Small delay between batches to be respectful to relays
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        console.warn(`Failed to fetch batch ${i + 1}:`, error)
        // Continue with next batch even if one fails
      }
    }
    
    console.log(`Database prepopulation completed. Fetched ${totalFetched} new events.`)
    
    // Mark prepopulation as completed with current timestamp
    await markPrepopulationComplete()
    
  } catch (error) {
    console.error('Database prepopulation failed:', error)
    // Don't throw - prepopulation failure shouldn't break the app
  }
}

/**
 * Check if we already have recent data to avoid unnecessary prepopulation
 */
async function checkForRecentData(since: number): Promise<boolean> {
  try {
    // Check if prepopulation was completed recently (within last 24 hours)
    const lastPrepopulation = localStorage.getItem('nostrly-last-prepopulation')
    if (lastPrepopulation) {
      const lastTime = parseInt(lastPrepopulation, 10)
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000
      if (lastTime > twentyFourHoursAgo) {
        return true
      }
    }
    
    return false
  } catch (error) {
    console.warn('Failed to check for recent data:', error)
    return false
  }
}

/**
 * Mark prepopulation as completed
 */
async function markPrepopulationComplete(): Promise<void> {
  try {
    localStorage.setItem('nostrly-last-prepopulation', Date.now().toString())
  } catch (error) {
    console.warn('Failed to mark prepopulation complete:', error)
  }
}