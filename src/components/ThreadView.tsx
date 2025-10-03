import React, { useState, useEffect, useRef } from 'react'
import { NostrEvent, UserMetadata, nostrService } from '../lib/nostr'
import NoteCard from './NoteCard'

export type ThreadFilterMode = 'all' | 'reposts'

interface ThreadViewProps {
  focusedEvent: NostrEvent
  focusedEventMetadata?: UserMetadata | null
  onNoteClick?: (event: NostrEvent, metadata?: UserMetadata | null) => void
  onClose?: () => void
  headerLeft?: string
  headerWidth?: string
}

const ThreadView: React.FC<ThreadViewProps> = ({ 
  focusedEvent, 
  focusedEventMetadata, 
  onNoteClick,
  onClose,
  headerLeft,
  headerWidth
}) => {
  const [threadEvents, setThreadEvents] = useState<NostrEvent[]>([])
  const [eventMetadata, setEventMetadata] = useState<Record<string, UserMetadata | null>>({})
  const [loading, setLoading] = useState(true)
  const [focusedEventId, setFocusedEventId] = useState(focusedEvent.id)
  const [filterMode, setFilterMode] = useState<ThreadFilterMode>('all')
  const containerRef = useRef<HTMLDivElement>(null)
  const focusedNoteRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Update focused event when prop changes
  useEffect(() => {
    setFocusedEventId(focusedEvent.id)
  }, [focusedEvent.id])

  // Scroll focused note to center when it changes or thread loads
  useEffect(() => {
    if (!loading && focusedEventId && threadEvents.length > 0) {
      const focusedElement = focusedNoteRefs.current[focusedEventId]
      const container = containerRef.current?.closest('.pane') as HTMLElement // Find the scrollable parent

      if (focusedElement && container) {
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
          const containerRect = container.getBoundingClientRect()
          const elementRect = focusedElement.getBoundingClientRect()
          
          // Calculate the position to center the element vertically
          const containerCenter = containerRect.height / 2
          const elementCenter = elementRect.height / 2
          const scrollTop = container.scrollTop + elementRect.top - containerRect.top - containerCenter + elementCenter
          
          // Smooth scroll to center the focused note
          container.scrollTo({
            top: scrollTop,
            behavior: 'smooth'
          })
        }, 100)
      }
    }
  }, [focusedEventId, loading, threadEvents])

  // Fetch thread and metadata
  useEffect(() => {
    const fetchThread = async () => {
      setLoading(true)
      try {
        // Start with the focused event
        const events = [focusedEvent]
        const metadataMap: Record<string, UserMetadata | null> = {}
        
        // Add focused event metadata if provided
        if (focusedEventMetadata) {
          metadataMap[focusedEvent.pubkey] = focusedEventMetadata
        }

        // Find root event by following 'e' tags (replies)
        let currentEvent = focusedEvent
        const processedIds = new Set([focusedEvent.id])
        
        // Traverse up the thread to find parent events
        while (currentEvent) {
          const eTags = currentEvent.tags?.filter(tag => tag[0] === 'e') || []
          if (eTags.length === 0) break
          
          // Get the parent event ID (usually the first 'e' tag or the one marked as 'reply')
          let parentId = null
          const replyTag = eTags.find(tag => tag[3] === 'reply')
          if (replyTag) {
            parentId = replyTag[1]
          } else if (eTags.length > 0) {
            parentId = eTags[0][1]
          }
          
          if (!parentId || processedIds.has(parentId)) break
          
          try {
            const parentEvent = await nostrService.fetchEventById(parentId)
            if (parentEvent) {
              events.unshift(parentEvent) // Add to beginning to maintain chronological order
              processedIds.add(parentEvent.id)
              currentEvent = parentEvent
            } else {
              break
            }
          } catch (error) {
            console.warn('Failed to fetch parent event:', parentId, error)
            break
          }
        }

        // Find replies to events in the thread
        for (const event of events) {
          try {
            const replies = await nostrService.fetchReplies(event.id)
            for (const reply of replies) {
              if (!processedIds.has(reply.id)) {
                events.push(reply)
                processedIds.add(reply.id)
              }
            }
          } catch (error) {
            console.warn('Failed to fetch replies for event:', event.id, error)
          }
        }

        // Sort events chronologically
        events.sort((a, b) => a.created_at - b.created_at)

        // Fetch metadata for all unique pubkeys
        const uniquePubkeys = [...new Set(events.map(event => event.pubkey))]
        await Promise.all(
          uniquePubkeys.map(async (pubkey) => {
            if (!metadataMap[pubkey]) {
              try {
                const metadata = await nostrService.fetchUserMetadata(pubkey)
                metadataMap[pubkey] = metadata
              } catch (error) {
                console.warn('Failed to fetch metadata for pubkey:', pubkey, error)
                metadataMap[pubkey] = null
              }
            }
          })
        )

        setThreadEvents(events)
        setEventMetadata(metadataMap)
      } catch (error) {
        console.error('Failed to fetch thread:', error)
        // Fallback to just the focused event
        setThreadEvents([focusedEvent])
        setEventMetadata(focusedEventMetadata ? { [focusedEvent.pubkey]: focusedEventMetadata } : {})
      } finally {
        setLoading(false)
      }
    }

    fetchThread()
  }, [focusedEvent, focusedEventMetadata])

  // Handle note click to focus on clicked note
  const handleThreadNoteClick = (event: NostrEvent, metadata?: UserMetadata | null) => {
    setFocusedEventId(event.id)
    onNoteClick?.(event, metadata)
  }

  // Handle focus on specific note by event ID (for replied-to button)
  const handleFocusNote = (eventId: string) => {
    setFocusedEventId(eventId)
  }

  // Handle scroll to top when header is clicked
  const handleScrollToTop = () => {
    const container = containerRef.current?.closest('.pane') as HTMLElement // Find the scrollable parent
    if (container) {
      container.scrollTo({
        top: 0,
        behavior: 'smooth'
      })
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse mb-2">Loading thread...</div>
          <div className="text-sm text-gray-400">Fetching conversation</div>
        </div>
      </div>
    )
  }

  // Filter events based on selected mode
  const filteredEvents = filterMode === 'reposts' 
    ? threadEvents.filter(event => event.kind === 6)
    : threadEvents

  return (
    <div ref={containerRef} className="max-w-2xl mx-auto relative">
      {/* Filter bar above the main thread view */}
      <div className="fixed z-50 bg-[#263238] border-b border-gray-600 px-4 py-2 flex gap-2" style={{ 
        top: '3.5rem', 
        height: '2.5rem',
        left: headerLeft || '0',
        width: headerWidth || '100%'
      }}>

      </div>
      
      {/* Fixed header bar below filter bar */}
      <div className="fixed z-50 bg-[#263238] border-b border-gray-600 px-4 py-2 text-sm text-gray-400 flex items-center justify-between" style={{ 
        top: '6rem', 
        height: '2.5rem',
        left: headerLeft || '0',
        width: headerWidth || '100%'
      }}>
        <span className="text-gray-300">
          Thread • {filteredEvents.length} {filteredEvents.length === 1 ? 'note' : 'notes'}
        </span>
        <div className="flex items-center gap-2">
          {/* Up arrow scroll to top button */}
          <button
            onClick={handleScrollToTop}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors rounded-full flex items-center justify-center"
            style={{ width: '2em', height: '2em' }}
            title="Scroll to top"
            aria-label="Scroll to top"
          >
            ↑
          </button>
          {/* X button moved into header bar */}
          {onClose && (
            <button
              onClick={onClose}
              className="bg-black bg-opacity-70 text-white hover:bg-opacity-90 transition-colors rounded-full flex items-center justify-center"
              style={{ width: '2em', height: '2em' }}
              title="Close thread view"
              aria-label="Close thread view"
            >
              X
            </button>
          )}
        </div>
      </div>
      
      {/* Add top padding to account for fixed headers (filter bar + header bar) */}
      <div className="pt-20">
      
      {filteredEvents.map((event, index) => {
        const isFocused = event.id === focusedEventId
        const isFirstFocused = isFocused && index === 0
        const isLastFocused = isFocused && index === filteredEvents.length - 1
        
        return (
          <div 
            key={event.id}
            ref={(el) => {
              if (isFocused) {
                focusedNoteRefs.current[event.id] = el
              }
            }}
            className={`
              transition-all duration-200 
              ${isFocused ? 'bg-blue-500/10' : 'hover:bg-black/5'}
              ${!isFirstFocused ? '' : ''}
            `}
          >
            <NoteCard
              event={event}
              userMetadata={eventMetadata[event.pubkey]}
              onNoteClick={handleThreadNoteClick}
              isInThreadView={true}
              onFocusNote={handleFocusNote}
            />
            
            {/* Thread connection line for non-last items */}
            {index < threadEvents.length - 1 && (
              <div className="ml-8 h-4 -mb-2"></div>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}

export default ThreadView