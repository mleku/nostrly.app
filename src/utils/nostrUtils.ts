import { nip19 } from 'nostr-tools'
import { nostrService, NostrEvent } from '../lib/nostr'

export interface NostrReference {
  identifier: string
  type: 'nevent' | 'naddr' | 'npub' | 'nprofile' | 'note'
  startIndex: number
  endIndex: number
  eventId?: string
  author?: string
  kind?: number
  dTag?: string
  pubkey?: string // For npub and nprofile references
  relays?: string[] // For nprofile references
}

/**
 * Extract nostr:nevent, nostr:naddr, nostr:npub, nostr:nprofile, and nostr:note identifiers from text content
 */
export function extractNostrReferences(content: string): NostrReference[] {
  const references: NostrReference[] = []
  
  // Regular expression to match nostr:nevent, nostr:naddr, nostr:npub, nostr:nprofile, and nostr:note identifiers
  const nostrRegex = /nostr:(nevent1[a-zA-Z0-9]+|naddr1[a-zA-Z0-9]+|npub1[a-zA-Z0-9]+|nprofile1[a-zA-Z0-9]+|note1[a-zA-Z0-9]+)/g
  let match
  
  while ((match = nostrRegex.exec(content)) !== null) {
    const fullIdentifier = match[0] // e.g., "nostr:nevent1..."
    const identifier = match[1] // e.g., "nevent1..."
    const type = identifier.startsWith('nevent1') ? 'nevent' : 
                 identifier.startsWith('naddr1') ? 'naddr' :
                 identifier.startsWith('nprofile1') ? 'nprofile' : 
                 identifier.startsWith('note1') ? 'note' : 'npub'
    
    try {
      // Decode the identifier to get metadata
      let eventId: string | undefined
      let author: string | undefined
      let kind: number | undefined
      let dTag: string | undefined
      let pubkey: string | undefined
      let relays: string[] | undefined
      
      if (type === 'nevent') {
        const decoded = nip19.decode(identifier)
        if (decoded.type === 'nevent') {
          eventId = decoded.data.id
          author = decoded.data.author
          kind = decoded.data.kind
        }
      } else if (type === 'naddr') {
        const decoded = nip19.decode(identifier)
        if (decoded.type === 'naddr') {
          author = decoded.data.pubkey
          kind = decoded.data.kind
          dTag = decoded.data.identifier
        }
      } else if (type === 'npub') {
        const decoded = nip19.decode(identifier)
        if (decoded.type === 'npub') {
          pubkey = decoded.data
        }
      } else if (type === 'nprofile') {
        const decoded = nip19.decode(identifier)
        if (decoded.type === 'nprofile') {
          pubkey = decoded.data.pubkey
          relays = decoded.data.relays
        }
      } else if (type === 'note') {
        const decoded = nip19.decode(identifier)
        if (decoded.type === 'note') {
          eventId = decoded.data
        }
      }
      
      references.push({
        identifier: fullIdentifier,
        type,
        startIndex: match.index,
        endIndex: match.index + fullIdentifier.length,
        eventId,
        author,
        kind,
        dTag,
        pubkey,
        relays
      })
    } catch (error) {
      console.warn('Failed to decode nostr identifier:', identifier, error)
    }
  }
  
  return references
}

/**
 * Fetch event for a nevent reference
 */
export async function fetchNeventEvent(reference: NostrReference): Promise<NostrEvent | null> {
  if (reference.type !== 'nevent' || !reference.eventId) {
    return null
  }
  
  return await nostrService.fetchEventById(reference.eventId)
}

/**
 * Fetch event for an naddr reference (addressable events)
 */
export async function fetchNaddrEvent(reference: NostrReference): Promise<NostrEvent | null> {
  if (reference.type !== 'naddr' || !reference.author || !reference.kind) {
    return null
  }
  
  try {
    // For addressable events, we need to query by author, kind, and d tag
    const events = await nostrService.fetchEvents({
      authors: [reference.author],
      limit: 1
    })
    
    // Filter by kind and d tag if available
    const filteredEvents = events.filter(event => {
      if (event.kind !== reference.kind) return false
      
      if (reference.dTag !== undefined) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || ''
        return dTag === reference.dTag
      }
      
      return true
    })
    
    return filteredEvents[0] || null
  } catch (error) {
    console.error('Failed to fetch naddr event:', error)
    return null
  }
}

/**
 * Fetch user metadata for an npub reference
 */
export async function fetchNpubMetadata(reference: NostrReference): Promise<any | null> {
  if (reference.type !== 'npub' || !reference.pubkey) {
    return null
  }
  
  try {
    return await nostrService.fetchUserMetadata(reference.pubkey)
  } catch (error) {
    console.error('Failed to fetch npub metadata:', error)
    return null
  }
}

/**
 * Fetch user metadata for an nprofile reference
 */
export async function fetchNprofileMetadata(reference: NostrReference): Promise<any | null> {
  if (reference.type !== 'nprofile' || !reference.pubkey) {
    return null
  }
  
  try {
    return await nostrService.fetchUserMetadata(reference.pubkey)
  } catch (error) {
    console.error('Failed to fetch nprofile metadata:', error)
    return null
  }
}

/**
 * Fetch event for a note reference
 */
export async function fetchNoteEvent(reference: NostrReference): Promise<NostrEvent | null> {
  if (reference.type !== 'note' || !reference.eventId) {
    return null
  }
  
  return await nostrService.fetchEventById(reference.eventId)
}

/**
 * Fetch the referenced event for any nostr reference
 */
export async function fetchReferencedEvent(reference: NostrReference): Promise<NostrEvent | null> {
  if (reference.type === 'nevent') {
    return await fetchNeventEvent(reference)
  } else if (reference.type === 'naddr') {
    return await fetchNaddrEvent(reference)
  } else if (reference.type === 'note') {
    return await fetchNoteEvent(reference)
  }
  
  return null
}