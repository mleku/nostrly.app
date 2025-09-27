import { NDKEvent } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'

export function getParentETag(event?: NDKEvent) {
  if (!event) return undefined

  // For kind 1 (short text notes), look for reply marker first
  if (event.kind === 1) {
    let tag = event.tags.find(([tagName, , , marker]: string[]) => {
      return tagName === 'e' && marker === 'reply'
    })
    if (!tag) {
      // Fallback to last e-tag that's not a mention
      const eTags = event.tags.filter(
        ([tagName, tagValue, , marker]: string[]) =>
          tagName === 'e' &&
          !!tagValue &&
          marker !== 'mention'
      )
      tag = eTags[eTags.length - 1]
    }
    return tag
  }

  return undefined
}

export function getParentEventHexId(event?: NDKEvent) {
  const tag = getParentETag(event)
  return tag?.[1]
}

export function getParentBech32Id(event?: NDKEvent) {
  const eTag = getParentETag(event)
  if (!eTag) return undefined

  try {
    const eventId = eTag[1]
    if (!eventId) return undefined
    return nip19.noteEncode(eventId)
  } catch {
    return undefined
  }
}

export function getRootETag(event?: NDKEvent) {
  if (!event) return undefined

  if (event.kind === 1) {
    let tag = event.tags.find(([tagName, , , marker]: string[]) => {
      return tagName === 'e' && marker === 'root'
    })
    if (!tag) {
      // Fallback to first e-tag
      tag = event.tags.find(
        ([tagName, tagValue]: string[]) => tagName === 'e' && !!tagValue
      )
    }
    return tag
  }

  return undefined
}

export function getRootEventHexId(event?: NDKEvent) {
  const tag = getRootETag(event)
  return tag?.[1]
}

export function getRootBech32Id(event?: NDKEvent) {
  const eTag = getRootETag(event)
  if (!eTag) return undefined

  try {
    const eventId = eTag[1]
    if (!eventId) return undefined
    return nip19.noteEncode(eventId)
  } catch {
    return undefined
  }
}