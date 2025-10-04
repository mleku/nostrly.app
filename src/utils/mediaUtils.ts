// Supported media file extensions
export const MEDIA_EXTENSIONS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
  video: ['mp4', 'webm', 'ogg', 'avi', 'mov', 'm4v', '3gp', 'mkv'],
  audio: ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'wma']
} as const

export type MediaType = keyof typeof MEDIA_EXTENSIONS

export interface MediaLink {
  url: string
  type: MediaType
  startIndex: number
  endIndex: number
}

/**
 * Get the media type for a given URL based on file extension
 */
export function getMediaType(url: string): MediaType | null {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.toLowerCase()
    const extension = pathname.split('.').pop()
    
    if (!extension) return null
    
    for (const [type, extensions] of Object.entries(MEDIA_EXTENSIONS)) {
      if (extensions.includes(extension as any)) {
        return type as MediaType
      }
    }
    
    return null
  } catch {
    return null
  }
}

/**
 * Check if a URL is a media URL
 */
export function isMediaUrl(url: string): boolean {
  return getMediaType(url) !== null
}

/**
 * Extract all media links from text content
 */
export function extractMediaLinks(content: string): MediaLink[] {
  const mediaLinks: MediaLink[] = []
  
  // Regular expression to match URLs
  const urlRegex = /https?:\/\/[^\s<>"]+/gi
  let match
  
  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[0]
    const mediaType = getMediaType(url)
    
    if (mediaType) {
      mediaLinks.push({
        url,
        type: mediaType,
        startIndex: match.index,
        endIndex: match.index + url.length
      })
    }
  }
  
  return mediaLinks
}

/**
 * Replace media URLs in content with clickable links
 */
export function linkifyMediaUrls(
  content: string,
  onMediaClick: (url: string, type: MediaType) => void
): React.ReactNode[] {
  const mediaLinks = extractMediaLinks(content)
  
  if (mediaLinks.length === 0) {
    return [content]
  }
  
  const elements: React.ReactNode[] = []
  let lastIndex = 0
  
  mediaLinks.forEach((link, index) => {
    // Add text before the media link
    if (link.startIndex > lastIndex) {
      elements.push(content.slice(lastIndex, link.startIndex))
    }
    
    // Add the media link as a clickable element
    elements.push(
      React.createElement(
        'button',
        {
          key: `media-${index}`,
          className: 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 underline cursor-pointer bg-transparent border-none p-0 font-inherit',
          onClick: (e: React.MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()
            onMediaClick(link.url, link.type)
          },
          title: `Open ${link.type}: ${link.url}`
        },
        `📎 ${getMediaDisplayText(link.type)}`
      )
    )
    
    lastIndex = link.endIndex
  })
  
  // Add any remaining text after the last media link
  if (lastIndex < content.length) {
    elements.push(content.slice(lastIndex))
  }
  
  return elements
}

/**
 * Get display text for media type
 */
function getMediaDisplayText(type: MediaType): string {
  switch (type) {
    case 'image': return 'Image'
    case 'video': return 'Video'
    case 'audio': return 'Audio'
    default: return 'Media'
  }
}

/**
 * Extract filename from URL
 */
function getFileNameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const filename = pathname.split('/').pop() || 'file'
    return filename
  } catch {
    return 'file'
  }
}

// Import React for createElement
import React, { useState, useEffect } from 'react'
import { extractNostrReferences, NostrReference, fetchNpubMetadata, fetchNprofileMetadata, fetchReferencedEvent } from './nostrUtils'
import { UserMetadata, NostrEvent, nostrService } from '../lib/nostr'

/**
 * Component to render a user profile link with avatar and username
 */
