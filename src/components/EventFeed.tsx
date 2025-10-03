import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { nostrService, NostrEvent, UserMetadata } from '../lib/nostr'
import NoteCard from './NoteCard'

interface EventFeedProps {
  feedType: 'global' | 'follows' | 'note' | 'hashtag' | 'user' | 'relay'
  onNoteClick?: (event: NostrEvent, metadata?: UserMetadata | null) => void
}

const EventFeed: React.FC<EventFeedProps> = ({ feedType, onNoteClick }) => {
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
    queryKey: ['events', feedType],
    queryFn: async ({ pageParam = undefined }) => {
      // Different fetch parameters based on feed type
      const fetchParams: any = {
        limit: 20,
        until: pageParam
      }

      // Add feed-specific filters
      if (feedType === 'follows') {
        // For follows feed, you would typically filter by followed pubkeys
        // This is a placeholder - implement based on your follow list logic
        fetchParams.authors = [] // Add followed pubkey list here
      } else if (feedType === 'note') {
        // Filter for text notes only (kind 1)
        fetchParams.kinds = [1]
      } else if (feedType === 'hashtag') {
        // Filter for posts with hashtags
        fetchParams.kinds = [1]
        // You could add specific hashtag filtering here
      } else if (feedType === 'user') {
        // Filter for user-specific content
        fetchParams.kinds = [0, 1] // Profile and notes
      } else if (feedType === 'relay') {
        // Filter for relay-specific content
        fetchParams.kinds = [1]
      }
      // For 'global' feedType, no additional filters (show everything)

      const events = await nostrService.fetchEvents(fetchParams)
      
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