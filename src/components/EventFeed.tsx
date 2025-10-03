import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { nostrService, NostrEvent, UserMetadata } from '../lib/nostr'
import NoteCard from './NoteCard'

const EventFeed: React.FC = () => {
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
    queryKey: ['events'],
    queryFn: async ({ pageParam = undefined }) => {
      const events = await nostrService.fetchEvents({
        limit: 20,
        until: pageParam
      })
      
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