const UserProfileLink: React.FC<{ 
  reference: NostrReference; 
  index: number; 
  onUserClick?: (pubkey: string, metadata?: UserMetadata | null) => void;
}> = ({ reference, index, onUserClick }) => {
  const [metadata, setMetadata] = useState<UserMetadata | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        let userMetadata = null
        if (reference.type === 'npub') {
          userMetadata = await fetchNpubMetadata(reference)
        } else if (reference.type === 'nprofile') {
          userMetadata = await fetchNprofileMetadata(reference)
        }
        setMetadata(userMetadata)
      } catch (error) {
        console.error('Failed to fetch user metadata:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchMetadata()
  }, [reference])

  if (loading) {
    return React.createElement(
      'span',
      {
        key: `profile-loading-${index}`,
        className: 'inline-flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400'
      },
      React.createElement('div', {
        className: 'w-4 h-4 bg-gray-300 dark:bg-gray-600 rounded-full animate-pulse'
      }),
      React.createElement('span', null, 'Loading...')
    )
  }

  const username = metadata?.display_name || metadata?.name || (reference.pubkey ? `${reference.pubkey.slice(0, 8)}...` : 'Unknown')
  const avatarUrl = metadata?.picture

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onUserClick && reference.pubkey) {
      onUserClick(reference.pubkey, metadata)
    }
  }

  return React.createElement(
    'button',
    {
      key: `profile-${index}`,
      className: 'inline-flex items-center space-x-2 text-sm text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200 cursor-pointer bg-transparent border-none p-0 font-inherit',
      title: `Profile: ${username}`,
      onClick: handleClick
    },
    React.createElement(
      'div',
      {
        className: 'w-4 h-4 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 flex-shrink-0'
      },
      avatarUrl ? React.createElement('img', {
        src: avatarUrl,
        alt: `${username}'s avatar`,
        className: 'w-full h-full object-cover',
        onError: (e: any) => {
          e.currentTarget.style.display = 'none'
          if (e.currentTarget.nextElementSibling) {
            e.currentTarget.nextElementSibling.style.display = 'flex'
          }
        }
      }) : null,
      React.createElement(
        'div',
        {
          className: 'w-full h-full flex items-center justify-center text-gray-600 dark:text-gray-300 font-semibold text-xs',
          style: { display: avatarUrl ? 'none' : 'flex' }
        },
        username.charAt(0).toUpperCase()
      )
    ),
    React.createElement('span', { className: 'font-medium' }, username)
  )
}

/**
 * Component to render an embedded note inline in a box
 */
