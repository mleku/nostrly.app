import React, { useState, useEffect } from 'react'
import { NostrEvent, UserMetadata, nostrService } from '../lib/nostr'
import MediaModal from './MediaModal'
import { linkifyContent, MediaType, extractMediaLinks } from '../utils/mediaUtils'
import { NostrReference, fetchReferencedEvent } from '../utils/nostrUtils'

interface NoteCardProps {
  event: NostrEvent
  userMetadata?: UserMetadata | null
  onNoteClick?: (event: NostrEvent, metadata?: UserMetadata | null) => void
  onUserClick?: (pubkey: string, metadata?: UserMetadata | null) => void
  isInThreadView?: boolean
  onFocusNote?: (eventId: string) => void
}

const NoteCard: React.FC<NoteCardProps> = ({ event, userMetadata, onNoteClick, onUserClick, isInThreadView = false, onFocusNote }) => {
  const [showJson, setShowJson] = useState(false)
  const [reactions, setReactions] = useState<NostrEvent[]>([])
  const [loadingReactions, setLoadingReactions] = useState(false)
  const [repostedEventMetadata, setRepostedEventMetadata] = useState<UserMetadata | null>(null)
  const [mediaModal, setMediaModal] = useState<{ 
    isOpen: boolean; 
    src: string; 
    type: MediaType; 
    alt: string;
    mediaItems?: { url: string; type: MediaType }[];
    currentIndex?: number;
  }>({
    isOpen: false,
    src: '',
    type: 'image',
    alt: '',
    mediaItems: undefined,
    currentIndex: 0
  })
  const [fetchedNostrEvents, setFetchedNostrEvents] = useState<Record<string, { event: NostrEvent | null; loading: boolean; metadata?: UserMetadata | null }>>({})
  const [expandedNostrRefs, setExpandedNostrRefs] = useState<Set<string>>(new Set())

  // Parse reposted event for kind 6 events
  const getRepostedEvent = (): NostrEvent | null => {
    if (event.kind !== 6 || !event.content.trim()) return null
    
    try {
      const repostedEvent = JSON.parse(event.content) as NostrEvent
      // Validate that it looks like a valid Nostr event
      if (repostedEvent.id && repostedEvent.pubkey && repostedEvent.created_at && 
          typeof repostedEvent.kind === 'number' && repostedEvent.content !== undefined) {
        return repostedEvent
      }
    } catch (error) {
      console.warn('Failed to parse reposted event JSON:', error)
    }
    return null
  }

  // Fetch reactions for this event
  useEffect(() => {
    const fetchReactions = async () => {
      setLoadingReactions(true)
      try {
        const eventReactions = await nostrService.fetchReactions(event.id)
        setReactions(eventReactions)
      } catch (error) {
        console.error('Failed to fetch reactions:', error)
      } finally {
        setLoadingReactions(false)
      }
    }

    fetchReactions()
  }, [event.id])

  // Fetch metadata for reposted event author
  useEffect(() => {
    const repostedEvent = getRepostedEvent()
    if (repostedEvent && repostedEvent.pubkey) {
      const fetchRepostedMetadata = async () => {
        try {
          const metadata = await nostrService.fetchUserMetadata(repostedEvent.pubkey)
          setRepostedEventMetadata(metadata)
        } catch (error) {
          console.error('Failed to fetch reposted event metadata:', error)
        }
      }
      fetchRepostedMetadata()
    }
  }, [event.content, event.kind])

  // Group reactions by content
  const groupedReactions = reactions.reduce((acc, reaction) => {
    const content = reaction.content || '❤️' // Default to heart if no content
    if (!acc[content]) {
      acc[content] = []
    }
    acc[content].push(reaction)
    return acc
  }, {} as Record<string, NostrEvent[]>)
  
  // Extract user info from metadata or fallback to pubkey
  const username = userMetadata?.display_name || userMetadata?.name || `${event.pubkey.slice(0, 8)}...`
  const avatarUrl = userMetadata?.picture
  const bannerUrl = userMetadata?.banner
  
  // Format timestamp
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMinutes = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    
    if (diffMinutes < 1) return 'now'
    if (diffMinutes < 60) return `${diffMinutes}m`
    if (diffHours < 24) return `${diffHours}h`
    if (diffDays < 7) return `${diffDays}d`
    return date.toLocaleDateString()
  }
  
  // Get event kind display name
  const getKindName = (kind: number) => {
    switch (kind) {
      case 1: return 'Text Note'
      case 6: return 'Repost'
      case 7: return 'Reaction'
      case 111: return 'Long-form Article'
      default: return `Kind ${kind}`
    }
  }

  // Check if this note is a reply and get the replied-to event ID
  const getRepliedToEventId = (): string | null => {
    // Look for e tags in the event
    const eTags = event.tags.filter(tag => tag[0] === 'e' && tag[1])
    if (eTags.length === 0) return null
    
    // For replies, typically the first e tag or the one marked as "reply" is the replied-to event
    // If there's only one e tag, it's likely the replied-to event
    if (eTags.length === 1) {
      return eTags[0][1]
    }
    
    // If multiple e tags, look for one marked as "reply" (NIP-10)
    const replyTag = eTags.find(tag => tag[3] === 'reply')
    if (replyTag) {
      return replyTag[1]
    }
    
    // Fallback to the last e tag (common convention for replies)
    return eTags[eTags.length - 1][1]
  }
  
  const handleReact = () => {
    console.log('React clicked for event:', event.id)
  }
  
  const handleQuote = () => {
    console.log('Quote clicked for event:', event.id)
  }
  
  const handleRepost = () => {
    console.log('Repost clicked for event:', event.id)
  }
  
  const handleReply = () => {
    console.log('Reply clicked for event:', event.id)
  }

  const handleMediaClick = (url: string, type: MediaType) => {
    // Extract all media items from the event content
    const mediaLinks = extractMediaLinks(event.content)
    const mediaItems = mediaLinks.map(link => ({
      url: link.url,
      type: link.type as MediaType
    }))
    
    // Find the index of the clicked media item
    const currentIndex = mediaItems.findIndex(item => item.url === url)
    
    setMediaModal({
      isOpen: true,
      src: url,
      type,
      alt: `Media from ${username}`,
      mediaItems: mediaItems.length > 1 ? mediaItems : undefined,
      currentIndex: currentIndex >= 0 ? currentIndex : 0
    })
  }

  const closeMediaModal = () => {
    setMediaModal(prev => ({ ...prev, isOpen: false }))
  }

  const handleNostrClick = async (reference: NostrReference) => {
    const identifier = reference.identifier
    
    // Toggle expansion state
    const newExpanded = new Set(expandedNostrRefs)
    if (newExpanded.has(identifier)) {
      newExpanded.delete(identifier)
      setExpandedNostrRefs(newExpanded)
      return
    }
    
    newExpanded.add(identifier)
    setExpandedNostrRefs(newExpanded)
    
    // If already fetched, don't fetch again
    if (fetchedNostrEvents[identifier]) {
      return
    }
    
    // Set loading state
    setFetchedNostrEvents(prev => ({
      ...prev,
      [identifier]: { event: null, loading: true }
    }))
    
    try {
      // Fetch the referenced event
      const referencedEvent = await fetchReferencedEvent(reference)
      
      if (referencedEvent) {
        // Fetch metadata for the event author
        const metadata = await nostrService.fetchUserMetadata(referencedEvent.pubkey)
        
        setFetchedNostrEvents(prev => ({
          ...prev,
          [identifier]: { event: referencedEvent, loading: false, metadata }
        }))
      } else {
        setFetchedNostrEvents(prev => ({
          ...prev,
          [identifier]: { event: null, loading: false }
        }))
      }
    } catch (error) {
      console.error('Failed to fetch nostr event:', error)
      setFetchedNostrEvents(prev => ({
        ...prev,
        [identifier]: { event: null, loading: false }
      }))
    }
  }

  const repostedEvent = getRepostedEvent()

  return (
    <div 
      className="p-4 hover:bg-black/10 cursor-pointer transition-colors"
      onMouseEnter={(e) => e.stopPropagation()}
      onMouseLeave={(e) => e.stopPropagation()}
      onClick={() => onNoteClick?.(event, userMetadata)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          {/* Avatar */}
          <div 
            className="w-10 h-10 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 flex-shrink-0 cursor-pointer hover:opacity-80"
            onClick={(e) => {
              e.stopPropagation();
              onUserClick?.(event.pubkey, userMetadata);
            }}
          >
            {avatarUrl ? (
              <img 
                src={avatarUrl} 
                alt={`${username}'s avatar`}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextElementSibling!.style.display = 'flex'
                }}
              />
            ) : null}
            <div 
              className="w-full h-full flex items-center justify-center text-gray-600 dark:text-gray-300 font-semibold"
              style={{ display: avatarUrl ? 'none' : 'flex' }}
            >
              {username.charAt(0).toUpperCase()}
            </div>
          </div>
          
          {/* Username and timestamp */}
          <div>
            <div 
              className="font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onUserClick?.(event.pubkey, userMetadata);
              }}
            >
              {username}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {formatTimestamp(event.created_at)} · {getKindName(event.kind)}
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Replied to button */}
          {getRepliedToEventId() && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const repliedToId = getRepliedToEventId();
                if (repliedToId) {
                  if (isInThreadView && onFocusNote) {
                    // In thread view, just focus on the replied-to note within current thread
                    onFocusNote(repliedToId);
                  } else if (onNoteClick) {
                    // Outside thread view, open the thread for the replied-to event
                    try {
                      const repliedToEvent = await nostrService.fetchEventById(repliedToId);
                      if (repliedToEvent) {
                        const repliedToMetadata = await nostrService.fetchUserMetadata(repliedToEvent.pubkey);
                        onNoteClick(repliedToEvent, repliedToMetadata);
                      } else {
                        console.warn('Could not fetch replied-to event:', repliedToId);
                      }
                    } catch (error) {
                      console.error('Error fetching replied-to event:', error);
                    }
                  }
                }
              }}
              className="text-sm text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 transition-colors px-2 py-1 rounded hover:bg-green-50 dark:hover:bg-green-900/20"
              title="View replied-to note"
            >
              ↳
            </button>
          )}
          
          {/* JSON view button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowJson(!showJson);
            }}
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            {showJson ? 'Hide' : '{}'}
          </button>
        </div>
      </div>
      
      {/* JSON view */}
      {showJson && (
        <div className="mb-3 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-auto">
          <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      )}
      
      {/* Content */}
      <div className="mb-4 text-gray-900 dark:text-gray-100 whitespace-pre-wrap" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
        {repostedEvent ? (
          <div className="mt-2">
            {/* Repost indicator */}
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-2 flex items-center">
              <span className="text-lg mr-1">🔄</span>
              <span>Reposted</span>
            </div>
            
            {/* Nested NoteCard for reposted content */}
            <div className="rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50">
              <NoteCard 
                event={repostedEvent} 
                userMetadata={repostedEventMetadata} 
                onNoteClick={onNoteClick}
              />
            </div>
          </div>
        ) : (
          <div>
            {linkifyContent(event.content, handleMediaClick, handleNostrClick, onUserClick)}
            
            {/* Render embedded nostr events */}
            {Array.from(expandedNostrRefs).map(identifier => {
              const fetchedData = fetchedNostrEvents[identifier]
              if (!fetchedData) return null
              
              return (
                <div key={identifier} className="mt-4 pl-4">
                  {fetchedData.loading && (
                    <div className="text-sm text-gray-500 dark:text-gray-400 italic">
                      Loading referenced event...
                    </div>
                  )}
                  {!fetchedData.loading && !fetchedData.event && (
                    <div className="text-sm text-red-500 dark:text-red-400 italic">
                      Failed to load referenced event
                    </div>
                  )}
                  {!fetchedData.loading && fetchedData.event && (
                    <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3">
                      <NoteCard 
                        event={fetchedData.event} 
                        userMetadata={fetchedData.metadata} 
                        onNoteClick={onNoteClick}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      
      {/* React and reaction buttons row */}
      <div className="flex items-center flex-wrap gap-6 text-gray-500 dark:text-gray-400 mb-2">
        {/* Reaction buttons from existing reactions */}
        {Object.entries(groupedReactions).map(([content, reactionList]) => (
          <button
            key={content}
            className="flex items-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors p-0 rounded"
            onClick={(e) => {
              e.stopPropagation();
              console.log('Reaction clicked:', content, reactionList);
            }}
          >
            <span className="text-lg">{content}</span>
            {reactionList.length > 1 && (
              <span className="text-sm font-medium">{reactionList.length}</span>
            )}
          </button>
        ))}
      </div>
      
      {/* Quote, repost and reply buttons row - right justified */}
      <div className="flex items-center justify-end text-gray-500 dark:text-gray-400">
        <button
            onClick={(e) => {
              e.stopPropagation();
              handleReact();
            }}
            className="flex items-center hover:text-red-500 transition-colors"
        >
          <span className="text-lg">❤️</span>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            handleQuote();
          }}
          className="flex items-center hover:text-blue-500 transition-colors"
        >
          <span className="text-lg">💬</span>
        </button>
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRepost();
          }}
          className="flex items-center hover:text-green-500 transition-colors"
        >
          <span className="text-lg">🔄</span>
        </button>
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleReply();
          }}
          className="flex items-center hover:text-blue-500 transition-colors"
        >
          <span className="text-lg">↩️</span>
        </button>
      </div>

      {/* Media Modal */}
      <MediaModal
        src={mediaModal.src}
        alt={mediaModal.alt}
        isOpen={mediaModal.isOpen}
        onClose={closeMediaModal}
        mediaType={mediaModal.type}
        mediaItems={mediaModal.mediaItems}
        currentIndex={mediaModal.currentIndex}
      />
    </div>
  )
}

export default NoteCard