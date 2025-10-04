import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { nostrService, NostrEvent, UserMetadata } from '../lib/nostr'
import NoteCard from './NoteCard'

export type FilterMode = 'notes' | 'replies' | 'reposts'

interface EventFeedProps {
  feedType: 'global' | 'follows' | 'note' | 'hashtag' | 'user' | 'relay'
  onNoteClick?: (event: NostrEvent, metadata?: UserMetadata | null) => void
  onUserClick?: (pubkey: string, metadata?: UserMetadata | null) => void
  userPubkey?: string | null
  filterMode?: FilterMode
}

const EventFeed: React.FC<EventFeedProps> = ({ feedType, onNoteClick, onUserClick, userPubkey, filterMode = 'replies' }) => {
  const [userMetadataCache, setUserMetadataCache] = useState<Map<string, UserMetadata | null>>(new Map())
  const loadingRef = useRef<HTMLDivElement>(null)

  // Infinite query for events
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error
  } = useInfiniteQuery({
    queryKey: ['events', feedType, filterMode],
    queryFn: async ({ pageParam = undefined }) => {
      // Different fetch parameters based on feed type
      const fetchParams: any = {
        limit: 20,
        until: pageParam
      }

      // Add feed-specific filters
      if (feedType === 'follows') {
        // For follows feed, fetch the user's follow list first
        if (userPubkey) {
          const followedPubkeys = await nostrService.fetchFollowList(userPubkey)
          fetchParams.authors = followedPubkeys
        } else {
          // If no user is logged in, return empty results
          return []
        }
      } else if (feedType === 'note') {
        // Filter for text notes only (kind 1)
        fetchParams.kinds = [1]
      } else if (feedType === 'hashtag') {
        // Filter for posts with hashtags
        fetchParams.kinds = [1]
        // You could add specific hashtag filtering here
      } else if (feedType === 'user') {
        // Filter for user-specific content with kinds 1, 111, 6
        fetchParams.kinds = [1, 111, 6] // Text notes, long-form articles, reposts
        if (userPubkey) {
          fetchParams.authors = [userPubkey]
        }
      } else if (feedType === 'relay') {
        // Filter for relay-specific content
        fetchParams.kinds = [1]
      }
      // For 'global' feedType, no additional filters (show everything)

      let events = await nostrService.fetchEvents(fetchParams)
      
      // Apply filterMode filtering
      if (filterMode === 'notes') {
        // In "notes" mode, exclude reposts (kind 6) and replies (events with "e" tags)
        events = events.filter(event => {
          // Exclude reposts
          if (event.kind === 6) return false
          
          // Exclude replies (events that have "e" tags referencing other events)
          const hasETags = event.tags.some(tag => tag[0] === 'e')
          if (hasETags) return false
          
          // Additionally, for kind 1 events, exclude those with "e" tags that have "reply" marker
          if (event.kind === 1) {
            const hasReplyMarker = event.tags.some(tag => 
              tag[0] === 'e' && tag[3] === 'reply'
            )
            if (hasReplyMarker) return false
          }
          
          return true
        })
      } else if (filterMode === 'reposts') {
        // In "reposts" mode, only show kind 6 repost events
        events = events.filter(event => event.kind === 6)
      }
      
      // Fetch metadata for all unique authors in this batch
      const uniqueAuthors = [...new Set(events.map(e => e.pubkey))]
      const metadataPromises = uniqueAuthors
        .filter(pubkey => !userMetadataCache.has(pubkey))
        .map(async pubkey => {
          const metadata = await nostrService.fetchUserMetadata(pubkey)
          return { pubkey, metadata }
        })
      
      const metadataResults = await Promise.all(metadataPromises)
      
      // Update metadata cache
      setUserMetadataCache(prev => {
        const newCache = new Map(prev)
        metadataResults.forEach(({ pubkey, metadata }) => {
          newCache.set(pubkey, metadata)
        })
        return newCache
      })
      
      // For user feeds, fetch reactions for each note
      if (feedType === 'user') {
        const eventsWithReactions = await Promise.all(
          events.map(async (event) => {
            try {
              const reactions = await nostrService.fetchReactions(event.id)
              return { ...event, reactions }
            } catch (error) {
              console.warn(`Failed to fetch reactions for event ${event.id}:`, error)
              return { ...event, reactions: [] }
            }
          })
        )
        return eventsWithReactions
      }
      
      return events
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length === 0) return undefined
      // Use the oldest event's created_at as the next page param
      const oldestEvent = lastPage[lastPage.length - 1]
      return oldestEvent.created_at
    },
    initialPageParam: undefined,
    staleTime: 30000, // 30 seconds
  })

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )

    if (loadingRef.current) {
      observer.observe(loadingRef.current)
    }

    return () => {
      if (loadingRef.current) {
        observer.unobserve(loadingRef.current)
      }
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  // Flatten all pages into a single array of events
  const allEvents = data?.pages.flatMap(page => page) || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600 dark:text-gray-400">Loading events...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-red-600 dark:text-red-400">
          Failed to load events: {error.message}
        </div>
      </div>
    )
  }

  if (allEvents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-600 dark:text-gray-400">No events found</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Events list */}
      {allEvents.map((event) => (
        <NoteCard
          key={event.id}
          event={event}
          userMetadata={userMetadataCache.get(event.pubkey)}
          onNoteClick={onNoteClick}
          onUserClick={onUserClick}
        />
      ))}
      
      {/* Loading indicator for infinite scroll */}
      <div ref={loadingRef} className="p-4 text-center">
        {isFetchingNextPage ? (
          <div className="text-gray-600 dark:text-gray-400">Loading more events...</div>
        ) : hasNextPage ? (
          <div className="text-gray-400 dark:text-gray-600">Scroll for more</div>
        ) : (
          <div className="text-gray-400 dark:text-gray-600">No more events</div>
        )}
      </div>
    </div>
  )
}

export default EventFeed