const EmbeddedNote: React.FC<{ reference: NostrReference; index: number }> = ({ reference, index }) => {
  const [noteEvent, setNoteEvent] = useState<NostrEvent | null>(null)
  const [authorMetadata, setAuthorMetadata] = useState<UserMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reactions, setReactions] = useState<NostrEvent[]>([])
  const [loadingReactions, setLoadingReactions] = useState(false)

  useEffect(() => {
    const fetchNote = async () => {
      try {
        setLoading(true)
        setError(null)
        
        // Fetch the referenced event (works for both note and nevent)
        const event = await fetchReferencedEvent(reference)
        if (!event) {
          setError('Note not found')
          return
        }
        
        setNoteEvent(event)
        
        // Fetch author metadata
        const metadata = await nostrService.fetchUserMetadata(event.pubkey)
        setAuthorMetadata(metadata)
        
        // Fetch reactions for this event
        setLoadingReactions(true)
        try {
          const eventReactions = await nostrService.fetchReactions(event.id)
          setReactions(eventReactions)
        } catch (error) {
          console.error('Failed to fetch reactions:', error)
        } finally {
          setLoadingReactions(false)
        }
      } catch (err) {
        console.error('Failed to fetch note:', err)
        setError('Failed to load note')
      } finally {
        setLoading(false)
      }
    }

    fetchNote()
  }, [reference])
  
  // Interaction handlers
  const handleReact = () => {
    if (noteEvent) {
      console.log('React clicked for embedded event:', noteEvent.id)
    }
  }
  
  const handleQuote = () => {
    if (noteEvent) {
      console.log('Quote clicked for embedded event:', noteEvent.id)
    }
  }
  
  const handleRepost = () => {
    if (noteEvent) {
      console.log('Repost clicked for embedded event:', noteEvent.id)
    }
  }
  
  const handleReply = () => {
    if (noteEvent) {
      console.log('Reply clicked for embedded event:', noteEvent.id)
    }
  }

  if (loading) {
    return React.createElement(
      'div',
      {
        key: `note-loading-${index}`,
        className: 'my-2 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50'
      },
      React.createElement('div', {
        className: 'animate-pulse flex space-x-3'
      }, 
        React.createElement('div', {
          className: 'w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded-full'
        }),
        React.createElement('div', {
          className: 'flex-1 space-y-2'
        },
          React.createElement('div', {
            className: 'h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/4'
          }),
          React.createElement('div', {
            className: 'h-4 bg-gray-300 dark:bg-gray-600 rounded w-3/4'
          })
        )
      ),
      React.createElement('div', {
        className: 'text-xs text-gray-500 dark:text-gray-400 mt-2'
      }, 'Loading note...')
    )
  }

  if (error || !noteEvent) {
    return React.createElement(
      'div',
      {
        key: `note-error-${index}`,
        className: 'my-2 p-3 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-900/20'
      },
      React.createElement('div', {
        className: 'text-sm text-red-600 dark:text-red-400'
      }, error || 'Failed to load note')
    )
  }

  const username = authorMetadata?.display_name || authorMetadata?.name || `${noteEvent.pubkey.slice(0, 8)}...`
  const avatarUrl = authorMetadata?.picture
  const timestamp = new Date(noteEvent.created_at * 1000)
  const timeAgo = getRelativeTime(timestamp)
  
  // Group reactions by content
  const groupedReactions = reactions.reduce((acc, reaction) => {
    const content = reaction.content || '❤️' // Default to heart if no content
    if (!acc[content]) {
      acc[content] = []
    }
    acc[content].push(reaction)
    return acc
  }, {} as Record<string, NostrEvent[]>)

  return React.createElement(
    'div',
    {
      key: `embedded-note-${index}`,
      className: 'my-2 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 max-w-full'
    },
    // Header with avatar and username
    React.createElement(
      'div',
      {
        className: 'flex items-center space-x-2 mb-2'
      },
      React.createElement(
        'div',
        {
          className: 'w-6 h-6 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 flex-shrink-0'
        },
        avatarUrl ? React.createElement('img', {
          src: avatarUrl,
          alt: `${username}'s avatar`,
          className: 'w-full h-full object-cover',
          onError: (e: any) => {
            e.currentTarget.style.display = 'none'
            if (e.currentTarget.nextElementSibling) {
              e.currentTarget.nextElementSibling.style.display = 'flex'
            }
          }
        }) : null,
        React.createElement(
          'div',
          {
            className: 'w-full h-full flex items-center justify-center text-gray-600 dark:text-gray-300 font-semibold text-xs',
            style: { display: avatarUrl ? 'none' : 'flex' }
          },
          username.charAt(0).toUpperCase()
        )
      ),
      React.createElement(
        'div',
        {
          className: 'flex-1 min-w-0'
        },
        React.createElement('div', {
          className: 'font-medium text-sm text-gray-900 dark:text-gray-100 truncate'
        }, username),
        React.createElement('div', {
          className: 'text-xs text-gray-500 dark:text-gray-400'
        }, timeAgo)
      )
    ),
    // Note content
    React.createElement(
      'div',
      {
        className: 'text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words mb-3'
      },
      ...linkifyContent(
        noteEvent.content,
        (url: string, type: MediaType) => {
          console.log('Media clicked in embedded note:', url, type)
        },
        (reference: NostrReference) => {
          console.log('Nostr reference clicked in embedded note:', reference)
        }
      )
    ),
    // Reaction buttons row
    React.createElement(
      'div',
      {
        className: 'flex items-center flex-wrap gap-4 text-gray-500 dark:text-gray-400 mb-2'
      },
      ...Object.entries(groupedReactions).map(([content, reactionList]) =>
        React.createElement(
          'button',
          {
            key: content,
            className: 'flex items-center space-x-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors p-1 rounded text-xs',
            onClick: () => console.log('Reaction clicked:', content, reactionList)
          },
          React.createElement('span', { className: 'text-sm' }, content),
          reactionList.length > 1 && React.createElement('span', { className: 'text-xs font-medium' }, reactionList.length)
        )
      )
    ),
    // Action buttons row
    React.createElement(
      'div',
      {
        className: 'flex items-center justify-end space-x-4 text-gray-500 dark:text-gray-400'
      },
      React.createElement(
        'button',
        {
          onClick: handleReact,
          className: 'flex items-center space-x-1 hover:text-red-500 transition-colors text-sm'
        },
        React.createElement('span', { className: 'text-base' }, '❤️')
      ),
      React.createElement(
        'button',
        {
          onClick: handleQuote,
          className: 'flex items-center space-x-1 hover:text-blue-500 transition-colors text-sm'
        },
        React.createElement('span', { className: 'text-base' }, '💬')
      ),
      React.createElement(
        'button',
        {
          onClick: handleRepost,
          className: 'flex items-center space-x-1 hover:text-green-500 transition-colors text-sm'
        },
        React.createElement('span', { className: 'text-base' }, '🔄')
      ),
      React.createElement(
        'button',
        {
          onClick: handleReply,
          className: 'flex items-center space-x-1 hover:text-blue-500 transition-colors text-sm'
        },
        React.createElement('span', { className: 'text-base' }, '↩️')
      )
    )
  )
}

/**
 * Get relative time string
 */
function getRelativeTime(date: Date): string {
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

export interface ContentLink {
  type: 'media' | 'nostr' | 'url'
  startIndex: number
  endIndex: number
  data: MediaLink | NostrReference | { url: string }
}

/**
 * Extract regular web URLs that are not media URLs
 */
export function extractWebUrls(content: string): { url: string; startIndex: number; endIndex: number }[] {
  const webUrls: { url: string; startIndex: number; endIndex: number }[] = []
  
  // Regular expression to match URLs
  const urlRegex = /https?:\/\/[^\s<>"]+/gi
  let match
  
  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[0]
    
    // Only include URLs that are not media URLs
    if (!isMediaUrl(url)) {
      webUrls.push({
        url,
        startIndex: match.index,
        endIndex: match.index + url.length
      })
    }
  }
  
  return webUrls
}

/**
 * Process content to extract both media URLs and nostr references
 */
export function extractAllLinks(content: string): ContentLink[] {
  const mediaLinks = extractMediaLinks(content)
  const nostrRefs = extractNostrReferences(content)
  const webUrls = extractWebUrls(content)
  
  const allLinks: ContentLink[] = [
    ...mediaLinks.map(link => ({
      type: 'media' as const,
      startIndex: link.startIndex,
      endIndex: link.endIndex,
      data: link
    })),
    ...nostrRefs.map(ref => ({
      type: 'nostr' as const,
      startIndex: ref.startIndex,
      endIndex: ref.endIndex,
      data: ref
    })),
    ...webUrls.map(url => ({
      type: 'url' as const,
      startIndex: url.startIndex,
      endIndex: url.endIndex,
      data: { url: url.url }
    }))
  ]
  
  // Sort by start index to process in order
  return allLinks.sort((a, b) => a.startIndex - b.startIndex)
}

/**
 * Replace both media URLs and nostr references in content with appropriate elements
 */
export function linkifyContent(
  content: string,
  onMediaClick: (url: string, type: MediaType) => void,
  onNostrClick: (reference: NostrReference) => void,
  onUserClick?: (pubkey: string, metadata?: UserMetadata | null) => void
): React.ReactNode[] {
  const allLinks = extractAllLinks(content)
  
  if (allLinks.length === 0) {
    return [content]
  }
  
  const elements: React.ReactNode[] = []
  let lastIndex = 0
  
  allLinks.forEach((link, index) => {
    // Add text before the link
    if (link.startIndex > lastIndex) {
      elements.push(content.slice(lastIndex, link.startIndex))
    }
    
    if (link.type === 'media') {
      const mediaLink = link.data as MediaLink
      // Add the media link as a clickable element
      elements.push(
        React.createElement(
          'button',
          {
            key: `media-${index}`,
            className: 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 underline cursor-pointer bg-transparent border-none p-0 font-inherit',
            onClick: (e: React.MouseEvent) => {
              e.preventDefault()
              e.stopPropagation()
              onMediaClick(mediaLink.url, mediaLink.type)
            },
            title: `Open ${mediaLink.type}: ${mediaLink.url}`
          },
          `📎 ${getMediaDisplayText(mediaLink.type)}`
        )
      )
    } else if (link.type === 'nostr') {
      const nostrRef = link.data as NostrReference
      
      // Render user profile links (npub/nprofile) with avatar and username
      if (nostrRef.type === 'npub' || nostrRef.type === 'nprofile') {
        elements.push(
          React.createElement(UserProfileLink, {
            key: `profile-${index}`,
            reference: nostrRef,
            index: index,
            onUserClick: onUserClick
          })
        )
      } else if (nostrRef.type === 'note' || nostrRef.type === 'nevent') {
        // Render note and nevent references as embedded inline components
        elements.push(
          React.createElement(EmbeddedNote, {
            key: `embedded-note-${index}`,
            reference: nostrRef,
            index: index
          })
        )
      } else {
        // Add other nostr references (naddr) as clickable buttons
        elements.push(
          React.createElement(
            'button',
            {
              key: `nostr-${index}`,
              className: 'text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200 underline cursor-pointer bg-transparent border-none p-0 font-inherit',
              onClick: (e: React.MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
                onNostrClick(nostrRef)
              },
              title: `Load ${nostrRef.type}: ${nostrRef.identifier}`
            },
            `🔗 Article`
          )
        )
      }
    } else if (link.type === 'url') {
      const urlData = link.data as { url: string }
      // Add regular URL as clickable link that opens in new tab
      elements.push(
        React.createElement(
          'a',
          {
            key: `url-${index}`,
            href: urlData.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 underline',
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation()
            },
            title: `Open link: ${urlData.url}`
          },
          urlData.url
        )
      )
    }
    
    lastIndex = link.endIndex
  })
  
  // Add any remaining text after the last link
  if (lastIndex < content.length) {
    elements.push(content.slice(lastIndex))
  }
  
  return elements
}