import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query'
import { ndk, withTimeout, type LoggedInUser } from '@/lib/ndk'
import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { initializeNDK, getConnectionStatus } from '@/lib/ndk'
import { getRootEventHexId } from '@/lib/event'
import EmojiPicker, { type EmojiClickData, Theme } from 'emoji-picker-react'
import { NoteCard } from './note'

export const Route = createFileRoute('/')({
  component: Home,
})

type FeedMode = 'global' | 'user' | 'follows' | 'profile' | 'note' | 'hashtag' | 'notifications'

// Event kinds to include in feeds (global and user)
const FEED_KINDS: number[] = [1, 1111, 6, 7, 30023, 9802, 1068, 1222, 1244, 20, 21, 22]
// Event kinds for follows and hashtag feeds (excludes reactions)
const FEED_KINDS_NO_REACTIONS: number[] = [1, 1111, 6, 30023, 9802, 1068, 1222, 1244, 20, 21, 22]

type MediaType = 'image' | 'video'
type MediaItem = { url: string; type: MediaType }
// Gallery of media within a single note
export type MediaGallery = { items: MediaItem[]; index: number }

const URL_REGEX = /(https?:\/\/[^\s]+)/g
const NOSTR_REF_REGEX = /(nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+|nevent1[0-9a-z]+|note1[0-9a-z]+|naddr1[0-9a-z]+))/gi
// Using this regex inline where needed
// const HASHTAG_REGEX = /#[a-z0-9_]{1,64}/gi
const MEDIA_EXT_REGEX = /\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|webm|mov|m4v|avi|mkv)(?:\?.*)?$/i
function classifyMedia(url: string): MediaItem | null {
  if (!MEDIA_EXT_REGEX.test(url)) return null
  const isVideo = /\.(mp4|webm|mov|m4v|avi|mkv)(?:\?.*)?$/i.test(url)
  return { url, type: isVideo ? 'video' : 'image' }
}

function extractHashtagTags(tags?: any[]): string[] {
  try {
    const list = (tags || []).filter(t => t && t[0] === 't' && typeof t[1] === 'string').map(t => String(t[1]).toLowerCase())
    return Array.from(new Set(list))
  } catch {
    return []
  }
}

function renderMarkdownInline(text: string, keyPrefix: string) {
  // Simple, safe inline Markdown: **bold**, *italic* or _italic_, `code`, ~~strike~~, [label](url)
  // We avoid HTML injection by building React nodes.
  const nodes: any[] = []
  let rest = text
  let k = 0
  const pushText = (t: string) => { if (t) nodes.push(<span key={`${keyPrefix}-t-${k++}`}>{t}</span>) }
  while (rest.length > 0) {
    const linkM = rest.match(/\[([^\]]+)\]\((https?:[^\s)]+)\)/)
    const codeM = rest.match(/`([^`]+)`/)
    const strongM = rest.match(/\*\*([^*]+)\*\*/)
    const emM1 = rest.match(/\*([^*]+)\*/)
    const emM2 = rest.match(/_([^_]+)_/)
    const strikeM = rest.match(/~~([^~]+)~~/)
    // choose earliest match start among found
    const candidates = [linkM, codeM, strongM, emM1, emM2, strikeM].filter(Boolean) as RegExpMatchArray[]
    if (candidates.length === 0) { pushText(rest); break }
    const starts = candidates.map(m => m.index ?? 0)
    const minIdx = Math.min(...starts)
    const m = candidates[starts.indexOf(minIdx)]
    // push preceding text
    pushText(rest.slice(0, minIdx))
    if (m === linkM) {
      const [all, label, url] = m
      nodes.push(
        <a key={`${keyPrefix}-a-${k++}`} href={url} target="_blank" rel="noopener noreferrer" className="underline text-[#9ecfff] hover:text-white">{label}</a>
      )
      rest = rest.slice((m.index ?? 0) + all.length)
      continue
    }
    if (m === codeM) {
      const [all, code] = m
      nodes.push(<code key={`${keyPrefix}-c-${k++}`} className="bg-black/40 px-1 rounded font-mono">{code}</code>)
      rest = rest.slice((m.index ?? 0) + all.length)
      continue
    }
    if (m === strongM) {
      const [all, inner] = m
      nodes.push(<strong key={`${keyPrefix}-b-${k++}`}>{inner}</strong>)
      rest = rest.slice((m.index ?? 0) + all.length)
      continue
    }
    if (m === emM1 || m === emM2) {
      const [all, inner] = m as RegExpMatchArray
      nodes.push(<em key={`${keyPrefix}-i-${k++}`}>{inner}</em>)
      rest = rest.slice((m.index ?? 0) + all.length)
      continue
    }
    if (m === strikeM) {
      const [all, inner] = m
      nodes.push(<s key={`${keyPrefix}-s-${k++}`}>{inner}</s>)
      rest = rest.slice((m.index ?? 0) + all.length)
      continue
    }
  }
  return nodes
}

export function renderContent(text: string, openMedia: (g: MediaGallery) => void, openProfile?: (bech: string) => void, openHashtag?: (tag: string) => void, allowedTags?: string[], isAuthorFollowed?: boolean, onOpenNote?: (id: string) => void, onReply?: (e: NDKEvent) => void, onRepost?: (e: NDKEvent) => void, onQuote?: (e: NDKEvent) => void, onOpenThread?: (e: NDKEvent) => void, scopeId?: string, actionMessages?: Record<string, string>, replyOpen?: Record<string, boolean>, replyBuffers?: Record<string, string>, onChangeReplyText?: (id: string, v: string) => void, onCloseReply?: (id: string) => void, onSendReply?: (targetId: string) => void, userFollows?: string[]) {
  if (!text) return null
  // Pre-extract all media items in the content to build a gallery for navigation
  const urls = (text.match(URL_REGEX) || []) as string[]
  const medias: MediaItem[] = urls
    .map(u => classifyMedia(u))
    .filter((m): m is MediaItem => !!m)

  const parts = text.split(URL_REGEX)
  return parts.flatMap((part, idx) => {
    if (!part) return null
    if (/^https?:\/\//i.test(part)) {
      const media = classifyMedia(part)
      if (media) {
        const index = medias.findIndex(m => m.url === media.url)
        
        // If author is followed, render media inline as blocks
        if (isAuthorFollowed) {
          if (media.type === 'image') {
            return (
              <div key={idx} className="w-full my-3">
                <img
                  src={media.url}
                  alt="Attached image"
                  className="w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => openMedia({ items: medias, index: Math.max(0, index) })}
                  loading="lazy"
                />
              </div>
            )
          } else if (media.type === 'video') {
            return (
              <div key={idx} className="w-full my-3">
                <video
                  src={media.url}
                  controls
                  className="w-full rounded-lg"
                  onClick={() => openMedia({ items: medias, index: Math.max(0, index) })}
                  preload="metadata"
                >
                  Your browser does not support the video tag.
                </video>
              </div>
            )
          }
        }
        
        // Default behavior: render as clickable link
        return (
          <a
            key={idx}
            href={part}
            onClick={(e) => { e.preventDefault(); openMedia({ items: medias, index: Math.max(0, index) }) }}
            className="underline text-[#9ecfff] hover:text-white"
          >
            {part}
          </a>
        )
      }
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-[#9ecfff] hover:text-white"
        >
          {part}
        </a>
      )
    }
    // Process nostr: profile references and nevent references inside plain text segments
    const subparts = part.split(NOSTR_REF_REGEX)
    if (subparts.length === 1) return <span key={idx}>{renderMarkdownInline(part, `${idx}`)}</span>
    const nodes: any[] = []
    for (let i = 0; i < subparts.length; i++) {
      const seg = subparts[i]
      if (!seg) continue
      const m = seg.match(/^nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+|nevent1[0-9a-z]+|note1[0-9a-z]+|naddr1[0-9a-z]+)/i)
      if (m) {
        const bech = m[1]
        if (/^(npub1|nprofile1)/i.test(bech) && openProfile) {
          nodes.push(
            <InlineProfile key={`${idx}-prof-${i}`} bech={bech} onOpen={(b) => openProfile(b)} />
          )
          // Skip the next captured subgroup to avoid rendering raw text
          i += 1
          continue
        } else if (/^(nevent1|note1)/i.test(bech)) {
          nodes.push(
            <div key={`${idx}-nevent-${i}`} className="mt-3">
              <InlineNeventNote 
                bech={bech} 
                openMedia={openMedia} 
                openProfile={openProfile} 
                openHashtag={openHashtag}
                onOpenNote={onOpenNote}
                onReply={onReply}
                onRepost={onRepost}
                onQuote={onQuote}
                onOpenThread={onOpenThread}
                scopeId={scopeId}
                actionMessages={actionMessages}
                replyOpen={replyOpen}
                replyBuffers={replyBuffers}
                onChangeReplyText={onChangeReplyText}
                onCloseReply={onCloseReply}
                onSendReply={onSendReply}
                userFollows={userFollows}
              />
            </div>
          )
          // Skip the next captured subgroup to avoid rendering raw text
          i += 1
          continue
        } else if (/^naddr1/i.test(bech)) {
          nodes.push(
            <div key={`${idx}-naddr-${i}`} className="mt-3">
              <InlineNaddrNote 
                bech={bech} 
                openMedia={openMedia} 
                openProfile={openProfile} 
                openHashtag={openHashtag}
                onOpenNote={onOpenNote}
                onReply={onReply}
                onRepost={onRepost}
                onQuote={onQuote}
                onOpenThread={onOpenThread}
                scopeId={scopeId}
                actionMessages={actionMessages}
                replyOpen={replyOpen}
                replyBuffers={replyBuffers}
                onChangeReplyText={onChangeReplyText}
                onCloseReply={onCloseReply}
                onSendReply={onSendReply}
                userFollows={userFollows}
              />
            </div>
          )
          // Skip the next captured subgroup to avoid rendering raw text
          i += 1
          continue
        }
      }
      // regular text segment -> markdown inline + clickable hashtags (only for tags present in allowedTags if provided)
      if (openHashtag) {
        const parts2: any[] = []
        let last = 0
        const textSeg = seg
        const re = /#[a-z0-9_]{1,64}/gi
        for (let m2: RegExpExecArray | null = re.exec(textSeg); m2; m2 = re.exec(textSeg)) {
          const start = m2.index
          const end = start + m2[0].length
          const before = textSeg.slice(last, start)
          if (before) parts2.push(<span key={`${idx}-t-${i}-${last}`}>{renderMarkdownInline(before, `${idx}-${i}-${last}`)}</span>)
          const h = m2[0]
          const tagName = h.slice(1).toLowerCase()
          const shouldLink = Array.isArray(allowedTags) && allowedTags.includes(tagName)
          if (shouldLink) {
            parts2.push(
              <a
                key={`${idx}-h-${i}-${start}`}
                href={`#${tagName}`}
                onClick={(e) => { e.preventDefault(); openHashtag(h) }}
                className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#1b3a40] text-white hover:bg-[#215059]"
                title={`Open ${h}`}
              >
                {h}
              </a>
            )
          } else {
            parts2.push(<span key={`${idx}-htext-${i}-${start}`}>{h}</span>)
          }
          last = end
        }
        const rest2 = textSeg.slice(last)
        if (rest2) parts2.push(<span key={`${idx}-t-${i}-rest`}>{renderMarkdownInline(rest2, `${idx}-${i}-rest`)}</span>)
        nodes.push(<span key={`${idx}-twrap-${i}`}>{parts2}</span>)
      } else {
        nodes.push(<span key={`${idx}-t-${i}`}>{renderMarkdownInline(seg, `${idx}-${i}`)}</span>)
      }
    }
    return nodes
  })
}

// Inline component to render a referenced nevent as its own note row
function InlineNeventNote({ bech, openMedia, openProfile, onOpenNote, openHashtag, onReply, onRepost, onQuote, onOpenThread, scopeId, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, userFollows }: { 
  bech: string; 
  openMedia: (g: MediaGallery) => void; 
  openProfile?: (bech: string) => void; 
  onOpenNote?: (id: string) => void; 
  openHashtag?: (tag: string) => void;
  onReply?: (e: NDKEvent) => void;
  onRepost?: (e: NDKEvent) => void;
  onQuote?: (e: NDKEvent) => void;
  onOpenThread?: (e: NDKEvent) => void;
  scopeId?: string;
  actionMessages?: Record<string, string>;
  replyOpen?: Record<string, boolean>;
  replyBuffers?: Record<string, string>;
  onChangeReplyText?: (id: string, v: string) => void;
  onCloseReply?: (id: string) => void;
  onSendReply?: (targetId: string) => void;
  userFollows?: string[];
}) {
  const decoded = useMemo(() => {
    try {
      const bare = bech.startsWith('nostr:') ? bech.slice(6) : bech
      const val = nip19.decode(bare)
      if (val.type === 'nevent' && (val.data as any)?.id) return (val.data as any).id as string
      if (val.type === 'note' && typeof val.data === 'string') return val.data as string
    } catch {}
    return null as string | null
  }, [bech])

  const evQuery = useQuery<NDKEvent | null>({
    queryKey: ['nevent-inline', decoded ?? 'invalid'],
    enabled: !!decoded,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      if (!decoded) return null
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [decoded] } as any), 7000, 'fetch nevent')
        const list = Array.from(set)
        return list[0] || null
      } catch {
        return null
      }
    },
  })

  return (
    <div className="border border-black rounded bg-[#10181b]">
      <div className="p-3">
        {!decoded ? (
          <div className="text-sm opacity-70">Invalid note reference.</div>
        ) : evQuery.isLoading ? (
          <div className="text-sm opacity-70">Loading referenced note…</div>
        ) : !evQuery.data ? (
          <div className="text-sm opacity-70">Referenced note not found.</div>
        ) : (
          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <header className="mb-2 flex items-center gap-2 text-sm text-[#cccccc]">
                <AuthorLabel pubkey={evQuery.data.pubkey || ''} />
                <span className="opacity-50">·</span>
                <time className="opacity-70 hover:underline cursor-pointer" onClick={(e) => { e.preventDefault(); if (evQuery.data?.id) onOpenNote?.(evQuery.data.id) }} title="Open note tab">{formatTime(evQuery.data.created_at)}</time>
              </header>
              {evQuery.data.kind === 6 ? (
                <RepostNote 
                  ev={evQuery.data} 
                  openMedia={openMedia} 
                  openProfile={openProfile} 
                  openProfileByPubkey={undefined as any} 
                  openHashtag={openHashtag}
                  onReply={onReply}
                  onRepost={onRepost}
                  onQuote={onQuote}
                  onOpenThread={onOpenThread}
                  onOpenNote={onOpenNote ? (ev: NDKEvent) => onOpenNote(ev.id || '') : undefined}
                  scopeId={scopeId}
                  actionMessages={actionMessages}
                  replyOpen={replyOpen}
                  replyBuffers={replyBuffers}
                  onChangeReplyText={onChangeReplyText}
                  onCloseReply={onCloseReply}
                  onSendReply={onSendReply}
                  userFollows={userFollows}
                />
              ) : (
                <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                  {renderContent(evQuery.data.content, openMedia, openProfile, openHashtag, extractHashtagTags((evQuery.data as any)?.tags), userFollows?.includes(evQuery.data.pubkey), onOpenNote, onReply, onRepost, onQuote, onOpenThread, scopeId, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, userFollows)}
                  
                  {/* Hashtag list for 't' tag hashtags */}
                  {extractHashtagTags((evQuery.data as any)?.tags).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {extractHashtagTags((evQuery.data as any)?.tags).map((tag, idx) => (
                        <button
                          key={`hashtag-${idx}-${tag}`}
                          type="button"
                          onClick={() => openHashtag?.(`#${tag}`)}
                          className="text-[#9ecfff] hover:text-white text-sm"
                          title={`Open #${tag}`}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {actionMessages?.[evQuery.data.id || ''] && (
                <div className="mt-3 bg-black/60 text-white border border-black rounded p-2 text-sm" role="status" aria-live="polite">
                  {actionMessages[evQuery.data.id || '']}
                </div>
              )}
              {(evQuery.data.id && scopeId && replyOpen?.[`${scopeId}|${evQuery.data.id}`]) && (
                <ReplyComposer
                  value={(replyBuffers?.[`${scopeId}|${evQuery.data.id}`] || '')}
                  onChange={(v) => onChangeReplyText?.(`${scopeId}|${evQuery.data.id!}`, v)}
                  onClose={() => onCloseReply?.(`${scopeId}|${evQuery.data.id!}`)}
                  onSend={() => onSendReply?.(`${scopeId}|${evQuery.data.id!}`)}
                  replyKey={`${scopeId}|${evQuery.data.id}`}
                />
              )}
            </div>
            {onReply && onRepost && onQuote && evQuery.data && (
              <div className="flex flex-col items-end gap-2 flex-shrink-0 self-start">
                {onOpenThread && (
                  <button type="button" onClick={() => onOpenThread(evQuery.data!)} className="bg-black/60 text-white hover:bg-black/80 text-xs px-2 py-1 rounded-full flex items-center gap-2" title="Open thread">
                    <ThreadReelIcon className="w-8 h-8" />
                  </button>
                )}
                <button type="button" onClick={() => onQuote(evQuery.data!)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Quote">
                  <QuoteIcon className="w-8 h-8" />
                </button>
                <button type="button" onClick={() => onRepost(evQuery.data!)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Repost">
                  <RepostEllipsisBubbleIcon className="w-8 h-8" />
                </button>
                <button type="button" onClick={() => onReply(evQuery.data!)} className={`${(evQuery.data.id && scopeId && replyOpen?.[`${scopeId}|${evQuery.data.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Reply">
                  <ReplyBubbleIcon className="w-8 h-8" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Inline component to render a referenced naddr (addressable event) as its own note row
function InlineNaddrNote({ bech, openMedia, openProfile, onOpenNote, openHashtag, onReply, onRepost, onQuote, onOpenThread, scopeId, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, userFollows }: { 
  bech: string; 
  openMedia: (g: MediaGallery) => void; 
  openProfile?: (bech: string) => void; 
  onOpenNote?: (id: string) => void; 
  openHashtag?: (tag: string) => void;
  onReply?: (e: NDKEvent) => void;
  onRepost?: (e: NDKEvent) => void;
  onQuote?: (e: NDKEvent) => void;
  onOpenThread?: (e: NDKEvent) => void;
  scopeId?: string;
  actionMessages?: Record<string, string>;
  replyOpen?: Record<string, boolean>;
  replyBuffers?: Record<string, string>;
  onChangeReplyText?: (id: string, v: string) => void;
  onCloseReply?: (id: string) => void;
  onSendReply?: (targetId: string) => void;
  userFollows?: string[];
}) {
  const decoded = useMemo(() => {
    try {
      const bare = bech.startsWith('nostr:') ? bech.slice(6) : bech
      const val = nip19.decode(bare)
      if (val.type === 'naddr' && val.data) {
        const data = val.data as any
        return {
          pubkey: data.pubkey,
          kind: data.kind,
          identifier: data.identifier || ''
        }
      }
    } catch {}
    return null
  }, [bech])

  const evQuery = useQuery<NDKEvent | null>({
    queryKey: ['naddr-inline', decoded?.pubkey, decoded?.kind, decoded?.identifier],
    enabled: !!decoded,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      if (!decoded) return null
      try {
        const filter: NDKFilter = {
          authors: [decoded.pubkey],
          kinds: [decoded.kind],
          '#d': [decoded.identifier],
          limit: 1
        }
        const set = await withTimeout(ndk.fetchEvents(filter as any), 7000, 'fetch naddr')
        const list = Array.from(set)
        return list[0] || null
      } catch {
        return null
      }
    },
  })

  return (
    <div className="border border-black rounded bg-[#10181b]">
      <div className="p-3">
        {!decoded ? (
          <div className="text-sm opacity-70">Invalid addressable event reference.</div>
        ) : evQuery.isLoading ? (
          <div className="text-sm opacity-70">Loading referenced event…</div>
        ) : !evQuery.data ? (
          <div className="text-sm opacity-70">Referenced event not found.</div>
        ) : (
          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <header className="mb-2 flex items-center gap-2 text-sm text-[#cccccc]">
                <AuthorLabel pubkey={evQuery.data.pubkey || ''} />
                <span className="opacity-50">·</span>
                <time className="opacity-70 hover:underline cursor-pointer" onClick={(e) => { e.preventDefault(); if (evQuery.data?.id) onOpenNote?.(evQuery.data.id) }} title="Open note tab">{formatTime(evQuery.data.created_at)}</time>
              </header>
              {evQuery.data.kind === 6 ? (
                <RepostNote 
                  ev={evQuery.data} 
                  openMedia={openMedia} 
                  openProfile={openProfile} 
                  openProfileByPubkey={undefined as any} 
                  openHashtag={openHashtag}
                  onReply={onReply}
                  onRepost={onRepost}
                  onQuote={onQuote}
                  onOpenThread={onOpenThread}
                  onOpenNote={onOpenNote ? (ev: NDKEvent) => onOpenNote(ev.id || '') : undefined}
                  scopeId={scopeId}
                  actionMessages={actionMessages}
                  replyOpen={replyOpen}
                  replyBuffers={replyBuffers}
                  onChangeReplyText={onChangeReplyText}
                  onCloseReply={onCloseReply}
                  onSendReply={onSendReply}
                  userFollows={userFollows}
                />
              ) : (
                <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                  {renderContent(evQuery.data.content, openMedia, openProfile, openHashtag, extractHashtagTags((evQuery.data as any)?.tags), userFollows?.includes(evQuery.data.pubkey), onOpenNote, onReply, onRepost, onQuote, onOpenThread, scopeId, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, userFollows)}
                  
                  {/* Hashtag list for 't' tag hashtags */}
                  {extractHashtagTags((evQuery.data as any)?.tags).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {extractHashtagTags((evQuery.data as any)?.tags).map((tag, idx) => (
                        <button
                          key={`hashtag-${idx}-${tag}`}
                          type="button"
                          onClick={() => openHashtag?.(`#${tag}`)}
                          className="text-[#9ecfff] hover:text-white text-sm"
                          title={`Open #${tag}`}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {actionMessages?.[evQuery.data.id || ''] && (
                <div className="mt-3 bg-black/60 text-white border border-black rounded p-2 text-sm" role="status" aria-live="polite">
                  {actionMessages[evQuery.data.id || '']}
                </div>
              )}
              {(evQuery.data.id && scopeId && replyOpen?.[`${scopeId}|${evQuery.data.id}`]) && (
                <ReplyComposer
                  value={(replyBuffers?.[`${scopeId}|${evQuery.data.id}`] || '')}
                  onChange={(v) => onChangeReplyText?.(`${scopeId}|${evQuery.data.id!}`, v)}
                  onClose={() => onCloseReply?.(`${scopeId}|${evQuery.data.id!}`)}
                  onSend={() => onSendReply?.(`${scopeId}|${evQuery.data.id!}`)}
                  replyKey={`${scopeId}|${evQuery.data.id}`}
                />
              )}
            </div>
            {onReply && onRepost && onQuote && evQuery.data && (
              <div className="flex flex-col items-end gap-2 flex-shrink-0 self-start">
                {onOpenThread && (
                  <button type="button" onClick={() => onOpenThread(evQuery.data!)} className="bg-black/60 text-white hover:bg-black/80 text-xs px-2 py-1 rounded-full flex items-center gap-2" title="Open thread">
                    <ThreadReelIcon className="w-8 h-8" />
                  </button>
                )}
                <button type="button" onClick={() => onQuote(evQuery.data!)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Quote">
                  <QuoteIcon className="w-8 h-8" />
                </button>
                <button type="button" onClick={() => onRepost(evQuery.data!)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Repost">
                  <RepostEllipsisBubbleIcon className="w-8 h-8" />
                </button>
                <button type="button" onClick={() => onReply(evQuery.data!)} className={`${(evQuery.data.id && scopeId && replyOpen?.[`${scopeId}|${evQuery.data.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Reply">
                  <ReplyBubbleIcon className="w-8 h-8" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SingleNoteView({ id, scopeId, openMedia, openProfileByBech, openProfileByPubkey, onReply, onRepost, onQuote, onOpenNote, actionMessage, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, openHashtag }: { id: string; scopeId: string; openMedia: (g: MediaGallery) => void; openProfileByBech: (bech: string) => void; openProfileByPubkey: (pubkey: string) => void; onReply: (e: NDKEvent) => void; onRepost: (e: NDKEvent) => void; onQuote: (e: NDKEvent) => void; onOpenNote: (e: NDKEvent) => void; actionMessage?: string; replyOpen?: Record<string, boolean>; replyBuffers?: Record<string, string>; onChangeReplyText?: (id: string, v: string) => void; onCloseReply?: (id: string) => void; onSendReply?: (targetId: string) => void; openHashtag?: (tag: string) => void }) {
  const queryClient = useQueryClient()
  const { data: ev, isLoading } = useQuery<NDKEvent | null>({
    queryKey: ['single-note', id],
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [id] } as any), 8000, 'fetch single note')
        return Array.from(set)[0] || null
      } catch { return null }
    },
    staleTime: 1000 * 60 * 5,
  })
  const forceReload = () => {
    try {
      queryClient.invalidateQueries({ queryKey: ['single-note', id] })
      queryClient.refetchQueries({ queryKey: ['single-note', id] })
    } catch {}
  }
  if (isLoading) return (
    <div className="p-3">
      <div className="w-full bg-black text-white border border-black rounded-md px-3 py-2 flex items-center justify-between" role="status" aria-live="polite">
        <span className="text-sm">Loading note…</span>
        <button
          type="button"
          onClick={forceReload}
          title="Reload note"
          aria-label="Reload note"
          className="w-8 h-8 rounded-full border border-white/30 flex items-center justify-center hover:bg-white/10 focus:outline-none"
        >
          <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
  if (!ev) return <div className="p-6">Note not found.</div>
  return (
    <article className="p-3">
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <header className="mb-1 flex items-center gap-2 text-sm text-[#cccccc]">
            <AuthorLabel pubkey={ev.pubkey || ''} onOpen={(pk) => openProfileByPubkey(pk)} />
            <span className="opacity-50">·</span>
            <time className="opacity-70 hover:underline cursor-pointer" onClick={() => onOpenNote(ev)} title="Open note tab">{formatTime(ev.created_at)}</time>
          </header>
          <div className="whitespace-pre-wrap break-words text-[#cccccc]">
            {ev.kind === 6 ? (
              <RepostNote 
                ev={ev} 
                openMedia={openMedia} 
                openProfile={openProfileByBech} 
                openProfileByPubkey={openProfileByPubkey} 
                openHashtag={openHashtag}
                onReply={onReply}
                onRepost={onRepost}
                onQuote={onQuote}
                onOpenNote={onOpenNote}
                scopeId={scopeId}
                actionMessages={{[ev.id || '']: actionMessage}}
                replyOpen={replyOpen}
                replyBuffers={replyBuffers}
                onChangeReplyText={onChangeReplyText}
                onCloseReply={onCloseReply}
                onSendReply={onSendReply}
                userFollows={undefined}
                repostMode={repostMode}
                onCancelRepost={onCancelRepost}
              />
            ) : (
              <div className="contents">{renderContent(ev.content, openMedia, openProfileByBech, openHashtag, extractHashtagTags((ev as any)?.tags), false, (id: string) => onOpenNote({id} as NDKEvent), onReply, onRepost, onQuote, undefined, scopeId, {[ev.id || '']: actionMessage}, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, undefined)}</div>
            )}
            
            {/* Hashtag list for 't' tag hashtags */}
            {ev.kind !== 6 && extractHashtagTags((ev as any)?.tags).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {extractHashtagTags((ev as any)?.tags).map((tag, idx) => (
                  <button
                    key={`hashtag-${idx}-${tag}`}
                    type="button"
                    onClick={() => openHashtag?.(`#${tag}`)}
                    className="text-[#9ecfff] hover:text-white text-sm"
                    title={`Open #${tag}`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>
          {actionMessage && (
            <div className="mt-3 bg-black/60 text-white border border-black rounded p-2 text-sm" role="status" aria-live="polite">{actionMessage}</div>
          )}
          {(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) && (
            <ReplyComposer
              value={(replyBuffers?.[`${scopeId}|${ev.id}`] || '')}
              onChange={(v) => onChangeReplyText?.(`${scopeId}|${ev.id!}`, v)}
              onClose={() => onCloseReply?.(`${scopeId}|${ev.id!}`)}
              onSend={() => onSendReply?.(`${scopeId}|${ev.id!}`)}
              replyKey={`${scopeId}|${ev.id}`}
            />
          )}
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0 self-start">
          <button type="button" onClick={() => onQuote(ev)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Quote">
            <QuoteIcon className="w-8 h-8" />
          </button>
          <button type="button" onClick={() => onRepost(ev)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Repost">
            <RepostEllipsisBubbleIcon className="w-8 h-8" />
          </button>
          <button type="button" onClick={() => onReply(ev)} className={`${(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Reply">
            <ReplyBubbleIcon className="w-8 h-8" />
          </button>
        </div>
      </div>
    </article>
  )
}

function Home() {
  // Thread modal state (narrow) and side panel state (wide)
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const [threadOpenSeed, _setThreadOpenSeed] = useState<string | null>(null) // store clicked event id for context
  // Multiple opened threads state for thread stack view
  const [openedThreads, setOpenedThreads] = useState<string[]>([])
  const [threadTriggerNotes, setThreadTriggerNotes] = useState<Record<string, string>>({}) // Map thread root ID to triggering note ID
  const [isThreadsModalOpen, setIsThreadsModalOpen] = useState<boolean>(false)
  const [isThreadsHiddenInWideMode, setIsThreadsHiddenInWideMode] = useState<boolean>(false)
  // Sidebar drawer state
  const [isSidebarDrawerOpen, setIsSidebarDrawerOpen] = useState<boolean>(false)
  const [mediaToShow, setMediaToShow] = useState<MediaGallery | null>(null)
  const [profilePubkey, setProfilePubkey] = useState<string | null>(null)
  type OpenedProfile = { pubkey: string; npub: string; name?: string; picture?: string; about?: string }
  const [openedProfiles, setOpenedProfiles] = useState<OpenedProfile[]>([])
  type OpenedNote = { id: string }
  const [openedNotes, setOpenedNotes] = useState<OpenedNote[]>([])
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null)
  // Hashtag tabs
  const [openedHashtags, setOpenedHashtags] = useState<string[]>([])
  const [currentHashtag, setCurrentHashtag] = useState<string | null>(null)
  const [prevView, setPrevView] = useState<{ mode: FeedMode; profilePubkey: string | null; noteId?: string | null } | null>(null)
  // Infinite feed query using NDK. When a signer is present, NDK auto-connects
  // to user relays; otherwise it uses default relays configured in ndk.ts.
  const PAGE_SIZE = 4

  // Feed mode and user info (from localStorage saved by Root)
  const [mode, setMode] = useState<FeedMode>('global')
  const [user, setUser] = useState<LoggedInUser | null>(null)
  const [_isWide, _setIsWide] = useState<boolean>(false) // Unused but keeping for potential future use
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nostrUser')
      if (saved) setUser(JSON.parse(saved))
    } catch {}
  }, [])
  // Ensure NDK connection is initialized early to avoid stuck hashtag loads
  useEffect(() => {
    try { initializeNDK(5000) } catch {}
  }, [])
  // Dynamic layout measurement: determine if main view and thread panel can fit side-by-side
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const mainColRef = useRef<HTMLDivElement | null>(null)
  const _sidebarRef = useRef<HTMLDivElement | null>(null) // Unused but kept for future implementation
  const [_sidebarWidthPx, _setSidebarWidthPx] = useState<number>(0) // Unused but kept for future implementation
  const [canFitBoth, setCanFitBoth] = useState<boolean>(false)
  // Sidebar fit detection - check if sidebar should be in drawer mode
  const [canFitSidebar, setCanFitSidebar] = useState<boolean>(true)
  useEffect(() => {
    const compute = () => {
      try {
        const layout = layoutRef.current
        if (!layout) { setCanFitBoth(false); setCanFitSidebar(false); return }
        const left = layout.getBoundingClientRect().left || 0
        const avail = window.innerWidth - left
        // Use fixed width for max-w-2xl (512px) instead of measuring potentially compressed width
        const fixedColumnWidth = 512 // 32rem = 512px (max-w-2xl)
        const gap = 16 // px gap between columns
        // Switch to drawer mode at a wider point by requiring more space
        const widerBreakpoint = fixedColumnWidth * 2 + gap + 200 // Add 200px buffer for wider switch point
        setCanFitBoth(avail >= widerBreakpoint)
        // Check if sidebar can fit - need space for sidebar + main content
        const sidebarWidth = window.innerWidth >= 1280 ? 128 : 48 // xl:w-32 vs w-12
        const sidebarGap = window.innerWidth >= 1280 ? 128 + 16 : 48 + 16 // sidebar + gap
        setCanFitSidebar(window.innerWidth >= (sidebarGap + fixedColumnWidth))
      } catch {
        setCanFitBoth(false)
        setCanFitSidebar(false)
      }
    }
    compute()
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('resize', compute)
    }
  }, [])

  // Auto-open/close threads modal when transitioning between screen sizes
  const prevCanFitBoth = useRef<boolean>(canFitBoth)
  useEffect(() => {
    const wasWide = prevCanFitBoth.current
    const isNowNarrow = !canFitBoth
    const wasNarrow = !prevCanFitBoth.current
    const isNowWide = canFitBoth
    
    // If we transitioned from wide to narrow and have opened threads, open the modal
    if (wasWide && isNowNarrow && openedThreads.length > 0 && !isThreadsModalOpen) {
      setIsThreadsModalOpen(true)
    }
    
    // If we transitioned from narrow to wide and modal is open, close the modal
    if (wasNarrow && isNowWide && isThreadsModalOpen) {
      setIsThreadsModalOpen(false)
    }
    
    prevCanFitBoth.current = canFitBoth
  }, [canFitBoth, openedThreads.length, isThreadsModalOpen])

  // Auto-open/close sidebar drawer when transitioning between screen sizes
  const prevCanFitSidebar = useRef<boolean>(canFitSidebar)
  useEffect(() => {
    const wasFitting = prevCanFitSidebar.current
    const isNowTooNarrow = !canFitSidebar
    const wasNarrow = !prevCanFitSidebar.current
    const isNowFitting = canFitSidebar
    
    // If we transitioned from fitting to too narrow and have tabs open, open the drawer
    if (wasFitting && isNowTooNarrow && (openedNotes.length > 0 || openedProfiles.length > 0 || openedHashtags.length > 0) && !isSidebarDrawerOpen) {
      setIsSidebarDrawerOpen(true)
    }
    
    // If we transitioned from narrow to fitting and drawer is open, close the drawer
    if (wasNarrow && isNowFitting && isSidebarDrawerOpen) {
      setIsSidebarDrawerOpen(false)
    }
    
    prevCanFitSidebar.current = canFitSidebar
  }, [canFitSidebar, openedNotes.length, openedProfiles.length, openedHashtags.length, isSidebarDrawerOpen])

  // Hydrate previously opened profiles from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('openedProfiles')
      if (saved) setOpenedProfiles(JSON.parse(saved))
    } catch {}
  }, [])

  // Hydrate previously opened notes from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('openedNotes')
      if (saved) setOpenedNotes(JSON.parse(saved))
    } catch {}
  }, [])

  // Hydrate previously opened hashtags from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('openedHashtags')
      if (saved) setOpenedHashtags(JSON.parse(saved))
    } catch {}
  }, [])

  // Hydrate previously opened threads from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('openedThreads')
      if (saved) setOpenedThreads(JSON.parse(saved))
    } catch {}
  }, [])

  // Hydrate previously stored thread trigger notes from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('threadTriggerNotes')
      if (saved) setThreadTriggerNotes(JSON.parse(saved))
    } catch {}
  }, [])

  // Ensure unavailable tabs are not active when logged out; also prune self profile tab on login
  useEffect(() => {
    if (!user && (mode === 'user' || mode === 'follows')) {
      setMode('global')
    }
    // Remove self from openedProfiles if present when user changes
    if (user?.pubkey) {
      setOpenedProfiles(prev => prev.filter(p => p.pubkey !== user.pubkey))
    }
  }, [user])

  // Persist opened profiles
  useEffect(() => {
    try { localStorage.setItem('openedProfiles', JSON.stringify(openedProfiles)) } catch {}
  }, [openedProfiles])
  // Persist opened notes
  useEffect(() => {
    try { localStorage.setItem('openedNotes', JSON.stringify(openedNotes)) } catch {}
  }, [openedNotes])
  // Persist opened hashtags
  useEffect(() => {
    try { localStorage.setItem('openedHashtags', JSON.stringify(openedHashtags)) } catch {}
  }, [openedHashtags])
  // Persist opened threads
  useEffect(() => {
    try { localStorage.setItem('openedThreads', JSON.stringify(openedThreads)) } catch {}
  }, [openedThreads])
  // Persist thread trigger notes
  useEffect(() => {
    try { localStorage.setItem('threadTriggerNotes', JSON.stringify(threadTriggerNotes)) } catch {}
  }, [threadTriggerNotes])

  // Action message state: per-event label to show in-note
  const [actionMessages, setActionMessages] = useState<Record<string, string>>({})
  // Unused but keeping for potential future use
  const _showActionMessage = (ev: NDKEvent, label: string) => {
    const id = ev.id || ''
    if (!id) return
    setActionMessages(prev => ({ ...prev, [id]: label }))
    // Auto-clear after 3 seconds
    setTimeout(() => {
      setActionMessages(prev => {
        const copy = { ...prev }
        if (copy[id] === label) delete copy[id]
        return copy
      })
    }, 3000)
  }

  // Repost mode state: per-event toggle for repost confirmation
  const [repostMode, setRepostMode] = useState<Record<string, boolean>>({})
  const toggleRepostMode = (ev: NDKEvent) => {
    const id = ev.id || ''
    if (!id) return
    setRepostMode(prev => ({ ...prev, [id]: !prev[id] }))
  }
  const cancelRepost = (ev: NDKEvent) => {
    const id = ev.id || ''
    if (!id) return
    setRepostMode(prev => ({ ...prev, [id]: false }))
  }

  // Reply composers: independent per-note open state and persistent buffers
  const [replyOpen, setReplyOpen] = useState<Record<string, boolean>>({})
  const [replyBuffers, setReplyBuffers] = useState<Record<string, string>>({})

  // Hydrate buffers
  useEffect(() => {
    try {
      const saved = localStorage.getItem('replyBuffers')
      if (saved) setReplyBuffers(JSON.parse(saved))
    } catch {}
  }, [])
  // Persist buffers
  useEffect(() => {
    try { localStorage.setItem('replyBuffers', JSON.stringify(replyBuffers)) } catch {}
  }, [replyBuffers])

  // Quote composers: independent per-note open state and persistent buffers
  const [quoteOpen, setQuoteOpen] = useState<Record<string, boolean>>({})
  const [quoteBuffers, setQuoteBuffers] = useState<Record<string, string>>({})

  // Hydrate quote buffers
  useEffect(() => {
    try {
      const saved = localStorage.getItem('quoteBuffers')
      if (saved) setQuoteBuffers(JSON.parse(saved))
    } catch {}
  }, [])
  // Persist quote buffers
  useEffect(() => {
    try { localStorage.setItem('quoteBuffers', JSON.stringify(quoteBuffers)) } catch {}
  }, [quoteBuffers])

  // Thread view single-active editor bridge (for ThreadModal/ThreadPanel legacy props)
  const [threadActiveReplyTargetKey, setThreadActiveReplyTargetKey] = useState<string | null>(null)
  const changeThreadReplyText = (v: string) => {
    const key = threadActiveReplyTargetKey
    if (!key) return
    setReplyBuffers(prev => ({ ...prev, [key]: v }))
  }
  const closeThreadReply = () => {
    const key = threadActiveReplyTargetKey
    if (!key) return
    // Thread inline editor uses its own active key; do not touch other scopes
    setReplyOpen(prev => ({ ...prev, [key]: false }))
    setThreadActiveReplyTargetKey(null)
  }

  // Action handlers (stubs/minimal)
  const onReplyScoped = (scopeId: string) => (ev: NDKEvent) => {
    const id = ev.id || ''
    if (!id) return
    const key = `${scopeId}|${id}`
    const wasOpen = replyOpen[key] || false
    
    // Close any open quote panels for this event when opening reply
    setQuoteOpen(prev => {
      const updated = { ...prev }
      const quoteKey = `quote|${id}`
      if (updated[quoteKey]) {
        updated[quoteKey] = false
      }
      return updated
    })
    
    setReplyOpen(prev => ({ ...prev, [key]: !prev[key] }))
    // Manage thread inline editor target when in a thread view (use composite key)
    if (scopeId.startsWith('thread-modal:') || scopeId.startsWith('thread-panel:')) {
      setThreadActiveReplyTargetKey(prev => (prev === key ? null : key))
    }
    
    // If reply is being opened (was closed, now opening), scroll to bring it into view
    if (!wasOpen) {
      setTimeout(() => {
        try {
          // Find all ReplyComposer elements and look for the one that was just opened
          const replyElements = document.querySelectorAll('[data-reply-key]')
          let targetElement: Element | null = null
          let targetTextarea: HTMLTextAreaElement | null = null
          
          // If no data-reply-key attributes found, fallback to finding by textarea placeholder
          if (replyElements.length === 0) {
            const textareas = document.querySelectorAll('textarea[placeholder="Write a reply..."]')
            // Get the last textarea (most recently opened)
            if (textareas.length > 0) {
              targetTextarea = textareas[textareas.length - 1] as HTMLTextAreaElement
              targetElement = targetTextarea.closest('.mt-3')
            }
          } else {
            // Find the specific reply element by key
            targetElement = document.querySelector(`[data-reply-key="${key}"]`)
            if (targetElement) {
              targetTextarea = targetElement.querySelector('textarea[placeholder="Write a reply..."]') as HTMLTextAreaElement
            }
          }
          
          if (targetElement) {
            // Scroll so that the bottom of the reply input is at the bottom of the viewport
            const rect = targetElement.getBoundingClientRect()
            const viewportHeight = window.innerHeight
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop
            const elementBottom = rect.bottom + scrollTop
            const targetScrollTop = elementBottom - viewportHeight
            
            window.scrollTo({
              top: Math.max(0, targetScrollTop),
              behavior: 'smooth'
            })
            
            // Focus the textarea after scroll completes (smooth scroll takes ~300-500ms)
            if (targetTextarea) {
              setTimeout(() => {
                try {
                  targetTextarea.focus()
                } catch (error) {
                  console.warn('Error focusing reply textarea:', error)
                }
              }, 500) // Wait for smooth scroll to complete
            }
          }
        } catch (error) {
          console.warn('Error scrolling to reply input:', error)
        }
      }, 100) // Allow time for DOM update
    }
  }
  const onRepost = (ev: NDKEvent) => {
    toggleRepostMode(ev)
  }
  // Helper function to generate nevent encoding for an event
  const generateNeventForEvent = (ev: NDKEvent): string => {
    if (!ev.id) return ''
    try {
      return nip19.neventEncode({
        id: ev.id,
        author: ev.pubkey,
        kind: ev.kind
      })
    } catch {
      return ''
    }
  }

  const onQuote = (ev: NDKEvent) => {
    const id = ev.id || ''
    if (!id) return
    
    // Generate nevent encoding for the quoted event
    const nevent = generateNeventForEvent(ev)
    if (!nevent) return
    
    const key = `quote|${id}`
    const quoteContent = `\n\nnostr:${nevent}`
    
    // Close any open reply panels for this event when opening quote
    setReplyOpen(prev => {
      const updated = { ...prev }
      // Close reply panels for all scopes of this event
      Object.keys(updated).forEach(replyKey => {
        if (replyKey.endsWith(`|${id}`)) {
          updated[replyKey] = false
        }
      })
      return updated
    })
    
    // Set the quote buffer with pre-filled content
    setQuoteBuffers(prev => ({ ...prev, [key]: quoteContent }))
    
    // Toggle the quote panel
    setQuoteOpen(prev => ({ ...prev, [key]: !prev[key] }))
  }
  const closeReply = (id: string) => {
    setReplyOpen(prev => ({ ...prev, [id]: false }))
  }
  const changeReplyText = (id: string, v: string) => {
    setReplyBuffers(prev => ({ ...prev, [id]: v }))
  }
  const closeQuote = (id: string) => {
    setQuoteOpen(prev => ({ ...prev, [id]: false }))
  }
  const changeQuoteText = (id: string, v: string) => {
    setQuoteBuffers(prev => ({ ...prev, [id]: v }))
  }
  const sendQuote = (targetId: string) => {
    // For now, just close the composer and clear its buffer; sending is not yet implemented
    setQuoteOpen(prev => ({ ...prev, [targetId]: false }))
    setQuoteBuffers(prev => ({ ...prev, [targetId]: '' }))
    setActionMessages(prev => ({ ...prev, [targetId]: 'Quote posted' }))
    setTimeout(() => {
      setActionMessages(prev => {
        const copy = { ...prev }
        if (copy[targetId] === 'Quote posted') delete copy[targetId]
        return copy
      })
    }, 2000)
  }
  const sendReply = (targetId: string) => {
    // For now, just close the composer and clear its buffer; sending is not yet implemented
    setReplyOpen(prev => ({ ...prev, [targetId]: false }))
    setReplyBuffers(prev => ({ ...prev, [targetId]: '' }))
    // If this was the active thread editor, clear the bridge state
    setThreadActiveReplyTargetKey(prev => (prev === targetId ? null : prev))
    setActionMessages(prev => ({ ...prev, [targetId]: 'Reply sent' }))
    setTimeout(() => {
      setActionMessages(prev => {
        const copy = { ...prev }
        if (copy[targetId] === 'Reply sent') delete copy[targetId]
        return copy
      })
    }, 2000)
  }

  const openNoteById = (id?: string | null) => {
    const noteId = id || ''
    if (!noteId) return
    // Add to opened list if not present
    setOpenedNotes(prev => (prev.some(n => n.id === noteId) ? prev : [{ id: noteId }, ...prev].slice(0, 20)))
    // Save previous view if switching
    setPrevView({ mode, profilePubkey, noteId: currentNoteId })
    setCurrentNoteId(noteId)
    setMode('note')
    // Inform header
    try { window.dispatchEvent(new CustomEvent('nostr-active-view', { detail: { label: 'Note' } })) } catch {}
  }
  const openNoteForEvent = (ev: NDKEvent) => openNoteById(ev.id)

  const getThreadRootId = (ev: NDKEvent): string => {
    return getRootEventHexId(ev) || ev.id || ''
  }
  const openThreadFor = (ev: NDKEvent) => {
    const root = getThreadRootId(ev)
    if (!root) return
    
    // Store the triggering note ID for this thread
    const triggerNoteId = ev.id || root
    setThreadTriggerNotes(prev => ({ ...prev, [root]: triggerNoteId }))
    
    // Add to opened threads stack if not already present
    setOpenedThreads(prev => {
      if (prev.includes(root)) {
        // Thread already in stack, move it to top
        return [root, ...prev.filter(id => id !== root)]
      } else {
        // Add new thread to top, limit to 5 threads max
        return [root, ...prev].slice(0, 5)
      }
    })
    
    // On narrow screens, open the threads modal to show the drawer
    if (!canFitBoth) {
      setIsThreadsModalOpen(true)
    } else if (isThreadsHiddenInWideMode) {
      // On wide screens, unhide threads if they're currently hidden
      setIsThreadsHiddenInWideMode(false)
    }
  }

  const closeThreadFromStack = (rootId: string) => {
    setOpenedThreads(prev => prev.filter(id => id !== rootId))
    // Clean up the triggering note mapping
    setThreadTriggerNotes(prev => {
      const updated = { ...prev }
      delete updated[rootId]
      return updated
    })
  }

  // Open a profile from a nostr bech32 identifier (npub or nprofile) and switch to profile mode
  const openProfileByBech = (bech: string) => {
    try {
      let u: any
      if (/^npub1[0-9a-z]+$/i.test(bech)) {
        u = ndk.getUser({ npub: bech } as any)
      } else if (/^nprofile1[0-9a-z]+$/i.test(bech)) {
        u = ndk.getUser({ nprofile: bech } as any)
      } else {
        return
      }
      const pub = (u as any).pubkey as string
      if (!pub) return
      const npubVal = (u as any).npub || (bech.startsWith('npub1') ? bech : '')
      // If opening own profile, switch to Me view (profile mode with own pubkey) and do not add a sidebar tab
      if (user?.pubkey && pub === user.pubkey) {
        if (!(mode === 'profile' && profilePubkey === pub)) {
          setPrevView({ mode, profilePubkey })
        }
        setProfilePubkey(pub)
        setMode('profile')
        // Remove any existing self tab from openedProfiles
        setOpenedProfiles(prev => prev.filter(p => p.pubkey !== pub))
        return
      }
      if (!(mode === 'profile' && profilePubkey === pub)) {
        setPrevView({ mode, profilePubkey })
      }
      setProfilePubkey(pub)
      setMode('profile')
      setOpenedProfiles(prev => {
        const exists = prev.find(p => p.pubkey === pub)
        if (exists) return prev
        return [{ pubkey: pub, npub: npubVal, name: undefined, picture: undefined, about: undefined }, ...prev].slice(0, 12)
      })
    } catch {
      // ignore
    }
  }

  // Open a profile directly from a hex pubkey
  const openProfileByPubkey = (pub: string) => {
    if (!pub) return
    try {
      const u: any = ndk.getUser({ pubkey: pub } as any)
      const npubVal: string = (u as any).npub || ''
      // If opening own profile, switch to Me view and avoid adding a tab
      if (user?.pubkey && pub === user.pubkey) {
        if (!(mode === 'profile' && profilePubkey === pub)) {
          setPrevView({ mode, profilePubkey })
        }
        setProfilePubkey(pub)
        setMode('profile')
        setOpenedProfiles(prev => prev.filter(p => p.pubkey !== pub))
        return
      }
      if (!(mode === 'profile' && profilePubkey === pub)) {
        setPrevView({ mode, profilePubkey })
      }
      setProfilePubkey(pub)
      setMode('profile')
      setOpenedProfiles(prev => {
        const exists = prev.find(p => p.pubkey === pub)
        if (exists) return prev
        return [{ pubkey: pub, npub: npubVal, name: undefined, picture: undefined, about: undefined }, ...prev].slice(0, 12)
      })
    } catch {
      // ignore
    }
  }

  // Open a hashtag tab and switch to hashtag mode
  const openHashtag = (raw: string) => {
    const tag = (raw || '').replace(/^#/, '').toLowerCase()
    if (!tag) return
    if (!(mode === 'hashtag' && currentHashtag === tag)) {
      setPrevView({ mode, profilePubkey, noteId: currentNoteId })
    }
    setCurrentHashtag(tag)
    setMode('hashtag')
    setOpenedHashtags(prev => {
      if (prev.includes(tag)) return prev
      return [tag, ...prev].slice(0, 20)
    })
    // Use setTimeout to ensure state updates complete before invalidating queries
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['hashtag-feed', tag] })
      queryClient.refetchQueries({ queryKey: ['hashtag-feed', tag] })
    }, 0)
  }

  const closeCurrentHashtagAndRestore = () => {
    const current = currentHashtag
    if (!current) return
    const after = openedHashtags.filter(t => t !== current)
    setOpenedHashtags(after)
    setCurrentHashtag(null)

    // Always activate the first (top) hashtag tab if any remain, else Global
    if (after.length > 0) {
      setCurrentHashtag(after[0])
      setMode('hashtag')
    } else {
      setMode('global')
    }
  }

  const removeHashtagTab = (tag: string) => {
    if (tag === currentHashtag) {
      closeCurrentHashtagAndRestore()
      return
    }
    setOpenedHashtags(prev => prev.filter(t => t !== tag))
  }

  // Listen for login/logout events from Root and update feed immediately
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<LoggedInUser | null>
      const nextUser = (ce as any).detail as (LoggedInUser | null)
      setUser(nextUser)
      if (nextUser) {
        // On login, default to Follows feed
        setMode('follows')
      } else {
        // On logout, switch back to Global
        setMode('global')
      }
    }
    window.addEventListener('nostr-user-changed', handler as any)
    return () => window.removeEventListener('nostr-user-changed', handler as any)
  }, [])

  // Listen for header 'open me' action and URL hash changes for hashtag navigation
  useEffect(() => {
    const openMe = () => {
      if (!user?.pubkey) return
      if (!(mode === 'profile' && profilePubkey === user.pubkey)) {
        setPrevView({ mode, profilePubkey })
      }
      setProfilePubkey(user.pubkey)
      setMode('profile')
    }
    const openHashtagFromHeader = (e: Event) => {
      try {
        const ce = e as CustomEvent<{ tag?: string }>
        const raw = (ce as any).detail?.tag as string | undefined
        if (!raw) return
        openHashtag(raw)
      } catch {}
    }

    const handleHashChange = () => {
      try {
        const h = window.location.hash || ''
        // Accept #tag where tag is 1-64 of [a-z0-9_]
        if (/^#[a-z0-9_]{1,64}$/i.test(h)) {
          openHashtag(h)
        }
      } catch {}
    }

    // Initial check on mount
    handleHashChange()

    window.addEventListener('nostr-open-me', openMe as any)
    window.addEventListener('nostr-open-hashtag', openHashtagFromHeader as any)
    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('nostr-open-me', openMe as any)
      window.removeEventListener('nostr-open-hashtag', openHashtagFromHeader as any)
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [user?.pubkey, mode, profilePubkey])

  // Fetch follows (kind 3) list when user is present
  const followsQuery = useQuery({
    queryKey: ['contacts', user?.pubkey ?? 'anon'],
    enabled: !!user?.pubkey,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      if (!user?.pubkey) return [] as string[]
      try {
        const filter: NDKFilter = { kinds: [3], authors: [user.pubkey], limit: 1 }
        const set = await withTimeout(ndk.fetchEvents(filter), 7000, 'fetch follows')
        const latest = Array.from(set).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]
        if (!latest) return [] as string[]
        const pubs = latest.tags
          .filter(t => t[0] === 'p' && typeof t[1] === 'string')
          .map(t => t[1] as string)
        return Array.from(new Set(pubs))
      } catch {
        return [] as string[]
      }
    },
  })

  // Utility to chunk an array
  function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }

  // Profile metadata for profile mode (avatar, name, about, banner)
  const profileMeta = useQuery<{ name: string; picture?: string; about?: string; banner?: string }>({
    queryKey: ['profile-meta', profilePubkey ?? 'none'],
    enabled: mode === 'profile' && !!profilePubkey,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const pub = profilePubkey as string
      const u = ndk.getUser({ pubkey: pub } as any)
      try { await withTimeout(u.fetchProfile(), 5000, 'profile fetch') } catch {}
      const prof: any = (u as any).profile || {}
      const name: string = prof.displayName || prof.display_name || prof.name || prof.nip05 || ''
      const picture: string | undefined = prof.picture || undefined
      const about: string | undefined = prof.about || ''
      const banner: string | undefined = prof.banner || prof.image || undefined
      return { name, picture, about, banner }
    },
  })

  // Detect banner brightness to choose text color
  const [bannerIsLight, setBannerIsLight] = useState<boolean | null>(null)
  useEffect(() => {
    const url = profileMeta.data?.banner
    setBannerIsLight(null)
    if (!url) return
    let cancelled = false
    try {
      const img = new Image()
      ;(img as any).crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const w = 16, h = 16
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) { if (!cancelled) setBannerIsLight(false); return }
          ctx.drawImage(img, 0, 0, w, h)
          const data = ctx.getImageData(0, 0, w, h).data
          let r = 0, g = 0, b = 0, count = 0
          for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; count++ }
          r /= count; g /= count; b /= count
          const L = 0.2126*(r/255) + 0.7152*(g/255) + 0.0722*(b/255)
          if (!cancelled) setBannerIsLight(L > 0.6)
        } catch {
          if (!cancelled) setBannerIsLight(false)
        }
      }
      img.onerror = () => { if (!cancelled) setBannerIsLight(false) }
      img.src = url
    } catch {
      setBannerIsLight(false)
    }
    return () => { cancelled = true }
  }, [profileMeta.data?.banner])

  // When metadata loads, update openedProfiles entry
  useEffect(() => {
    if (mode !== 'profile' || !profilePubkey) return
    const meta = profileMeta.data
    if (!meta) return
    setOpenedProfiles(prev => prev.map(p => p.pubkey === profilePubkey ? { ...p, name: p.name || meta.name, picture: p.picture || meta.picture, about: p.about || meta.about } : p))
  }, [profileMeta.data, profilePubkey, mode])

  // Broadcast active view label to header
  useEffect(() => {
    let label = ''
    if (mode === 'global') label = 'Global'
    else if (mode === 'follows') label = 'Follows'
    else if (mode === 'notifications') label = 'Notifications'
    else if (mode === 'user') label = 'Me'
    else if (mode === 'profile') {
      if (profilePubkey && user?.pubkey && profilePubkey === user.pubkey) label = 'Me'
      else label = (profileMeta.data?.name || (profilePubkey ? shorten(profilePubkey) : 'Profile'))
    } else if (mode === 'hashtag') {
      label = currentHashtag ? `${currentHashtag}` : 'tag'
    }
    try { window.dispatchEvent(new CustomEvent('nostr-active-view', { detail: { label } })) } catch {}
  }, [mode, user?.pubkey, profilePubkey, profileMeta.data?.name, currentHashtag])

  const feedQuery = useInfiniteQuery({
    queryKey:
      mode === 'global'
        ? ['global-feed']
        : mode === 'user'
        ? ['user-feed', user?.pubkey ?? 'anon']
        : mode === 'profile'
        ? ['profile-feed', profilePubkey ?? 'none']
        : mode === 'hashtag'
        ? ['hashtag-feed', currentHashtag || 'none']
        : mode === 'notifications'
        ? ['notifications-feed', user?.pubkey ?? 'anon']
        : ['follows-feed', user?.pubkey ?? 'anon', (followsQuery.data || []).length],
    retry: (failureCount: number) => mode === 'hashtag' ? false : failureCount < 2,
    initialPageParam: null as number | null, // until cursor (unix seconds)
    queryFn: async ({ pageParam }) => {
      // Global, user, profile, hashtag and notifications modes use a single filter
      if (mode === 'global' || mode === 'user' || mode === 'profile' || mode === 'hashtag' || mode === 'notifications') {
        const filter: NDKFilter = {
          kinds: (mode === 'hashtag' || mode === 'global') ? FEED_KINDS_NO_REACTIONS : FEED_KINDS,
          limit: PAGE_SIZE,
        }
        if (mode === 'user' && user?.pubkey) {
          ;(filter as any).authors = [user.pubkey]
        }
        if (mode === 'profile' && profilePubkey) {
          ;(filter as any).authors = [profilePubkey]
        }
        if (mode === 'hashtag' && currentHashtag) {
          ;(filter as any)['#t'] = [currentHashtag]
        }
        if (mode === 'notifications' && user?.pubkey) {
          ;(filter as any)['#p'] = [user.pubkey]
        }
        if (pageParam) {
          ;(filter as any).until = pageParam
        }
        const events = await withTimeout(ndk.fetchEvents(filter), 8000, 'fetch older events')
        const list = Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        // Log when hashtag query hits EOSE with no results
        if (mode === 'hashtag' && currentHashtag && list.length === 0) {
          try {
            console.info(`[hashtag] EOSE: no events received for #${currentHashtag} (initial/older page, until=${pageParam ?? 'none'})`)
          } catch {}
        }
        return list
      }

      // Follows mode: batch authors into groups of 20 per filter
      const follows = (followsQuery.data || []) as string[]
      if (!user?.pubkey) return []
      if (!follows.length) return []

      const filters: NDKFilter[] = chunk(follows, 20).map(group => {
        const f: NDKFilter = { kinds: FEED_KINDS_NO_REACTIONS, authors: group as any, limit: PAGE_SIZE }
        if (pageParam) (f as any).until = pageParam
        return f
      })
      const eventsSet = await withTimeout(ndk.fetchEvents(filters as any), 10000, 'fetch follows older events')
      const merged = Array.from(eventsSet).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      return merged.slice(0, PAGE_SIZE)
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.length === 0) return null
      const oldest = lastPage[lastPage.length - 1]
      const ts = (oldest.created_at || 0) - 1
      return ts > 0 ? ts : null
    },
    refetchOnWindowFocus: false,
    enabled: mode === 'global' || (mode === 'profile' ? !!profilePubkey : mode === 'hashtag' ? !!currentHashtag : mode === 'notifications' ? !!user?.pubkey : !!user?.pubkey),
  })

  // IntersectionObservers to trigger loading more (bottom) and fetching newer (top)
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const queryClient = useQueryClient()
  const [isFetchingNewer, setIsFetchingNewer] = useState(false)
  const lastTopFetchRef = useRef<number>(0)

  // Pull-to-refresh state (top)
  const [pullDistance, setPullDistance] = useState(0)
  const startYRef = useRef<number | null>(null)
  const isPullingRef = useRef(false)
  const PULL_THRESHOLD = 80
  const PULL_MAX = 140

  // Pull-to-load state (bottom)
  const [bottomPullDistance, setBottomPullDistance] = useState(0)
  const bottomStartYRef = useRef<number | null>(null)
  const isBottomPullingRef = useRef(false)
  const BOTTOM_PULL_THRESHOLD = 80
  const BOTTOM_PULL_MAX = 140

  // Back-to-top visibility
  const [showBackToTop, setShowBackToTop] = useState(false)

  // Bottom IO: older pages
  useEffect(() => {
    const el = bottomSentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
          feedQuery.fetchNextPage()
        }
      }
    }, { rootMargin: '120px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [feedQuery.hasNextPage, feedQuery.isFetchingNextPage])

  // Helper: compute newest timestamp in current cache
  const newestTs = useMemo(() => {
    let max = 0
    for (const page of feedQuery.data?.pages || []) {
      for (const ev of page) {
        if (ev.created_at && ev.created_at > max) max = ev.created_at
      }
    }
    return max
  }, [feedQuery.data])

  // Function to fetch newer events and prepend to cache
  const fetchNewer = async () => {
    if (isFetchingNewer) return
    const now = Date.now()
    // throttle: avoid spamming while at top
    if (now - lastTopFetchRef.current < 8000) return
    lastTopFetchRef.current = now
    setIsFetchingNewer(true)
    try {
      if (mode === 'global' || mode === 'user' || mode === 'profile' || mode === 'hashtag' || mode === 'notifications') {
        const filter: NDKFilter = {
          kinds: (mode === 'hashtag' || mode === 'global') ? FEED_KINDS_NO_REACTIONS : FEED_KINDS,
          limit: PAGE_SIZE,
        }
        if (mode === 'user' && user?.pubkey) {
          ;(filter as any).authors = [user.pubkey]
        }
        if (mode === 'profile' && profilePubkey) {
          ;(filter as any).authors = [profilePubkey]
        }
        if (mode === 'hashtag' && currentHashtag) {
          ;(filter as any)['#t'] = [currentHashtag]
        }
        if (mode === 'notifications' && user?.pubkey) {
          ;(filter as any)['#p'] = [user.pubkey]
        }
        if (newestTs > 0) {
          ;(filter as any).since = newestTs + 1
        }
        const eventsSet = await withTimeout(ndk.fetchEvents(filter), 8000, 'fetch newer events')
        const fresh = Array.from(eventsSet).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        if (fresh.length > 0) {
          const key: any = mode === 'global' 
            ? ['global-feed'] 
            : mode === 'profile' 
            ? ['profile-feed', profilePubkey ?? 'none']
            : mode === 'hashtag'
            ? ['hashtag-feed', currentHashtag ?? '']
            : mode === 'notifications'
            ? ['notifications-feed', user?.pubkey ?? 'anon']
            : ['user-feed', user?.pubkey ?? 'anon']
          queryClient.setQueryData<any>(key, (oldData: any) => {
            if (!oldData) return { pages: [fresh], pageParams: [null] }
            return {
              ...oldData,
              pages: [fresh, ...oldData.pages],
              pageParams: [oldData.pageParams?.[0] ?? null, ...oldData.pageParams],
            }
          })
        } else if (mode === 'hashtag' && currentHashtag) {
          try {
            console.info(`[hashtag] EOSE: no newer events for #${currentHashtag} (since=${newestTs > 0 ? newestTs + 1 : 'none'})`)
          } catch {}
        }
      } else if (mode === 'follows') {
        const follows = (followsQuery.data || []) as string[]
        if (!user?.pubkey || !follows.length) return
        const filters: NDKFilter[] = chunk(follows, 20).map(group => {
          const f: NDKFilter = { kinds: FEED_KINDS_NO_REACTIONS, authors: group as any, limit: PAGE_SIZE }
          if (newestTs > 0) (f as any).since = newestTs + 1
          return f
        })
        const eventsSet = await withTimeout(ndk.fetchEvents(filters as any), 10000, 'fetch follows newer events')
        const fresh = Array.from(eventsSet).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        if (fresh.length > 0) {
          const key: any = ['follows-feed', user?.pubkey ?? 'anon']
          queryClient.setQueryData<any>(key, (oldData: any) => {
            if (!oldData) return { pages: [fresh], pageParams: [null] }
            return {
              ...oldData,
              pages: [fresh, ...oldData.pages],
              pageParams: [oldData.pageParams?.[0] ?? null, ...oldData.pageParams],
            }
          })
        }
      }
    } catch (e) {
      // ignore errors; next attempt will retry
    } finally {
      setIsFetchingNewer(false)
    }
  }

  // Top IO: trigger fetchNewer when top sentinel visible (fallback if pull not used)
  useEffect(() => {
    const el = topSentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          fetchNewer()
        }
      }
    }, { rootMargin: '0px' })
    io.observe(el)
    return () => io.disconnect()
  }, []) // Remove newestTs dependency to prevent observer recreation

  // Window-level touch handlers for pull-to-refresh (top) and pull-to-load (bottom)
  useEffect(() => {
    const nearBottom = () => {
      const doc = document.documentElement
      return window.scrollY + window.innerHeight >= doc.scrollHeight - 2
    }

    const onTouchStart = (e: TouchEvent) => {
      const y0 = e.touches[0]?.clientY ?? null
      // Top pull only if at absolute top
      if (window.scrollY <= 0) {
        startYRef.current = y0
        isPullingRef.current = y0 !== null
      }
      // Bottom pull only if at (or extremely near) bottom
      if (nearBottom()) {
        bottomStartYRef.current = y0
        isBottomPullingRef.current = y0 !== null
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0
      // Top pull handling
      if (isPullingRef.current && startYRef.current !== null) {
        const deltaDown = y - startYRef.current
        if (deltaDown > 0) {
          const eased = Math.min(PULL_MAX, deltaDown * 0.6)
          setPullDistance(eased)
        } else {
          setPullDistance(0)
        }
      }
      // Bottom pull handling (dragging up)
      if (isBottomPullingRef.current && bottomStartYRef.current !== null) {
        const deltaUp = bottomStartYRef.current - y
        if (deltaUp > 0) {
          const eased = Math.min(BOTTOM_PULL_MAX, deltaUp * 0.6)
          setBottomPullDistance(eased)
        } else {
          setBottomPullDistance(0)
        }
      }
    }
    const onTouchEnd = () => {
      // Trigger top refresh if threshold met
      if (pullDistance >= PULL_THRESHOLD) {
        fetchNewer()
      }
      // Trigger bottom load if threshold met
      if (
        bottomPullDistance >= BOTTOM_PULL_THRESHOLD &&
        feedQuery.hasNextPage &&
        !feedQuery.isFetchingNextPage
      ) {
        feedQuery.fetchNextPage()
      }
      // Reset state
      setPullDistance(0)
      startYRef.current = null
      isPullingRef.current = false

      setBottomPullDistance(0)
      bottomStartYRef.current = null
      isBottomPullingRef.current = false
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart as any)
      window.removeEventListener('touchmove', onTouchMove as any)
      window.removeEventListener('touchend', onTouchEnd as any)
    }
  }, [pullDistance, bottomPullDistance, feedQuery.hasNextPage, feedQuery.isFetchingNextPage])

  // Show back-to-top button after half-screen scroll
  useEffect(() => {
    const onScroll = () => {
      try {
        setShowBackToTop(window.scrollY > window.innerHeight / 2)
      } catch {}
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true } as any)
    return () => window.removeEventListener('scroll', onScroll as any)
  }, [])

  // Scroll to top and then trigger a refresh for newer items
  const goTopAndRefresh = () => {
    const trigger = () => {
      // small delay to ensure layout settled at top
      setTimeout(() => { fetchNewer() }, 50)
    }
    if (window.scrollY <= 0) {
      trigger()
      return
    }
    let done = false
    const onTop = () => {
      if (!done && window.scrollY <= 0) {
        done = true
        window.removeEventListener('scroll', onTop)
        trigger()
      }
    }
    window.addEventListener('scroll', onTop)
    // Fast smooth scroll
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      window.scrollTo(0, 0)
    }
    // Fallback timeout in case scroll event doesn't fire
    setTimeout(() => {
      if (!done) {
        done = true
        window.removeEventListener('scroll', onTop)
        trigger()
      }
    }, 1200)
  }

  // Get user's mute list for filtering
  const muteList = useMemo(() => {
    if (!user?.pubkey) return new Set<string>()
    try {
      const ndkUser = ndk.getUser({ pubkey: user.pubkey })
      // Access mutelist as a custom property with type assertion
      const mutelist = (ndkUser as any).mutelist
      if (mutelist && Array.isArray(mutelist)) {
        return new Set(mutelist.map((item: any) => typeof item === 'string' ? item : item.pubkey).filter(Boolean))
      }
    } catch (error) {
      console.warn('Failed to get mute list:', error)
    }
    return new Set<string>()
  }, [user?.pubkey])

  // Flatten and de-duplicate by event id
  const events: NDKEvent[] = useMemo(() => {
    const map = new Map<string, NDKEvent>()
    for (const page of feedQuery.data?.pages || []) {
      for (const ev of page) {
        if (ev.id && !map.has(ev.id)) {
          // Filter out events from muted users for follows and notifications feeds
          if ((mode === 'follows' || mode === 'notifications') && ev.pubkey && muteList.has(ev.pubkey)) {
            continue
          }
          // Filter out events that mention muted users for follows and notifications feeds
          if ((mode === 'follows' || mode === 'notifications') && ev.tags) {
            const mentionsMutedUser = ev.tags.some(tag => 
              tag[0] === 'p' && tag[1] && muteList.has(tag[1])
            )
            if (mentionsMutedUser) continue
          }
          map.set(ev.id, ev)
        }
      }
    }
    // Return in newest-first order
    return Array.from(map.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  }, [feedQuery.data, mode, muteList])
  
  // Auto-refresh: periodically check connection and refresh feed content
  useEffect(() => {
    // Don't run auto-refresh if no feeds are enabled
    if (!feedQuery.data) return
    
    // Check connection and fetch new content every 45 seconds
    const refreshInterval = setInterval(async () => {
      try {
        // Check connection status
        const connectionStatus = getConnectionStatus()
        const activeRelays = connectionStatus.activeRelays
        
        // If we have less than 2 active relay connections, try reconnecting
        if (activeRelays < 2) {
          console.info('[auto-refresh] Connection weak or lost, attempting to reconnect...')
          await initializeNDK(5000)
        }
        
        // Fetch newer content regardless of connection status
        // (it will use the reconnected relays if we just reconnected)
        console.info('[auto-refresh] Auto-refreshing feed content...')
        fetchNewer()
      } catch (error) {
        console.warn('[auto-refresh] Auto-refresh error:', error)
      }
    }, 45000) // 45 seconds interval
    
    return () => clearInterval(refreshInterval)
  }, [feedQuery.data, fetchNewer])

  // Extract a unique set of hashtag tags from cached events and broadcast to header
  const cachedHashtags = useMemo(() => {
    const set = new Set<string>()
    for (const ev of events) {
      try {
        const tags = extractHashtagTags((ev as any)?.tags)
        for (const t of tags) set.add(t)
      } catch {}
    }
    return Array.from(set).sort()
  }, [events])

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('nostr-hashtags-cache', { detail: { tags: cachedHashtags } })) } catch {}
  }, [cachedHashtags])

  // Close the current profile and activate the one at the top
  const closeCurrentProfileAndRestore = () => {
    const current = profilePubkey
    if (!current) return
    // remove current from opened list
    const after = openedProfiles.filter(p => p.pubkey !== current)
    setOpenedProfiles(after)

    // Always activate the first (top) tab if any remain, else Global
    if (after.length > 0) {
      setProfilePubkey(after[0].pubkey)
      setMode('profile')
    } else {
      setProfilePubkey(null)
      setMode('global')
    }
  }

  // Close the current note and restore previous view
  const closeCurrentNoteAndRestore = () => {
    const current = currentNoteId
    if (!current) return
    const restore = prevView
    const after = openedNotes.filter(n => n.id !== current)
    setOpenedNotes(after)

    if (restore) {
      if (restore.mode === 'note' && restore.noteId && after.some(n => n.id === restore.noteId)) {
        setCurrentNoteId(restore.noteId)
        setMode('note')
      } else {
        setCurrentNoteId(null)
        if (restore.mode === 'profile' && restore.profilePubkey) {
          setProfilePubkey(restore.profilePubkey)
        }
        setMode(restore.mode)
      }
      setPrevView(null)
      return
    }

    if (after.length > 0) {
      setCurrentNoteId(after[0].id)
      setMode('note')
    } else {
      setCurrentNoteId(null)
      setMode('global')
    }
  }

  // Remove a specific note tab (if it's the active one, use the full close-and-restore flow)
  const removeNoteTab = (id: string) => {
    if (id === currentNoteId) {
      closeCurrentNoteAndRestore()
      return
    }
    setOpenedNotes(prev => prev.filter(n => n.id !== id))
  }

  // Remove a specific profile tab (if it's the active one, use the full close-and-restore flow)
  const removeProfileTab = (pub: string) => {
    if (pub === profilePubkey) {
      closeCurrentProfileAndRestore()
      return
    }
    setOpenedProfiles(prev => prev.filter(p => p.pubkey !== pub))
  }

  return (
    <>
      {/* Left sidebar with feed mode buttons - only show when screen is wide enough */}
      {canFitSidebar && (
        <div className="fixed left-0 top-12 z-40 flex flex-col gap-2 p-0 bg-black h-full">
          {/* Opened note tabs */}
          {openedNotes.map((n) => (
            <div key={n.id} className="relative inline-block group">
              <button
                aria-label={`Note ${n.id}`}
                onClick={() => { if (!(mode === 'note' && currentNoteId === n.id)) { setPrevView({ mode, profilePubkey, noteId: currentNoteId }) }; setCurrentNoteId(n.id); setMode('note') }}
                className={`w-32 h-12 ${mode === 'note' && currentNoteId === n.id ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-start px-3`}
                title={`Open note ${n.id}`}
              >
                <ThreadReelIcon className="w-6 h-6 text-[#cccccc]" />
                <span className="ml-2 text-[#cccccc] select-none truncate">Note {n.id.slice(0, 8)}…</span>
              </button>
              <button
                type="button"
                aria-label="Close note tab"
                className="flex items-center justify-center absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeNoteTab(n.id) }}
                title="Close tab"
              >
                ×
              </button>
            </div>
          ))}
          {/* Opened profile tabs */}
          {openedProfiles.filter(p => !(user && p.pubkey === user.pubkey)).map((p) => (
            <div key={p.pubkey} className="relative inline-block group">
              <button
                aria-label={`Profile ${p.name || p.npub || p.pubkey}`}
                onClick={() => { if (!(mode === 'profile' && profilePubkey === p.pubkey)) { setPrevView({ mode, profilePubkey }) }; setProfilePubkey(p.pubkey); setMode('profile') }}
                className={`w-12 xl:w-32 h-16 ${mode === 'profile' && profilePubkey === p.pubkey ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-start xl:justify-start xl:px-3`}
                title={`Open ${p.name || p.npub || 'profile'}`}
              >
                {p.picture ? (
                  <img src={p.picture} alt="avatar" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <UserIcon className="w-8 h-8 text-[#cccccc]" />
                )}
                <span className="hidden xl:inline ml-2 text-[#cccccc] select-none truncate">{p.name || (p.npub ? p.npub.slice(0, 10) + '…' : shorten(p.pubkey))}</span>
              </button>
              <div className="absolute left-12 top-1/2 -translate-y-1/2 z-20 xl:hidden pointer-events-none pl-2 pr-8">
                <span className="text-[#cccccc] select-none truncate">{p.name || (p.npub ? p.npub.slice(0, 10) + '…' : shorten(p.pubkey))}</span>
              </div>
              {/* Hover close button (wide mode) */}
              <button
                type="button"
                aria-label="Close profile tab"
                className="hidden xl:flex items-center justify-center absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeProfileTab(p.pubkey) }}
                title="Close tab"
              >
                ×
              </button>
            </div>
          ))}
          {/* Opened hashtag tabs */}
          {openedHashtags.map((t) => (
            <div key={`tag-${t}`} className="relative inline-block group">
              <button
                aria-label={`Hashtag #${t}`}
                onClick={() => { if (!(mode === 'hashtag' && currentHashtag === t)) { setPrevView({ mode, profilePubkey, noteId: currentNoteId }) }; setCurrentHashtag(t); setMode('hashtag') }}
                className={`w-12 xl:w-32 h-12 ${mode === 'hashtag' && currentHashtag === t ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-start px-3 relative overflow-hidden`}
                title={`Open #${t}`}
              >
                <span className="text-[#cccccc] select-none whitespace-nowrap">#{t}</span>
                <div className={`absolute right-0 top-0 w-3 h-full bg-gradient-to-l ${mode === 'hashtag' && currentHashtag === t ? 'from-[#162a2f]' : 'from-black group-hover:from-[#1b3a40]'} to-transparent pointer-events-none`}></div>
              </button>
              <button
                type="button"
                aria-label="Close hashtag tab"
                className="flex items-center justify-center absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeHashtagTab(t) }}
                title="Close tab"
              >
                ×
              </button>
            </div>
          ))}
          {user && (
              <div className="relative inline-block group">
                <button
                    aria-label="Follows feed"
                    onClick={() => setMode('follows')}
                    className={`w-12 xl:w-32 h-12 ${mode === 'follows' ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-center xl:justify-start xl:px-3`}
                    title={'Show posts from people you follow'}
                >
                  <UsersIcon className="w-6 h-6 text-[#cccccc]" />
                  <span className="hidden xl:inline ml-2 text-[#cccccc] select-none">Follows</span>
                </button>
              </div>
          )}
          {user && (
              <div className="relative inline-block group">
                <button
                    aria-label="Notifications feed"
                    onClick={() => setMode('notifications')}
                    className={`w-12 xl:w-32 h-12 ${mode === 'notifications' ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-center xl:justify-start xl:px-3`}
                    title={'Show notifications and mentions'}
                >
                  <BellIcon className="w-6 h-6 text-[#cccccc]" />
                  <span className="hidden xl:inline ml-2 text-[#cccccc] select-none">Notifications</span>
                </button>
              </div>
          )}
          <div className="relative inline-block group">
            <button
                aria-label="Global feed"
                onClick={() => setMode('global')}
                className={`w-12 xl:w-32 h-12 ${mode === 'global' ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-center xl:justify-start xl:px-3`}
            >
              <GlobeIcon className="w-6 h-6 text-[#cccccc]" />
              <span className="hidden xl:inline ml-2 text-[#cccccc] select-none">Global</span>
            </button>
          </div>
        </div>
      )}

      <div ref={layoutRef} className={`relative ${canFitSidebar ? 'ml-[calc(3rem+1em)] xl:ml-[calc(8rem+1em)]' : 'ml-0'} flex items-start gap-4`}>
        <div ref={mainColRef} className="w-full max-w-2xl flex-shrink-0">
          {(mode === 'user' || mode === 'follows' || mode === 'notifications') && !user ? (
            <div className="bg-[#162a2f] rounded-xl p-6">
              <p>Please use the Login button in the top bar to view this feed.</p>
            </div>
          ) : (
            <div className="bg-[#162a2f] rounded-xl divide-y divide-[#37474f] overflow-hidden shadow-lg relative">
              {/* Profile header */}
              {mode === 'profile' && (
                <div className={`relative w-full ${profileMeta.data?.banner ? '' : 'bg-[#1a2529]'}`}>
                  {/* Banner background */}
                  {profileMeta.data?.banner && (
                    <div
                      className="absolute inset-0 bg-center bg-cover"
                      style={{ backgroundImage: `url(${profileMeta.data.banner})` }}
                      aria-hidden="true"
                    />
                  )}
                  {/* Overlay to ensure readability */}
                  {profileMeta.data?.banner && <div className="absolute inset-0 bg-black/30" aria-hidden="true" />}
                  <div className="relative p-4 flex items-start gap-4">
                    {profileMeta.data?.picture ? (
                      <img src={profileMeta.data.picture} alt="avatar" className="w-20 h-20 rounded-full object-cover ring-2 ring-black/40" />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-black/50 flex items-center justify-center text-[#cccccc] ring-2 ring-black/40">
                        <UserIcon className="w-10 h-10" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="bg-black/60 rounded p-[0.5em]">
                        <div className="text-[#f0f0f0] text-xl font-semibold mb-1 truncate">
                          {profileMeta.data?.name || shorten(profilePubkey || '')}
                        </div>
                        {profileMeta.data?.about ? (
                          <div className="whitespace-pre-wrap break-words text-[#f0f0f0]">
                            {profileMeta.data.about}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {!(user && profilePubkey && user.pubkey === profilePubkey) && (
                      <div className="ml-2">
                        <button
                          type="button"
                          aria-label="Close profile view"
                          onClick={closeCurrentProfileAndRestore}
                          className={`${bannerIsLight ? 'bg-white/70 text-black hover:bg-white' : 'bg-[#162a2f] text-[#cccccc] hover:bg-[#1b3a40]'} px-3 py-1 rounded`}
                          title="Close profile"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {mode === 'note' && (
                <div className="relative w-full bg-[#1a2529]">
                  <div className="relative p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xl text-[#f0f0f0]">
                      <ThreadReelIcon className="w-6 h-6" />
                      <div className="font-semibold">Note</div>
                    </div>
                    <div className="ml-2">
                      <button
                        type="button"
                        aria-label="Close note view"
                        onClick={closeCurrentNoteAndRestore}
                        className="bg-[#162a2f] text-[#cccccc] hover:bg-[#1b3a40] px-3 py-1 rounded"
                        title="Close note"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {mode !== 'note' && (
                <>
                  {/* Pull-to-refresh area (appears when pulling or fetching newer) */}
                  <div
                    className="w-full bg-black text-white flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
                    style={{ height: (isFetchingNewer ? 64 : Math.max(0, Math.min(120, pullDistance))) + 'px' }}
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {(pullDistance > 0 || isFetchingNewer) && (
                      <div className="flex items-center gap-2 py-2">
                        <Spinner />
                        <span className="text-sm">{isFetchingNewer ? 'Refreshing…' : pullDistance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}</span>
                      </div>
                    )}
                  </div>
                  {/* Top sentinel for fetching newer events */}
                  <div ref={topSentinelRef} />
                </>
              )}
              {mode === 'note' && currentNoteId ? (
                <SingleNoteView
                  id={currentNoteId}
                  scopeId={`note:${currentNoteId}`}
                  openMedia={setMediaToShow}
                  openProfileByBech={openProfileByBech}
                  openProfileByPubkey={openProfileByPubkey}
                  onReply={onReplyScoped(`note:${currentNoteId}`)}
                  onRepost={onRepost}
                  onQuote={onQuote}
                  onOpenNote={openNoteForEvent}
                  actionMessage={actionMessages[currentNoteId]}
                  replyOpen={replyOpen}
                  replyBuffers={replyBuffers}
                  onChangeReplyText={changeReplyText}
                  onCloseReply={closeReply}
                  onSendReply={sendReply}
                  openHashtag={openHashtag}
                />
              ) : events.length === 0 && feedQuery.isLoading ? (
                <div className="p-6">Loading feed…</div>
              ) : (
                events.map((ev) => {
                  // For notifications mode, use compact display for reactions
                  if (mode === 'notifications' && ev.kind === 7) {
                    return (
                      <CompactReactionNote
                        key={ev.id || `${ev.created_at}-${Math.random()}`}
                        ev={ev}
                        openProfileByPubkey={openProfileByPubkey}
                        userPubkey={user?.pubkey}
                      />
                    )
                  }
                  
                  // For user's feed, use special display for reactions (no interaction buttons)
                  if (mode === 'user' && ev.kind === 7) {
                    return (
                      <CompactReactionNote
                        key={ev.id || `${ev.created_at}-${Math.random()}`}
                        ev={ev}
                        openProfileByPubkey={openProfileByPubkey}
                        userPubkey={user?.pubkey}
                      />
                    )
                  }
                  
                  // For profile feeds, use special display for reactions that shows the embedded note
                  if (mode === 'profile' && ev.kind === 7) {
                    return (
                      <CompactReactionNote
                        key={ev.id || `${ev.created_at}-${Math.random()}`}
                        ev={ev}
                        openProfileByPubkey={openProfileByPubkey}
                        userPubkey={user?.pubkey}
                      />
                    )
                  }
                  
                  // Regular note card for all other events
                  return (
                    <NoteCard
                      key={ev.id || `${ev.created_at}-${Math.random()}`}
                      ev={ev}
                      scopeId={'feed'}
                      onReply={onReplyScoped('feed')}
                      onRepost={onRepost}
                      onQuote={onQuote}
                      onOpenThread={openThreadFor}
                      onOpenNote={openNoteForEvent}
                      openMedia={setMediaToShow}
                      openProfileByBech={openProfileByBech}
                      openProfileByPubkey={openProfileByPubkey}
                      activeThreadRootId={threadRootId}
                      actionMessages={actionMessages}
                      replyOpen={replyOpen}
                      replyBuffers={replyBuffers}
                      onChangeReplyText={changeReplyText}
                      onCloseReply={closeReply}
                      onSendReply={sendReply}
                      openHashtag={openHashtag}
                      userFollows={followsQuery.data || []}
                      userPubkey={user?.pubkey}
                      repostMode={repostMode}
                      onCancelRepost={cancelRepost}
                      quoteOpen={quoteOpen}
                      quoteBuffers={quoteBuffers}
                      onChangeQuoteText={changeQuoteText}
                      onCloseQuote={closeQuote}
                      onSendQuote={sendQuote}
                    />
                  )
                })
              )}
              {mode !== 'note' && !feedQuery.hasNextPage && events.length > 0 && (
                <div className="p-4 text-sm opacity-60">No more results.</div>
              )}

              {mode !== 'note' && (
                <>
                  {/* Bottom pull-to-load area (appears when pulling up or fetching next) */}
                  <div
                    className="w-full bg-black text-white flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
                    style={{ height: ((feedQuery.isFetchingNextPage ? 64 : Math.max(0, Math.min(120, bottomPullDistance)))) + 'px' }}
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {(bottomPullDistance > 0 || feedQuery.isFetchingNextPage) && (
                      <div className="flex items-center gap-2 py-2">
                        <Spinner />
                        <span className="text-sm">{feedQuery.isFetchingNextPage ? 'Loading more…' : bottomPullDistance >= BOTTOM_PULL_THRESHOLD ? 'Release to load more' : 'Pull up to load more'}</span>
                      </div>
                    )}
                  </div>

                  {/* Bottom sentinel for infinite scroll */}
                  <div ref={bottomSentinelRef} />
                </>
              )}

              {threadRootId && (
                <ThreadModal
                  rootId={threadRootId}
                  seedId={threadOpenSeed || undefined}
                  onClose={() => setThreadRootId(null)}
                  openMedia={setMediaToShow}
                  openProfileByBech={openProfileByBech}
                  openProfileByPubkey={openProfileByPubkey}
                  onReply={onReplyScoped(`thread-modal:${threadRootId}`)}
                  onRepost={onRepost}
                  onQuote={onQuote}
                  onOpenNote={openNoteForEvent}
                  actionMessages={actionMessages}
                  replyOpen={replyOpen}
                  replyBuffers={replyBuffers}
                  onChangeReplyText={changeReplyText}
                  onCloseReply={closeReply}
                  onSendReply={(id) => sendReply(`thread-modal:${threadRootId}|${id}`)}
                  activeReplyTargetId={threadActiveReplyTargetKey ? threadActiveReplyTargetKey.split('|')[1] : null}
                  replyText={threadActiveReplyTargetKey ? (replyBuffers[threadActiveReplyTargetKey] || '') : ''}
                  onChangeThreadReplyText={changeThreadReplyText}
                  onCloseThreadReply={closeThreadReply}
                  openHashtag={openHashtag}
                  repostMode={repostMode}
                  onCancelRepost={cancelRepost}
                  quoteOpen={quoteOpen}
                  quoteBuffers={quoteBuffers}
                  onChangeQuoteText={changeQuoteText}
                  onCloseQuote={closeQuote}
                  onSendQuote={sendQuote}
                />
              )}
            </div>
          )}
        </div>
        {openedThreads.length > 0 && canFitBoth && !isThreadsHiddenInWideMode && (
          <div className="w-full max-w-2xl flex-shrink-0 sticky top-12 self-start">
            <div className="bg-[#162a2f] rounded-xl shadow-lg overflow-hidden">
              <div className="px-4 py-3 bg-[#1a2529] border-b border-[#37474f]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[#fff3b0] font-semibold">
                    <ThreadReelIcon className="w-5 h-5" />
                    Opened Threads
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsThreadsHiddenInWideMode(true)}
                    className="w-8 h-8 rounded-full bg-black/70 text-white hover:bg-black/90 flex items-center justify-center"
                    aria-label="Hide threads"
                    title="Hide threads"
                  >
                    ↓
                  </button>
                </div>
              </div>
              <div className="max-h-[calc(100vh-6rem)] overflow-y-auto">
                <ThreadsStackView
                  openedThreads={openedThreads}
                  threadTriggerNotes={threadTriggerNotes}
                  openMedia={setMediaToShow}
                  openProfileByBech={openProfileByBech}
                  openProfileByPubkey={openProfileByPubkey}
                  onReply={onReplyScoped}
                  onRepost={onRepost}
                  onQuote={onQuote}
                  onOpenNote={openNoteForEvent}
                  actionMessages={actionMessages}
                  replyOpen={replyOpen}
                  replyBuffers={replyBuffers}
                  onChangeReplyText={changeReplyText}
                  onCloseReply={closeReply}
                  onSendReply={sendReply}
                  openHashtag={openHashtag}
                  onOpenThreadAsMain={(rootId) => {
                    // Switch to note mode but treat it as a full thread view
                    setCurrentNoteId(rootId);
                    setMode('note');
                  }}
                  onCloseThread={closeThreadFromStack}
                  userFollows={followsQuery.data || []}
                  repostMode={repostMode}
                  onCancelRepost={cancelRepost}
                  quoteOpen={quoteOpen}
                  quoteBuffers={quoteBuffers}
                  onChangeQuoteText={changeQuoteText}
                  onCloseQuote={closeQuote}
                  onSendQuote={sendQuote}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating threads button for narrow screens */}
      {openedThreads.length > 0 && !canFitBoth && !isThreadsModalOpen && (
        <div className="fixed bottom-6 right-6 z-[100]">
          <button
            type="button"
            onClick={() => setIsThreadsModalOpen(true)}
            className="w-14 h-14 rounded-full bg-[#162a2f] text-[#fff3b0] shadow-lg hover:bg-[#1b3a40] flex items-center justify-center"
            title="Open threads"
            aria-label="Open threads"
          >
            <ThreadReelIcon className="w-7 h-7" />
          </button>
        </div>
      )}

      {/* Floating threads button for wide screens when threads are hidden */}
      {openedThreads.length > 0 && canFitBoth && isThreadsHiddenInWideMode && (
        <div className="fixed bottom-6 right-6 z-[100]">
          <button
            type="button"
            onClick={() => setIsThreadsHiddenInWideMode(false)}
            className="w-14 h-14 rounded-full bg-[#162a2f] text-[#fff3b0] shadow-lg hover:bg-[#1b3a40] flex items-center justify-center"
            title="Show threads"
            aria-label="Show threads"
          >
            <ThreadReelIcon className="w-7 h-7" />
          </button>
        </div>
      )}

      {showBackToTop && (
        <div className={`fixed bottom-6 z-[100] flex items-center gap-3 ${(openedThreads.length > 0 && !canFitBoth && !isThreadsModalOpen) || (openedThreads.length > 0 && canFitBoth && isThreadsHiddenInWideMode) ? 'right-24' : 'right-6'}`}>
          <button
            type="button"
            onClick={goTopAndRefresh}
            className="rounded-full bg-[#162a2f] text-[#cccccc] shadow hover:bg-[#1b3a40] px-4 h-12 flex items-center"
            title="Back to top"
          >
            Back to top
          </button>
          <button
              type="button"
              aria-label="Back to top"
              onClick={goTopAndRefresh}
              className="w-12 h-12 rounded-full bg-[#162a2f] text-[#cccccc] shadow hover:bg-[#1b3a40] flex items-center justify-center"
              title="Back to top"
          >
            <UpArrowIcon className="w-6 h-6" />
          </button>
        </div>
      )}


      {/* Threads Modal for narrow screens */}
      {openedThreads.length > 0 && !canFitBoth && isThreadsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/60">
          {/* Modal backdrop - click to close */}
          <div 
            className="absolute inset-0" 
            onClick={() => setIsThreadsModalOpen(false)}
          />
          {/* Modal content */}
          <div className="relative w-full max-w-2xl h-full bg-[#162a2f] shadow-2xl flex flex-col mr-4 mt-4 mb-4 rounded-xl overflow-hidden">
            {/* Header with close button */}
            <div className="px-4 py-3 bg-[#1a2529] border-b border-[#37474f] flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#fff3b0] font-semibold">
                <ThreadReelIcon className="w-5 h-5" />
                Opened Threads
              </div>
              <button
                type="button"
                onClick={() => setIsThreadsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-black/70 text-white hover:bg-black/90 flex items-center justify-center"
                aria-label="Close threads"
              >
                ×
              </button>
            </div>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              <ThreadsStackView
                openedThreads={openedThreads}
                threadTriggerNotes={threadTriggerNotes}
                openMedia={setMediaToShow}
                openProfileByBech={openProfileByBech}
                openProfileByPubkey={openProfileByPubkey}
                onReply={onReplyScoped}
                onRepost={onRepost}
                onQuote={onQuote}
                onOpenNote={openNoteForEvent}
                actionMessages={actionMessages}
                replyOpen={replyOpen}
                replyBuffers={replyBuffers}
                onChangeReplyText={changeReplyText}
                onCloseReply={closeReply}
                onSendReply={sendReply}
                openHashtag={openHashtag}
                onOpenThreadAsMain={(rootId) => {
                  // Switch to note mode but treat it as a full thread view
                  setCurrentNoteId(rootId);
                  setMode('note');
                  setIsThreadsModalOpen(false);
                }}
                onCloseThread={closeThreadFromStack}
                userFollows={followsQuery.data || []}
                repostMode={repostMode}
                onCancelRepost={cancelRepost}
                quoteOpen={quoteOpen}
                quoteBuffers={quoteBuffers}
                onChangeQuoteText={changeQuoteText}
                onCloseQuote={closeQuote}
                onSendQuote={sendQuote}
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating sidebar button for narrow screens */}
      {!canFitSidebar && (openedNotes.length > 0 || openedProfiles.length > 0 || openedHashtags.length > 0) && !isSidebarDrawerOpen && (
        <div className="fixed bottom-6 left-6 z-[100]">
          <button
            type="button"
            onClick={() => setIsSidebarDrawerOpen(true)}
            className="w-14 h-14 rounded-full bg-[#162a2f] text-[#fff3b0] shadow-lg hover:bg-[#1b3a40] flex items-center justify-center"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}

      {/* Sidebar Drawer Modal for narrow screens */}
      {!canFitSidebar && isSidebarDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-start bg-black/60">
          {/* Modal backdrop - click to close */}
          <div 
            className="absolute inset-0" 
            onClick={() => setIsSidebarDrawerOpen(false)}
          />
          {/* Modal content */}
          <div className="relative w-full max-w-2xl h-full bg-[#162a2f] shadow-2xl flex flex-col ml-4 mt-4 mb-4 rounded-xl overflow-hidden">
            {/* Header with close button */}
            <div className="px-4 py-3 bg-[#1a2529] border-b border-[#37474f] flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#fff3b0] font-semibold">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Navigation
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarDrawerOpen(false)}
                className="w-8 h-8 rounded-full bg-black/70 text-white hover:bg-black/90 flex items-center justify-center"
                aria-label="Close sidebar"
              >
                ×
              </button>
            </div>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-2">
                {/* Opened note tabs */}
                {openedNotes.map((n) => (
                  <div key={n.id} className="relative group">
                    <button
                      aria-label={`Note ${n.id}`}
                      onClick={() => { 
                        if (!(mode === 'note' && currentNoteId === n.id)) { 
                          setPrevView({ mode, profilePubkey, noteId: currentNoteId }) 
                        }; 
                        setCurrentNoteId(n.id); 
                        setMode('note');
                        setIsSidebarDrawerOpen(false);
                      }}
                      className={`w-full h-12 ${mode === 'note' && currentNoteId === n.id ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-start px-3 rounded`}
                      title={`Open note ${n.id}`}
                    >
                      <ThreadReelIcon className="w-6 h-6 text-[#cccccc]" />
                      <span className="ml-2 text-[#cccccc] select-none truncate">Note {n.id.slice(0, 8)}…</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Close note tab"
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeNoteTab(n.id) }}
                      title="Close tab"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {/* Opened profile tabs */}
                {openedProfiles.filter(p => !(user && p.pubkey === user.pubkey)).map((p) => (
                  <div key={p.pubkey} className="relative group">
                    <button
                      aria-label={`Profile ${p.name || p.npub || p.pubkey}`}
                      onClick={() => { 
                        if (!(mode === 'profile' && profilePubkey === p.pubkey)) { 
                          setPrevView({ mode, profilePubkey }) 
                        }; 
                        setProfilePubkey(p.pubkey); 
                        setMode('profile');
                        setIsSidebarDrawerOpen(false);
                      }}
                      className={`w-full h-16 ${mode === 'profile' && profilePubkey === p.pubkey ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-start px-3 rounded`}
                      title={`Open ${p.name || p.npub || 'profile'}`}
                    >
                      {p.picture ? (
                        <img src={p.picture} alt="avatar" className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <UserIcon className="w-8 h-8 text-[#cccccc]" />
                      )}
                      <span className="ml-2 text-[#cccccc] select-none truncate">{p.name || (p.npub ? p.npub.slice(0, 10) + '…' : shorten(p.pubkey))}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Close profile tab"
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeProfileTab(p.pubkey) }}
                      title="Close tab"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {/* Opened hashtag tabs */}
                {openedHashtags.map((t) => (
                  <div key={`tag-${t}`} className="relative group">
                    <button
                      aria-label={`Hashtag #${t}`}
                      onClick={() => { 
                        if (!(mode === 'hashtag' && currentHashtag === t)) { 
                          setPrevView({ mode, profilePubkey, noteId: currentNoteId }) 
                        }; 
                        setCurrentHashtag(t); 
                        setMode('hashtag');
                        setIsSidebarDrawerOpen(false);
                      }}
                      className={`w-full h-12 ${mode === 'hashtag' && currentHashtag === t ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-start px-3 rounded`}
                      title={`Open #${t}`}
                    >
                      <span className="text-[#cccccc] select-none truncate">#{t}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Close hashtag tab"
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeHashtagTab(t) }}
                      title="Close tab"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {/* Feed mode buttons */}
                {user && (
                  <button
                    aria-label="Follows feed"
                    onClick={() => { setMode('follows'); setIsSidebarDrawerOpen(false); }}
                    className={`w-full h-12 ${mode === 'follows' ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-start px-3 rounded`}
                    title={'Show posts from people you follow'}
                  >
                    <UsersIcon className="w-6 h-6 text-[#cccccc]" />
                    <span className="ml-2 text-[#cccccc] select-none">Follows</span>
                  </button>
                )}
                {user && (
                  <button
                    aria-label="Notifications feed"
                    onClick={() => { setMode('notifications'); setIsSidebarDrawerOpen(false); }}
                    className={`w-full h-12 ${mode === 'notifications' ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-start px-3 rounded`}
                    title={'Show notifications and mentions'}
                  >
                    <BellIcon className="w-6 h-6 text-[#cccccc]" />
                    <span className="ml-2 text-[#cccccc] select-none">Notifications</span>
                  </button>
                )}
                <button
                  aria-label="Global feed"
                  onClick={() => { setMode('global'); setIsSidebarDrawerOpen(false); }}
                  className={`w-full h-12 ${mode === 'global' ? 'bg-[#162a2f]' : 'bg-black hover:bg-[#1b3a40]'} flex items-center justify-start px-3 rounded`}
                >
                  <GlobeIcon className="w-6 h-6 text-[#cccccc]" />
                  <span className="ml-2 text-[#cccccc] select-none">Global</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mediaToShow && (
        <MediaModal gallery={mediaToShow} onClose={() => setMediaToShow(null)} />
      )}
    </>
  )
}

function shorten(s: string, n = 8) {
  if (!s) return ''
  return s.length <= n ? s : `${s.slice(0, n)}…`
}

export function formatTime(ts?: number) {
  if (!ts) return ''
  try {
    const d = new Date(ts * 1000)
    return d.toLocaleString()
  } catch {
    return ''
  }
}

// Simple thread fetching following jumble's pattern - focus on direct replies
export async function fetchThreadEvents(
  rootId: string,
  kinds: number[] = [1, 6, 1111, 30023, 9802, 1068, 1222, 1244, 20, 21, 22]
): Promise<NDKEvent[]> {
  try {
    // Fetch direct replies to the root event
    const filter: NDKFilter = { kinds: kinds as any, '#e': [rootId], limit: 500 }
    const set = await withTimeout(ndk.fetchEvents(filter as any), 8000, 'fetch thread replies')
    return Array.from(set).sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
  } catch {
    return []
  }
}

function ThreadModal({ rootId, seedId: _seedId, onClose, openMedia, openProfileByBech, openProfileByPubkey, onReply, onRepost, onQuote, onOpenNote, actionMessages, replyOpen, replyBuffers, onChangeReplyText: onChangeReplyTextById, onCloseReply: onCloseReplyById, onSendReply, activeReplyTargetId, replyText, onChangeReplyText, onCloseReply, onChangeThreadReplyText, onCloseThreadReply, openHashtag, repostMode, onCancelRepost, quoteOpen, quoteBuffers, onChangeQuoteText, onCloseQuote, onSendQuote }: { rootId: string; seedId?: string; onClose: () => void; openMedia: (g: MediaGallery) => void; openProfileByBech: (bech: string) => void; openProfileByPubkey: (pubkey: string) => void; onReply: (e: NDKEvent) => void; onRepost: (e: NDKEvent) => void; onQuote: (e: NDKEvent) => void; onOpenNote: (e: NDKEvent) => void; actionMessages?: Record<string, string>; replyOpen?: Record<string, boolean>; replyBuffers?: Record<string, string>; onChangeReplyText?: (id: string, v: string) => void; onCloseReply?: (id: string) => void; onSendReply?: (targetId: string) => void; activeReplyTargetId?: string | null; replyText?: string; onChangeReplyText?: (v: string) => void; onCloseReply?: () => void; onChangeThreadReplyText?: (v: string) => void; onCloseThreadReply?: () => void; openHashtag?: (tag: string) => void; repostMode?: Record<string, boolean>; onCancelRepost?: (e: NDKEvent) => void; quoteOpen?: Record<string, boolean>; quoteBuffers?: Record<string, string>; onChangeQuoteText?: (id: string, v: string) => void; onCloseQuote?: (id: string) => void; onSendQuote?: (targetId: string) => void }) {
  const scopeId = `thread-modal:${rootId}`
  // Fetch root event
  const { data: root } = useQuery<NDKEvent | null>({
    queryKey: ['thread-root', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [rootId] } as any), 8000, 'fetch thread root')
        return Array.from(set)[0] || null
      } catch {
        return null
      }
    },
  })

  // Fetch direct thread replies following jumble's pattern
  const { data: children } = useQuery<NDKEvent[]>({
    queryKey: ['thread-children', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      return await fetchThreadEvents(rootId)
    },
  })

  // Ensure the seed event (the one whose button opened the thread) is included
  const { data: seed } = useQuery<NDKEvent | null>({
    queryKey: ['thread-seed', _seedId],
    enabled: !!_seedId && _seedId !== rootId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [_seedId!] } as any), 8000, 'fetch thread seed')
        return Array.from(set)[0] || null
      } catch {
        return null
      }
    },
  })

  const all = useMemo(() => {
    const arr: NDKEvent[] = []
    if (root) arr.push(root)
    if (seed) arr.push(seed)
    for (const c of (children || [])) arr.push(c)
    // Ensure unique by id
    const map = new Map<string, NDKEvent>()
    for (const ev of arr) { if (ev.id) map.set(ev.id, ev) }
    return Array.from(map.values())
  }, [root, seed, children])

  // Build parent-child relationships using tags
  const { tree, order, truncated } = useMemo(() => {
    // Exclude repost events (kind 6) from the thread tree; we'll summarize them separately
    const nonReposts = all.filter(ev => ev.kind !== 6)
    const byId = new Map<string, NDKEvent>()
    for (const ev of nonReposts) if (ev.id) byId.set(ev.id, ev)
    const parentOf = new Map<string, string | null>()
    for (const ev of nonReposts) {
      const eTags = (ev.tags || []).filter(t => t[0] === 'e')
      let parent: string | null = null
      const reply = eTags.find(t => t[3] === 'reply')?.[1] as string | undefined
      const rootTag = eTags.find(t => t[3] === 'root')?.[1] as string | undefined
      if (reply) parent = reply
      else if (rootTag && rootTag !== ev.id) parent = rootTag
      else if (eTags.length > 0) parent = (eTags[eTags.length - 1][1] as string)
      else parent = null
      // Guard against self-parenting which can cause infinite loops/duplication
      if (parent === ev.id) parent = (ev.id === rootId ? null : rootId)
      if (parent && !byId.has(parent)) {
        // If parent is outside current set, attach to root
        parent = rootId
      }
      parentOf.set(ev.id as string, parent)
    }
    const childrenMap = new Map<string, string[]>()
    for (const [id, p] of parentOf) {
      const key = p || 'root'
      if (!childrenMap.has(key)) childrenMap.set(key, [])
      childrenMap.get(key)!.push(id)
    }
    // Sort children by created_at
    for (const [k, arr] of childrenMap) {
      arr.sort((a, b) => ((byId.get(a)?.created_at || 0) - (byId.get(b)?.created_at || 0)))
    }
    // Determine traversal order starting from rootId using an iterative DFS to avoid call stack overflow
    const order: string[] = []
    let truncated = false
    const MAX_VISIT = 1000
    try {
      if (byId.has(rootId)) {
        const stack: string[] = [rootId]
        const visited = new Set<string>()
        while (stack.length > 0) {
          const id = stack.pop() as string
          if (visited.has(id)) continue
          visited.add(id)
          order.push(id)
          if (order.length >= MAX_VISIT) { truncated = true; break }
          const kids = childrenMap.get(id) || []
          // push in reverse so that earlier-created children appear first in order
          for (let i = kids.length - 1; i >= 0; i--) {
            const kid = kids[i]
            if (!visited.has(kid)) stack.push(kid)
          }
        }
      }
    } catch {
      truncated = true
    }
    return { tree: { byId, childrenMap, parentOf }, order, truncated }
  }, [all, rootId])

  // Collect reposters to show as a compact row at the bottom
  const reposters = useMemo(() => {
    const set = new Set<string>()
    for (const ev of all) {
      if ((ev as any).kind === 6 && ev.pubkey) set.add(ev.pubkey)
    }
    return Array.from(set)
  }, [all])

  const onBackdrop = (e: any) => { e.stopPropagation(); onClose() }

  return (
    <div className="fixed inset-0 z-[1200] bg-black/70" onClick={onBackdrop} role="dialog" aria-modal="true">
      <button type="button" onClick={(e) => { e.stopPropagation(); onClose() }} className="fixed top-3 right-3 z-[1300] w-10 h-10 rounded-full bg-black/70 text-white hover:bg-black/90" aria-label="Close thread view">×</button>
      <div className="absolute inset-y-2 left-[10%] right-[10%] bg-[#0f1a1d] rounded-lg shadow-xl overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4">
          {!root ? (
            <div className="text-sm text-[#cccccc]">Loading thread…</div>
          ) : (
            <div className="space-y-4">
              {order.map((id) => {
                const ev = tree.byId.get(id) as NDKEvent
                if (!ev) return null
                // Compute depth by walking up parents using the built parentOf map
                let depth = 0
                {
                  let cur = id as string
                  let safety = 0
                  while (true) {
                    const p = tree.parentOf.get(cur) || null
                    if (!p || p === rootId) break
                    depth++
                    cur = p
                    if (++safety > 64) break
                  }
                }
                return (
                  <div key={id} className="border border-black rounded bg-[#10181b]" style={{ marginLeft: Math.min(24, depth) * 16 }}>
                    <div className="p-3">
                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0">
                          <header className="mb-2 flex items-center gap-2 text-xs text-[#cccccc]">
                            <AuthorLabel pubkey={ev.pubkey || ''} onOpen={(pk) => openProfileByPubkey(pk)} />
                            <span className="opacity-50">·</span>
                            <time className="opacity-70">{formatTime(ev.created_at)}</time>
                          </header>
                          {ev.kind === 6 ? (
                            <RepostNote 
                              ev={ev} 
                              openMedia={openMedia} 
                              openProfile={openProfileByBech} 
                              openProfileByPubkey={openProfileByPubkey}
                              openHashtag={openHashtag}
                              onReply={onReply}
                              onRepost={onRepost}
                              onQuote={onQuote}
                              onOpenNote={onOpenNote}
                              scopeId={scopeId}
                              actionMessages={undefined}
                              replyOpen={replyOpen}
                              replyBuffers={replyBuffers}
                              onChangeReplyText={onChangeReplyTextById}
                              onCloseReply={onCloseReplyById}
                              onSendReply={onSendReply}
                              userFollows={undefined}
                              repostMode={repostMode}
                              onCancelRepost={onCancelRepost}
                            />
                          ) : (
                            <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                              {renderContent(ev.content, openMedia, openProfileByBech, openHashtag, extractHashtagTags(ev.tags), false, (id: string) => onOpenNote?.({id} as NDKEvent), onReply, onRepost, onQuote, undefined, scopeId, undefined, replyOpen, replyBuffers, onChangeReplyTextById, onCloseReplyById, (id: string) => onSendReply?.(id), undefined)}
                            </div>
                          )}
                          {(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) && (
                            <ReplyComposer
                              value={(replyBuffers?.[`${scopeId}|${ev.id}`] || '')}
                              onChange={(v) => onChangeReplyTextById?.(`${scopeId}|${ev.id!}`, v)}
                              onClose={() => onCloseReplyById?.(`${scopeId}|${ev.id!}`)}
                              onSend={() => onSendReply?.(ev.id!)}
                              replyKey={`${scopeId}|${ev.id}`}
                            />
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0 self-start">
                          <button type="button" onClick={() => onQuote(ev)} className={`${(ev.id && quoteOpen?.[`quote|${ev.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Quote">
                            <QuoteIcon className="w-8 h-8" />
                          </button>
                          {repostMode?.[ev.id || ''] ? (
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => onRepost(ev)} className="bg-[#fff3b0] text-black text-xs px-2 py-1 rounded-full hover:bg-[#ffed80] flex items-center gap-2" title="Repost (active)">
                                <RepostEllipsisBubbleIcon className="w-8 h-8" />
                              </button>
                              <button type="button" onClick={() => onCancelRepost?.(ev)} className="bg-red-600 text-white text-xs px-2 py-1 rounded-full hover:bg-red-700 flex items-center gap-2" title="Cancel repost">
                                ×
                              </button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => onRepost(ev)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Repost">
                              <RepostEllipsisBubbleIcon className="w-8 h-8" />
                            </button>
                          )}
                          <button type="button" onClick={() => onReply(ev)} className={`${(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Reply">
                            <ReplyBubbleIcon className="w-8 h-8" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {truncated && (
                <div className="text-xs text-[#cccccc] opacity-70">Thread truncated due to size. Some replies may be hidden.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* NoteCard moved to note.tsx */
function NoteCard_Legacy({ ev, scopeId, onReply, onRepost, onQuote, onOpenThread, onOpenNote, openMedia, openProfileByBech, openProfileByPubkey, activeThreadRootId, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, openHashtag, userFollows, hideThread, userPubkey, showActionMessage, repostMode, onCancelRepost, quoteOpen, quoteBuffers, onChangeQuoteText, onCloseQuote, onSendQuote }: { ev: NDKEvent; scopeId: string; onReply: (e: NDKEvent) => void; onRepost: (e: NDKEvent) => void; onQuote: (e: NDKEvent) => void; onOpenThread: (e: NDKEvent) => void; onOpenNote: (e: NDKEvent) => void; openMedia: (g: MediaGallery) => void; openProfileByBech: (bech: string) => void; openProfileByPubkey: (pubkey: string) => void; activeThreadRootId?: string | null; actionMessages?: Record<string, string | undefined>; replyOpen?: Record<string, boolean>; replyBuffers?: Record<string, string>; onChangeReplyText?: (id: string, v: string) => void; onCloseReply?: (id: string) => void; onSendReply?: (targetId: string) => void; openHashtag?: (tag: string) => void; userFollows?: string[]; hideThread?: boolean; userPubkey?: string; showActionMessage?: (e: NDKEvent, msg: string) => void; repostMode?: Record<string, boolean>; onCancelRepost?: (e: NDKEvent) => void; quoteOpen?: Record<string, boolean>; quoteBuffers?: Record<string, string>; onChangeQuoteText?: (id: string, v: string) => void; onCloseQuote?: (id: string) => void; onSendQuote?: (targetId: string) => void }) {
  
  // Handle reaction creation
  const handleReaction = async (targetEvent: NDKEvent, emoji: string) => {
    if (!targetEvent.id || !userPubkey) return
    try {
      const reactionEvent = new NDKEvent(ndk)
      reactionEvent.kind = 7 // reaction event
      reactionEvent.content = emoji
      reactionEvent.tags = [
        ['e', targetEvent.id],
        ['p', targetEvent.pubkey]
      ]
      await reactionEvent.publish()
      // Show success message
      showActionMessage?.(targetEvent, `Reacted with ${emoji}`)
    } catch (error) {
      console.error('Failed to publish reaction:', error)
      showActionMessage?.(targetEvent, 'Failed to react')
    }
  }
  const getThreadRootIdLocal = (ev: NDKEvent): string => {
    const eTags = (ev.tags || []).filter(t => t[0] === 'e')
    const root = eTags.find(t => (t[3] === 'root'))?.[1] as string | undefined
    const reply = eTags.find(t => (t[3] === 'reply'))?.[1] as string | undefined
    const any = eTags[0]?.[1] as string | undefined
    return (root || reply || any || ev.id || '')
  }
  const thisRootId = getThreadRootIdLocal(ev)
  const isActiveThread = !!activeThreadRootId && activeThreadRootId === thisRootId
  
  // Check if this event mentions the logged-in user
  const mentionsUser = userPubkey && (ev.tags || []).some(t => t[0] === 'p' && t[1] === userPubkey)

  const [expanded, setExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [jsonViewerOpen, setJsonViewerOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLElement | null>(null)
  const buttonRowRef = useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  // Observe when the card enters the viewport to trigger thread search lazily
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry && entry.isIntersecting) {
        setIsVisible(true)
        try { io.disconnect() } catch {}
      }
    }, { root: null, rootMargin: '0px', threshold: 0.2 })
    io.observe(el)
    return () => {
      try { io.disconnect() } catch {}
    }
  }, [])

  // Probe for thread data once visible; we only show the thread button after this probe completes
  const threadProbe = useQuery<number>({
    queryKey: ['thread-probe', thisRootId],
    enabled: isVisible && !!thisRootId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        // Check for direct replies to verify thread availability
        const res = await fetchThreadEvents(thisRootId)
        return (res || []).length
      } catch {
        return 0
      }
    },
  })
  const showThreadButton = threadProbe.isSuccess

  // Scroll button row to bottom of viewport
  const scrollButtonRowToBottom = () => {
    if (buttonRowRef.current) {
      const rect = buttonRowRef.current.getBoundingClientRect()
      const scrollAmount = rect.bottom - window.innerHeight
      if (scrollAmount > 0) {
        window.scrollBy({
          top: scrollAmount,
          behavior: 'smooth'
        })
      }
    }
  }

  // Function to scroll QuoteComposer to center of viewport and focus textarea
  const scrollQuoteComposerToCenter = (ev: NDKEvent) => {
    // Wait for the QuoteComposer to be rendered after state update
    setTimeout(() => {
      const quoteKey = `quote|${ev.id}`
      const quoteComposer = document.querySelector(`[data-quote-key="${quoteKey}"]`)
      if (quoteComposer) {
        const rect = quoteComposer.getBoundingClientRect()
        const viewportCenter = window.innerHeight / 2
        const elementCenter = rect.top + rect.height / 2
        const scrollAmount = elementCenter - viewportCenter
        
        window.scrollBy({
          top: scrollAmount,
          behavior: 'smooth'
        })
        
        // Focus the textarea within the quote composer
        const textarea = quoteComposer.querySelector('textarea')
        if (textarea) {
          textarea.focus()
          // Move cursor to the beginning of the text input
          textarea.setSelectionRange(0, 0)
        }
      }
    }, 100) // Small delay to ensure the component is rendered
  }

  // Enhanced quote handler
  const handleQuote = (ev: NDKEvent) => {
    onQuote(ev)
    scrollQuoteComposerToCenter(ev)
  }

  // Function to scroll ReplyComposer to center of viewport
  const scrollReplyComposerToCenter = (ev: NDKEvent) => {
    // Wait for the ReplyComposer to be rendered after state update
    setTimeout(() => {
      const replyKey = `${scopeId}|${ev.id}`
      const replyComposer = document.querySelector(`[data-reply-key="${replyKey}"]`)
      if (replyComposer) {
        const rect = replyComposer.getBoundingClientRect()
        const viewportCenter = window.innerHeight / 2
        const elementCenter = rect.top + rect.height / 2
        const scrollAmount = elementCenter - viewportCenter
        
        window.scrollBy({
          top: scrollAmount,
          behavior: 'smooth'
        })
      }
    }, 100) // Small delay to ensure the component is rendered
  }

  // Enhanced reply handler
  const handleReply = (ev: NDKEvent) => {
    onReply(ev)
    scrollReplyComposerToCenter(ev)
  }

  useEffect(() => {
    const calc = () => {
      const inner = innerRef.current
      if (!inner) { setIsOverflowing(false); return }
      const maxPx = Math.max(0, Math.floor(window.innerHeight * 0.5))
      // Measure natural content height
      const natural = inner.scrollHeight
      setIsOverflowing(natural > maxPx + 4)
    }
    calc()
    const ro = new ResizeObserver(() => calc())
    if (innerRef.current) ro.observe(innerRef.current)
    window.addEventListener('resize', calc)
    return () => {
      try { ro.disconnect() } catch {}
      window.removeEventListener('resize', calc)
    }
  }, [])

  return (
    <article className="p-3 relative" ref={cardRef}>
      <div className="flex flex-col">
        <div className="flex gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <header className="mb-1 flex items-center gap-2 text-sm text-[#cccccc]">
              <AuthorLabel pubkey={ev.pubkey || ''} onOpen={(pk) => openProfileByPubkey(pk)} />
              <span className="opacity-50">·</span>
              <time className="opacity-70 hover:underline cursor-pointer" onClick={() => onOpenNote(ev)} title="Open note tab">{formatTime(ev.created_at)}</time>
              {mentionsUser && (
                <>
                  <span className="opacity-50">·</span>
                  <span className="text-[#9ecfff] text-xs px-1.5 py-0.5 bg-[#1b3a40] rounded-full">{ev.kind === 6 ? 'reposted' : 'reply'}</span>
                </>
              )}
              <button
                type="button"
                onClick={() => setJsonViewerOpen(!jsonViewerOpen)}
                className="opacity-70 hover:opacity-100 text-xs px-1 py-0.5 rounded hover:bg-black/20 transition-all"
                title="Toggle JSON viewer"
              >
                &lt;/&gt;
              </button>
            </header>

            {/* JSON Viewer */}
            {jsonViewerOpen && (
              <div className="mb-3 bg-black/40 border border-[#37474f] rounded-lg overflow-hidden">
                <div className="bg-[#1a2529] px-3 py-2 border-b border-[#37474f] text-xs text-[#cccccc] font-medium">
                  Event JSON
                </div>
                <div className="max-h-96 overflow-auto">
                  <pre className="p-3 text-xs text-[#cccccc] whitespace-pre-wrap break-all font-mono leading-relaxed">
                    {JSON.stringify({
                      id: ev.id,
                      pubkey: ev.pubkey,
                      created_at: ev.created_at,
                      kind: ev.kind,
                      tags: ev.tags,
                      content: ev.content,
                      sig: ev.sig
                    }, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Collapsible content wrapper capped at 50vh when not expanded */}
            <div
              ref={wrapperRef}
              className="relative"
              style={{ maxHeight: expanded ? 'none' as any : '50vh', overflow: expanded ? 'visible' : 'hidden' }}
            >
              <div ref={innerRef} className="whitespace-pre-wrap break-words text-[#cccccc]">
                {ev.kind === 6 ? (
                  <RepostNote 
                    ev={ev} 
                    openMedia={openMedia} 
                    openProfile={openProfileByBech} 
                    openProfileByPubkey={openProfileByPubkey} 
                    openHashtag={openHashtag}
                    onReply={onReply}
                    onRepost={onRepost}
                    onQuote={onQuote}
                    onOpenThread={onOpenThread}
                    onOpenNote={onOpenNote}
                    scopeId={scopeId}
                    actionMessages={actionMessages}
                    replyOpen={replyOpen}
                    replyBuffers={replyBuffers}
                    onChangeReplyText={onChangeReplyText}
                    onCloseReply={onCloseReply}
                    onSendReply={onSendReply}
                    userFollows={userFollows}
                    repostMode={repostMode}
                    onCancelRepost={onCancelRepost}
                  />
                ) : (
                  <div className="contents">{renderContent(ev.content, openMedia, openProfileByBech, openHashtag, extractHashtagTags((ev as any)?.tags), userFollows ? userFollows.includes(ev.pubkey || '') : false, (id: string) => onOpenNote({id} as NDKEvent), onReply, onRepost, onQuote, onOpenThread, scopeId, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, userFollows)}</div>
                )}
              </div>
              {!expanded && isOverflowing && (
                <div className="absolute left-0 right-0 bottom-0 h-16 bg-gradient-to-t from-[#162a2f] to-transparent pointer-events-none" aria-hidden="true" />
              )}
            </div>

            {/* Hashtag list for 't' tag hashtags - always visible at the bottom */}
            {ev.kind !== 6 && extractHashtagTags((ev as any)?.tags).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {extractHashtagTags((ev as any)?.tags).map((tag, idx) => (
                  <button
                    key={`hashtag-${idx}-${tag}`}
                    type="button"
                    onClick={() => openHashtag?.(`#${tag}`)}
                    className="text-[#9ecfff] hover:text-white text-sm"
                    title={`Open #${tag}`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}

            {/* Revealer button */}
            {!expanded && isOverflowing && (
              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="px-3 py-1 rounded-full bg-black/60 text-white hover:bg-black/80 text-sm"
                  title="Show more"
                  aria-label="Show more"
                >
                  Show more
                </button>
              </div>
            )}

            {/* Action message box at bottom of note content */}
            {actionMessages?.[ev.id || ''] && (
              <div className="mt-3 bg-black/60 text-white border border-black rounded p-2 text-sm" role="status" aria-live="polite">
                {actionMessages[ev.id || '']}
              </div>
            )}

            {/* Reaction buttons row at bottom left */}
            <ReactionButtonRow 
              eventId={ev.id || ''} 
              onReact={(emoji: string) => handleReaction(ev, emoji)}
            />

            {(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) && (
              <ReplyComposer
                value={(replyBuffers?.[`${scopeId}|${ev.id}`] || '')}
                onChange={(v) => onChangeReplyText?.(`${scopeId}|${ev.id!}`, v)}
                onClose={() => onCloseReply?.(`${scopeId}|${ev.id!}`)}
                onSend={() => onSendReply?.(`${scopeId}|${ev.id!}`)}
                replyKey={`${scopeId}|${ev.id}`}
              />
            )}

            {(ev.id && quoteOpen?.[`quote|${ev.id}`]) && (
              <QuoteComposer
                value={(quoteBuffers?.[`quote|${ev.id}`] || '')}
                onChange={(v) => onChangeQuoteText?.(`quote|${ev.id!}`, v)}
                onClose={() => onCloseQuote?.(`quote|${ev.id!}`)}
                onSend={() => onSendQuote?.(`quote|${ev.id!}`)}
                quoteKey={`quote|${ev.id}`}
              />
            )}
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0 self-start">
            {showThreadButton ? (
              <button type="button" onClick={() => onOpenThread(ev)} className={`${isActiveThread ? 'bg-[#fff3b0] text-black' : 'bg-black/60 text-white hover:bg-black/80'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Open thread">
                <ThreadReelIcon className="w-8 h-8" />
              </button>
            ) : null}
          </div>
        </div>
        
        {/* Bottom button row right-justified - Quote, Repost, Reply order (icon only) */}
        <div ref={buttonRowRef} className="flex justify-end items-center w-full gap-2">
          <button type="button" onClick={() => handleQuote(ev)} className={`${(ev.id && quoteOpen?.[`quote|${ev.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center justify-center`} title="Quote">
            <QuoteIcon className="w-8 h-8" />
          </button>
          
          {repostMode?.[ev.id || ''] ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onRepost(ev)} className="bg-[#fff3b0] text-black text-xs px-2 py-1 rounded-full hover:bg-[#ffed80] flex items-center justify-center" title="Repost (active)">
                <RepostEllipsisBubbleIcon className="w-8 h-8" />
              </button>
              <button type="button" onClick={() => onCancelRepost?.(ev)} className="bg-red-600 text-white text-xs px-2 py-1 rounded-full hover:bg-red-700 flex items-center justify-center" title="Cancel repost">
                ×
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => onRepost(ev)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center justify-center" title="Repost">
              <RepostEllipsisBubbleIcon className="w-8 h-8" />
            </button>
          )}
          
          <button type="button" onClick={() => handleReply(ev)} className={`${(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center justify-center`} title="Reply">
            <ReplyBubbleIcon className="w-8 h-8" />
          </button>
        </div>
      </div>
    </article>
  )
}

export function ReactionButtonRow({ eventId, onReact, excludeEl }: { eventId: string; onReact: (emoji: string) => void; excludeEl?: HTMLElement | null }) {
  const [isEmojiModalOpen, setIsEmojiModalOpen] = useState(false)
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 })
  const reactButtonRef = useRef<HTMLButtonElement>(null)

  // Query for existing reactions to this event
  const { data: reactions } = useQuery<NDKEvent[]>({
    queryKey: ['reactions', eventId],
    enabled: !!eventId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      if (!eventId) return []
      try {
        const filter: NDKFilter = { kinds: [7], '#e': [eventId], limit: 100 }
        const set = await withTimeout(ndk.fetchEvents(filter as any), 6000, 'fetch reactions')
        return Array.from(set)
      } catch {
        return []
      }
    },
  })

  // Group reactions by emoji and count them
  const reactionCounts = useMemo(() => {
    if (!reactions) return {}
    const counts: Record<string, { count: number; users: string[] }> = {}
    for (const reaction of reactions) {
      const emoji = reaction.content || '❤️'
      if (!counts[emoji]) counts[emoji] = { count: 0, users: [] }
      counts[emoji].count++
      if (reaction.pubkey) counts[emoji].users.push(reaction.pubkey)
    }
    return counts
  }, [reactions])

  const handleReactClick = async () => {
    // Toggle behavior: if already open, close it
    if (isEmojiModalOpen) {
      setIsEmojiModalOpen(false)
      return
    }
    const MODAL_WIDTH = 320
    const MODAL_HEIGHT = 400
    const MARGIN = 8 // ~0.5em
    if (reactButtonRef.current) {
      const rect = reactButtonRef.current.getBoundingClientRect()
      // Position the modal directly below the React button
      const top = rect.bottom + MARGIN
      const maxLeft = Math.max(0, window.innerWidth - MODAL_WIDTH - MARGIN)
      const left = Math.min(Math.max(MARGIN, rect.left), maxLeft)
      setModalPosition({ x: left, y: top })
      setIsEmojiModalOpen(true)
      return
    }
    // Fallback: open near bottom-left with margin
    setModalPosition({ x: MARGIN, y: window.innerHeight - MARGIN - MODAL_HEIGHT })
    setIsEmojiModalOpen(true)
  }

  const handleEmojiSelect = (emoji: string) => {
    onReact(emoji)
    setIsEmojiModalOpen(false)
  }

  if (!eventId) return null

  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      {/* React button (opens emoji selector) */}
      <button
        ref={reactButtonRef}
        type="button"
        onClick={handleReactClick}
        className={`${isEmojiModalOpen ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] hover:bg-[#215059] text-white'} text-sm px-3 py-1 rounded-full`}
        title="React with emoji"
      >
        React
      </button>
      
      {/* Display existing reactions to the right of the React button */}
      {Object.entries(reactionCounts).map(([emoji, data]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => handleEmojiSelect(emoji)}
          className="bg-[#1b3a40] hover:bg-[#215059] text-white text-sm px-2 py-1 rounded-full flex items-center gap-1"
          title={`${data.count} reaction${data.count !== 1 ? 's' : ''}`}
        >
          <span>{emoji}</span>
          <span className="text-xs">{data.count}</span>
        </button>
      ))}

      {/* Emoji selector modal */}
      {isEmojiModalOpen && (
        <EmojiSelectorModal
          position={modalPosition}
          onSelect={handleEmojiSelect}
          onClose={() => setIsEmojiModalOpen(false)}
          excludeEl={excludeEl}
          anchorEl={reactButtonRef.current}
        />
      )}
    </div>
  )
}

function EmojiSelectorModal({ position, onSelect, onClose, excludeEl, anchorEl }: { 
  position: { x: number; y: number }; 
  onSelect: (emoji: string) => void; 
  onClose: () => void;
  excludeEl?: HTMLElement | null;
  anchorEl?: HTMLElement | null;
}) {
  const modalRef = useRef<HTMLDivElement>(null)

  // Keep page scrollable: remove body scroll locking
  useEffect(() => {
    // no-op to keep scrolling enabled
  }, [])

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // Close when clicking in the scrim area (outside modal, outside react button, and outside the excluded note element)
  useEffect(() => {
    const handleDocClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (modalRef.current && modalRef.current.contains(target)) return
      if (anchorEl && anchorEl.contains(target as Node)) return
      if (excludeEl && excludeEl.contains(target as Node)) return
      onClose()
    }
    // Use capture phase to intercept before underlying handlers
    document.addEventListener('click', handleDocClick, true)
    return () => {
      document.removeEventListener('click', handleDocClick, true)
    }
  }, [onClose, anchorEl, excludeEl])

  // Track anchor element position so modal stays under the button while scrolling/resizing
  const [pos, setPos] = useState(position)
  useEffect(() => {
    const update = () => {
      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect()
        const MARGIN = 8
        const MODAL_WIDTH = 320
        const maxLeft = Math.max(0, window.innerWidth - MODAL_WIDTH - MARGIN)
        const left = Math.min(Math.max(MARGIN, rect.left), maxLeft)
        const top = rect.bottom + MARGIN
        setPos({ x: left, y: top })
      } else {
        setPos(position)
      }
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [anchorEl, position])

  // Compute exclusion rectangle (note card) if provided
  const hole = excludeEl ? excludeEl.getBoundingClientRect() : null
  const holeTop = hole ? Math.max(0, hole.top) : 0
  const holeBottom = hole ? Math.max(holeTop, hole.bottom) : 0
  const holeLeft = hole ? Math.max(0, hole.left) : 0
  const holeRight = hole ? Math.max(holeLeft, hole.right) : 0
  const holeHeight = hole ? Math.max(0, holeBottom - holeTop) : 0
  const holeWidth = hole ? Math.max(0, holeRight - holeLeft) : 0

  return (
    <>
      {/* Scrim segments that exclude the note area if provided; keep them non-blocking for scroll */}
      {hole ? (
        <>
          {/* Top segment */}
          <div
            className="fixed left-0 right-0 top-0 bg-black/50 z-[1000] pointer-events-none"
            style={{ height: `${holeTop}px` }}
            aria-hidden="true"
          />
          {/* Bottom segment */}
          <div
            className="fixed left-0 right-0 bottom-0 bg-black/50 z-[1000] pointer-events-none"
            style={{ top: `${holeBottom}px` }}
            aria-hidden="true"
          />
          {/* Left segment */}
          <div
            className="fixed left-0 bg-black/50 z-[1000] pointer-events-none"
            style={{ top: `${holeTop}px`, height: `${holeHeight}px`, width: `${holeLeft}px` }}
            aria-hidden="true"
          />
          {/* Right segment */}
          <div
            className="fixed right-0 bg-black/50 z-[1000] pointer-events-none"
            style={{ top: `${holeTop}px`, height: `${holeHeight}px`, width: `${Math.max(0, window.innerWidth - holeRight)}px` }}
            aria-hidden="true"
          />
        </>
      ) : (
        // Fallback: full-screen scrim if no hole element provided
        <div
          className="fixed inset-0 bg-black/50 z-[1000] pointer-events-none"
          aria-hidden="true"
        />
      )}

      {/* Emoji selector modal */}
      <div 
        ref={modalRef}
        className="fixed z-[1001] bg-[#0f1a1d] border border-[#37474f] rounded-lg shadow-xl"
        style={{ 
          left: `${pos.x}px`, 
          top: `${pos.y}px`
        }}
      >
        <EmojiPicker
          onEmojiClick={(emojiData: EmojiClickData) => onSelect(emojiData.emoji)}
          theme={Theme.DARK}
          width={320}
          height={400}
          searchDisabled={false}
          skinTonesDisabled={false}
          previewConfig={{
            showPreview: false
          }}
        />
      </div>
    </>
  )
}

function MediaModal({ gallery, onClose }: { gallery: MediaGallery; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [index, setIndex] = useState(gallery.index)
  const items = gallery.items

  const goPrev = () => setIndex((i) => (i - 1 + items.length) % items.length)
  const goNext = () => setIndex((i) => (i + 1) % items.length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+') setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))
      if (e.key === '-') setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))
      if (e.key.toLowerCase() === 'r') setZoom(1)
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, items.length])

  // Reset zoom when image/video changes
  useEffect(() => { setZoom(1) }, [index])

  const current = items[index] || items[0]

  return (
    <div className="fixed inset-0 z-[2000] bg-black/80 flex flex-col" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex justify-end gap-2 p-2" onClick={(e) => e.stopPropagation()}>
        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2))) }} className="bg-[#162a2f] text-white px-3 py-1 rounded hover:bg-[#1b3a40]" aria-label="Zoom out">-</button>
        <button onClick={(e) => { e.stopPropagation(); setZoom(1) }} className="bg-[#162a2f] text-white px-3 py-1 rounded hover:bg-[#1b3a40]" aria-label="Reset zoom">Reset</button>
        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(4, +(z + 0.25).toFixed(2))) }} className="bg-[#162a2f] text-white px-3 py-1 rounded hover:bg-[#1b3a40]" aria-label="Zoom in">+</button>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} className="bg-[#162a2f] text-white px-3 py-1 rounded hover:bg-[#1b3a40]" aria-label="Close">Close</button>
      </div>
      <div className="relative flex-1 flex items-center justify-center p-4">
        {/* Left/Right arrows */}
        {items.length > 1 && (
          <>
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/60 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/80"
              onClick={(e) => { e.stopPropagation(); goPrev() }}
              aria-label="Previous"
            >
              <span className="text-xl select-none">‹</span>
            </button>
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/60 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/80"
              onClick={(e) => { e.stopPropagation(); goNext() }}
              aria-label="Next"
            >
              <span className="text-xl select-none">›</span>
            </button>
          </>
        )}
        <div className="max-w-[95vw] max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
          {current.type === 'image' ? (
            <img src={current.url} alt="media" style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }} className="max-w-full max-h-[85vh] object-contain select-none" />
          ) : (
            <video src={current.url} controls autoPlay className="max-w-full max-h-[85vh]" style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }} />
          )}
        </div>
      </div>
    </div>
  )
}

export function RepostNote({ ev, openMedia, openProfile, openProfileByPubkey, openHashtag, onReply, onRepost, onQuote, onOpenThread, onOpenNote, scopeId, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, userFollows, repostMode, onCancelRepost }: { 
  ev: NDKEvent, 
  openMedia: (g: MediaGallery) => void, 
  openProfile: (bech: string) => void, 
  openProfileByPubkey: (pubkey: string) => void, 
  openHashtag?: (tag: string) => void,
  onReply?: (e: NDKEvent) => void,
  onRepost?: (e: NDKEvent) => void,
  onQuote?: (e: NDKEvent) => void,
  onOpenThread?: (e: NDKEvent) => void,
  onOpenNote?: (e: NDKEvent) => void,
  scopeId?: string,
  actionMessages?: Record<string, string | undefined>,
  replyOpen?: Record<string, boolean>,
  replyBuffers?: Record<string, string>,
  onChangeReplyText?: (id: string, v: string) => void,
  onCloseReply?: (id: string) => void,
  onSendReply?: (targetId: string) => void,
  userFollows?: string[],
  repostMode?: Record<string, boolean>,
  onCancelRepost?: (e: NDKEvent) => void
}) {
  // Attempt to parse embedded original event JSON (classic kind 6 style)
  let embedded: any = null
  try {
    if (ev.content) {
      const parsed = JSON.parse(ev.content)
      if (parsed && typeof parsed === 'object' && parsed.id && parsed.pubkey) {
        embedded = parsed
      }
    }
  } catch {}

  // Fallback: use first 'e' tag as the target id
  const targetId = useMemo(() => {
    if (embedded?.id) return embedded.id as string
    const eTag = (ev.tags || []).find(t => t[0] === 'e' && t[1])
    return eTag ? (eTag[1] as string) : ''
  }, [ev, embedded?.id])

  const { data: original } = useQuery<{ id: string; pubkey: string; created_at?: number } | null>({
    queryKey: ['repost-target', targetId],
    enabled: !!targetId && !embedded,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [targetId] } as any), 6000, 'fetch repost target')
        const first = Array.from(set)[0] as any
        if (!first) return null
        // Return a minimal serializable snapshot
        return {
          id: first.id,
          pubkey: first.pubkey,
          created_at: first.created_at,
          kind: (first as any).kind,
          content: first.content,
          tags: first.tags,
        } as any
      } catch {
        return null
      }
    },
  })

  const target = embedded || original
  
  // Create a fake NDKEvent from the target for action buttons
  const targetEvent: NDKEvent = target ? {
    id: target.id,
    pubkey: target.pubkey,
    created_at: target.created_at,
    kind: target.kind,
    content: target.content,
    tags: target.tags || []
  } as NDKEvent : ev

  return (
    <div className="mt-2">
      <div className="rounded-lg bg-[#1a2529] p-3">
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs text-[#cccccc]">
              {target?.pubkey ? <AuthorLabel pubkey={String(target.pubkey)} onOpen={(pk) => openProfileByPubkey(pk)} /> : <span className="opacity-70">Unknown author</span>}
              <span className="opacity-50">·</span>
              <time className="opacity-70 hover:underline cursor-pointer" onClick={() => onOpenNote?.(targetEvent)} title="Open note tab">{formatTime((target as any)?.created_at)}</time>
            </div>
            {!target ? (
              <div className="text-xs text-[#cccccc]">Loading…</div>
            ) : (
              <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                {renderContent((target as any)?.content || '', openMedia, openProfile, openHashtag, extractHashtagTags((target as any)?.tags), userFollows?.includes(target.pubkey), onOpenNote ? (id: string) => onOpenNote(targetEvent) : undefined, onReply, onRepost, onQuote, onOpenThread, scopeId, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, userFollows)}
                
                {/* Hashtag list for 't' tag hashtags */}
                {extractHashtagTags((target as any)?.tags).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {extractHashtagTags((target as any)?.tags).map((tag, idx) => (
                      <button
                        key={`hashtag-${idx}-${tag}`}
                        type="button"
                        onClick={() => openHashtag?.(`#${tag}`)}
                        className="text-[#9ecfff] hover:text-white text-sm"
                        title={`Open #${tag}`}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {actionMessages?.[targetEvent.id || ''] && (
              <div className="mt-3 bg-black/60 text-white border border-black rounded p-2 text-sm" role="status" aria-live="polite">
                {actionMessages[targetEvent.id || '']}
              </div>
            )}
            {(targetEvent.id && scopeId && replyOpen?.[`${scopeId}|${targetEvent.id}`]) && (
              <ReplyComposer
                value={(replyBuffers?.[`${scopeId}|${targetEvent.id}`] || '')}
                onChange={(v) => onChangeReplyText?.(`${scopeId}|${targetEvent.id!}`, v)}
                onClose={() => onCloseReply?.(`${scopeId}|${targetEvent.id!}`)}
                onSend={() => onSendReply?.(`${scopeId}|${targetEvent.id!}`)}
                replyKey={`${scopeId}|${targetEvent.id}`}
              />
            )}
          </div>
          {onReply && onRepost && onQuote && (
            <div className="flex flex-col items-end gap-2 flex-shrink-0 self-start">
              {onOpenThread && (
                <button type="button" onClick={() => onOpenThread(targetEvent)} className="bg-black/60 text-white hover:bg-black/80 text-xs px-2 py-1 rounded-full flex items-center gap-2" title="Open thread">
                  <ThreadReelIcon className="w-8 h-8" />
                </button>
              )}
              <button type="button" onClick={() => onQuote(targetEvent)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Quote">
                <QuoteIcon className="w-8 h-8" />
              </button>
              {repostMode?.[targetEvent.id || ''] ? (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => onRepost(targetEvent)} className="bg-[#fff3b0] text-black text-xs px-2 py-1 rounded-full hover:bg-[#ffed80] flex items-center gap-2" title="Repost (active)">
                    <RepostEllipsisBubbleIcon className="w-8 h-8" />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); onCancelRepost?.(targetEvent) }} className="bg-red-600 text-white text-xs px-2 py-1 rounded-full hover:bg-red-700 flex items-center gap-2" title="Cancel repost">
                    ×
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => onRepost(targetEvent)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Repost">
                  <RepostEllipsisBubbleIcon className="w-8 h-8" />
                </button>
              )}
              <button type="button" onClick={() => onReply(targetEvent)} className={`${(targetEvent.id && scopeId && replyOpen?.[`${scopeId}|${targetEvent.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Reply">
                <ReplyBubbleIcon className="w-8 h-8" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InlineProfile({ bech, onOpen }: { bech: string; onOpen: (bech: string) => void }) {
  const { data } = useQuery<{ pubkey: string; name: string; picture?: string }>({
    queryKey: ['inline-profile', bech],
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      try {
        let u: any
        if (/^npub1[0-9a-z]+$/i.test(bech)) u = ndk.getUser({ npub: bech } as any)
        else if (/^nprofile1[0-9a-z]+$/i.test(bech)) u = ndk.getUser({ nprofile: bech } as any)
        else return { pubkey: '', name: bech }
        try { await withTimeout(u.fetchProfile?.(), 4000, 'inline profile fetch') } catch {}
        const prof: any = u.profile || {}
        const name: string = prof.displayName || prof.display_name || prof.name || prof.nip05 || ''
        const picture: string | undefined = prof.picture || undefined
        const pubkey: string = u.pubkey || ''
        return { pubkey, name, picture }
      } catch {
        return { pubkey: '', name: bech }
      }
    },
  })
  const label = data?.name || (bech.startsWith('npub1') ? bech.slice(0, 12) + '…' : 'Profile')
  const pic = data?.picture
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); onOpen(bech) }}
      className="inline-flex items-center gap-1 align-middle rounded-full bg-black/30 px-2 py-0.5 hover:bg-black/50 text-[#9ecfff] focus:outline-none"
      title={bech}
    >
      {pic ? <img src={pic} alt="avatar" className="w-6 h-6 rounded-full object-cover" /> : <UserIcon className="w-6 h-6" />}
      <span className="text-[0.665em]">{label}</span>
    </button>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4  rounded-full animate-spin"
      aria-hidden="true"
    />
  )
}

export function AuthorLabel({ pubkey, onOpen }: { pubkey: string, onOpen?: (pubkey: string) => void }) {
  const { data } = useQuery({
    queryKey: ['profile', pubkey],
    enabled: !!pubkey,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      try {
        const user = ndk.getUser({ pubkey })
        try {
          await withTimeout(user.fetchProfile(), 5000, 'profile fetch')
        } catch {}
        const prof: any = user.profile || {}
        const name: string = prof.displayName || prof.display_name || prof.name || prof.nip05 || ''
        const picture: string | undefined = prof.picture || undefined
        return { name, picture }
      } catch {
        return { name: '', picture: undefined as string | undefined }
      }
    },
  })
  const name = (data?.name && String(data.name)) || shorten(pubkey)
  const pic = data?.picture
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen(pubkey)}
        className="rounded-lg bg-gray-500/20 p-[0.5em] flex items-center gap-2 hover:underline cursor-pointer focus:outline-none"
        title={name}
      >
        {pic ? (
          <img src={pic} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
        ) : null}
        <span className="opacity-90 text-[1.33em]">{name}</span>
      </button>
    )
  }
  return (
    <div className="rounded-lg bg-gray-500/20 p-[0.5em] flex items-center gap-2">
      {pic ? (
        <img src={pic} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
      ) : null}
      <span className="opacity-90 text-[1.33em]">{name}</span>
    </div>
  )
}

// Small avatar bubble for displaying reposters
function ReposterAvatar({ pubkey, onOpen }: { pubkey: string; onOpen?: (pubkey: string) => void }) {
  const { data } = useQuery({
    queryKey: ['profile-picture', pubkey],
    enabled: !!pubkey,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      try {
        const user = ndk.getUser({ pubkey })
        try { await withTimeout(user.fetchProfile(), 4000, 'profile pic fetch') } catch {}
        const prof: any = user.profile || {}
        const picture: string | undefined = prof.picture || undefined
        return { picture }
      } catch {
        return { picture: undefined as string | undefined }
      }
    },
  })
  const pic = data?.picture
  const body = (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/40 overflow-hidden">
      {pic ? <img src={pic} alt="avatar" className="w-6 h-6 object-cover" /> : <UserIcon className="w-4 h-4 opacity-60" />}
    </span>
  )
  if (onOpen) {
    return (
      <button type="button" onClick={() => onOpen(pubkey)} className="focus:outline-none" title={shorten(pubkey, 12)}>
        {body}
      </button>
    )
  }
  return body
}

function GlobeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 21c4.971 0 9-4.029 9-9s-4.029-9-9-9-9 4.029-9 9 4.029 9 9 9z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 12h18M12 3c2.5 2.5 3.75 5.5 3.75 9S14.5 17.5 12 21M12 3C9.5 5.5 8.25 8.5 8.25 12S9.5 17.5 12 21" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 21c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function UsersIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 11c2.209 0 4-1.791 4-4S11.209 3 9 3 5 4.791 5 7s1.791 4 4 4z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 21c0-3.314 2.686-6 6-6h2c3.314 0 6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17 11c1.657 0 3-1.343 3-3s-1.343-3-3-3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M22 21c0-2.209-1.791-4-4-4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function UpArrowIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 19V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ThreadReelIcon({ className = '' }: { className?: string }) {
  // Simple spool/reel: two discs with thread lines
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6" y="5" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8h8M8 11h8M8 14h8M8 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ReplyBubbleIcon({ className = '' }: { className?: string }) {
  // Speech bubble
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 5h12a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H10l-5 4v-4H4a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" transform="translate(2 1)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function QuoteIcon({ className = '' }: { className?: string }) {
  // Heavy quote marks
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 7c-2.761 0-5 2.239-5 5v5h5v-5H7c0-1.105.895-2 2-2V7z" fill="currentColor" />
      <path d="M20 7c-2.761 0-5 2.239-5 5v5h5v-5h-2c0-1.105.895-2 2-2V7z" fill="currentColor" />
    </svg>
  )
}

export function RepostEllipsisBubbleIcon({ className = '' }: { className?: string }) {
  // Speech bubble with three dots
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 5h12a4 4 0 0 1 4 4v3a4 4 0 0 1-4 4H10l-5 4v-4H4a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" transform="translate(2 1)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="9" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="15" cy="12" r="1.25" fill="currentColor" />
    </svg>
  )
}

function ImageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 13l3-3 5 6H8z" fill="currentColor" />
      <circle cx="10" cy="9" r="1.5" fill="currentColor" />
    </svg>
  )
}

function EmojiIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
      <path d="M8 14c1.333 1 2.667 1 4 0s2.667-1 4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function SendIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 11l18-8-8 18-2-7-8-3z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
    </svg>
  )
}

function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CompactReactionNote({ ev, openProfileByPubkey, userPubkey }: { ev: NDKEvent; openProfileByPubkey?: (pubkey: string) => void; userPubkey?: string }) {
  const { data: profile } = useQuery({
    queryKey: ['profile', ev.pubkey || ''],
    enabled: !!ev.pubkey,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      try {
        const user = ndk.getUser({ pubkey: ev.pubkey || '' })
        try { await withTimeout(user.fetchProfile(), 4000, 'compact reaction profile fetch') } catch {}
        const prof: any = user.profile || {}
        const name: string = prof.displayName || prof.display_name || prof.name || prof.nip05 || ''
        const picture: string | undefined = prof.picture || undefined
        const banner: string | undefined = prof.banner || undefined
        return { name, picture, banner }
      } catch {
        return { name: '', picture: undefined as string | undefined, banner: undefined as string | undefined }
      }
    },
  })

  // Get the event ID being reacted to from the 'e' tags
  const reactionTargetId = useMemo(() => {
    const eTags = (ev.tags || []).filter(t => t[0] === 'e')
    return eTags.length > 0 ? eTags[0][1] : null
  }, [ev.tags])

  // Fetch the event being reacted to
  const { data: referencedEvent } = useQuery<NDKEvent | null>({
    queryKey: ['reaction-target', reactionTargetId],
    enabled: !!reactionTargetId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      if (!reactionTargetId) return null
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [reactionTargetId] } as any), 6000, 'fetch reaction target')
        const events = Array.from(set)
        return events[0] || null
      } catch {
        return null
      }
    },
  })

  const reactionContent = ev.content || '❤️'
  const name = profile?.name || shorten(ev.pubkey || '')
  const picture = profile?.picture
  const banner = profile?.banner

  // Check if reaction content is an image URL
  const isImageReaction = reactionContent.startsWith('http') && /\.(jpg|jpeg|png|gif|webp|bmp|svg)(?:\?.*)?$/i.test(reactionContent)

  return (
    <div className="border-b border-[#37474f] overflow-hidden">
      {/* Reaction header with banner background */}
      <div 
        className="relative p-3"
        style={banner ? { 
          backgroundImage: `url(${banner})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        } : {}}
      >
        {banner && <div className="absolute inset-0 bg-black/60" />}
        <div className="relative flex items-center gap-3">
          <button
            type="button"
            onClick={() => openProfileByPubkey?.(ev.pubkey || '')}
            className="flex-shrink-0"
          >
            {picture ? (
              <img src={picture} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <UserIcon className="w-8 h-8 text-[#cccccc]" />
            )}
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <button
              type="button"
              onClick={() => openProfileByPubkey?.(ev.pubkey || '')}
              className="font-medium text-[#f0f0f0] hover:underline"
            >
              {name}
            </button>
            <span className="text-[#cccccc]">reacted</span>
            {isImageReaction ? (
              <img 
                src={reactionContent} 
                alt="reaction" 
                className="inline-block w-6 h-6 object-cover rounded"
              />
            ) : (
              <span className="text-lg">{reactionContent}</span>
            )}
            <span className="text-sm text-[#999] ml-auto">{formatTime(ev.created_at)}</span>
          </div>
        </div>
      </div>

      {/* Referenced event below */}
      {referencedEvent ? (
        <div className="bg-[#10181b] p-3">
          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <header className="mb-2 flex items-center gap-2 text-xs text-[#cccccc]">
                <AuthorLabel pubkey={referencedEvent.pubkey || ''} onOpen={(pk) => openProfileByPubkey?.(pk)} />
                <span className="opacity-50">·</span>
                <time className="opacity-70">{formatTime(referencedEvent.created_at)}</time>
              </header>
              <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                {referencedEvent.content}
              </div>
            </div>
          </div>
        </div>
      ) : reactionTargetId ? (
        <div className="bg-[#10181b] p-3">
          <div className="text-sm text-[#cccccc] opacity-70">Loading referenced event...</div>
        </div>
      ) : null}
    </div>
  )
}

export function ReplyComposer({ value, onChange, onClose, onSend, replyKey }: { value: string; onChange: (v: string) => void; onClose: () => void; onSend: () => void; replyKey?: string }) {
  return (
    <div className="mt-3 border border-black rounded bg-[#0f1a1d] text-[#cccccc]" data-reply-key={replyKey}>
      <div className="flex items-stretch gap-2 p-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write a reply..."
          className="flex-1 resize-none bg-transparent outline-none text-[#cccccc] p-2 border border-black rounded min-h-[9rem]"
          rows={6}
        />
        <div className="flex flex-col items-center gap-2 self-stretch">
          <button type="button" className="bg-[#162a2f] text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#1b3a40]" title="Add image">
            <ImageIcon className="w-6 h-6" />
          </button>
          <button type="button" className="bg-[#162a2f] text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#1b3a40]" title="Emoji">
            <EmojiIcon className="w-6 h-6" />
          </button>
          <button type="button" onClick={onSend} className="bg-[#1b3a40] text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#215059]" title="Send">
            <SendIcon className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function QuoteComposer({ value, onChange, onClose, onSend, quoteKey }: { value: string; onChange: (v: string) => void; onClose: () => void; onSend: () => void; quoteKey?: string }) {
  return (
    <div className="mt-3 border border-black rounded bg-[#0f1a1d] text-[#cccccc]" data-quote-key={quoteKey}>
      <div className="flex items-stretch gap-2 p-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write a quote post..."
          className="flex-1 resize-none bg-transparent outline-none text-[#cccccc] p-2 border border-black rounded min-h-[9rem]"
          rows={6}
        />
        <div className="flex flex-col items-center gap-2 self-stretch">
          <button type="button" className="bg-[#162a2f] text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#1b3a40]" title="Add image">
            <ImageIcon className="w-6 h-6" />
          </button>
          <button type="button" className="bg-[#162a2f] text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#1b3a40]" title="Emoji">
            <EmojiIcon className="w-6 h-6" />
          </button>
          <button type="button" onClick={onSend} className="bg-[#1b3a40] text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#215059]" title="Send">
            <SendIcon className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  )
}


function ThreadsStackView({ openedThreads, threadTriggerNotes, openMedia, openProfileByBech, openProfileByPubkey, onReply, onRepost, onQuote, onOpenNote, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, openHashtag, onOpenThreadAsMain, onCloseThread, userFollows }: {
  openedThreads: string[];
  threadTriggerNotes: Record<string, string>;
  openMedia: (g: MediaGallery) => void;
  openProfileByBech: (bech: string) => void;
  openProfileByPubkey: (pubkey: string) => void;
  onReply: (scopeId: string) => (e: NDKEvent) => void;
  onRepost: (e: NDKEvent) => void;
  onQuote: (e: NDKEvent) => void;
  onOpenNote: (e: NDKEvent) => void;
  actionMessages: Record<string, string>;
  replyOpen?: Record<string, boolean>;
  replyBuffers?: Record<string, string>;
  onChangeReplyText?: (id: string, v: string) => void;
  onCloseReply?: (id: string) => void;
  onSendReply?: (key: string) => void;
  openHashtag?: (tag: string) => void;
  onOpenThreadAsMain: (rootId: string) => void;
  onCloseThread: (rootId: string) => void;
  userFollows?: string[];
  repostMode?: Record<string, boolean>;
  onCancelRepost?: (e: NDKEvent) => void;
  quoteOpen?: Record<string, boolean>;
  quoteBuffers?: Record<string, string>;
  onChangeQuoteText?: (id: string, v: string) => void;
  onCloseQuote?: (id: string) => void;
  onSendQuote?: (targetId: string) => void;
}) {
  // State to track which threads are folded
  const [foldedThreads, setFoldedThreads] = useState<Record<string, boolean>>({})

  // Toggle fold state for a specific thread
  const toggleFold = (rootId: string) => {
    setFoldedThreads(prev => ({
      ...prev,
      [rootId]: !prev[rootId]
    }))
  }

  if (openedThreads.length === 0) {
    return (
      <div className="p-6 text-center text-[#cccccc] opacity-60">
        <ThreadReelIcon className="w-16 h-16 mx-auto mb-3" />
        <div className="text-lg font-medium mb-2">No Threads Open</div>
        <div className="text-sm">Open threads from the main feed to see them here as a stack</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-h-screen overflow-y-auto">
      {openedThreads.map((rootId, index) => (
        <div key={rootId} className="bg-[#0f1a1d] rounded-lg shadow-xl overflow-hidden w-full">
          <div className="flex items-center justify-between px-3 py-2 border-b border-black/50 bg-[#1a2529]">
            <button
              type="button"
              onClick={() => toggleFold(rootId)}
              className="text-[#fff3b0] font-semibold hover:text-white transition-colors flex items-center gap-2 flex-1"
              title={foldedThreads[rootId] ? "Unfold thread" : "Fold thread"}
            >
              <span className="text-xs">
                {foldedThreads[rootId] ? '▼' : '▲'}
              </span>
              Thread {index + 1}
            </button>
            <button type="button" onClick={() => onCloseThread(rootId)} className="w-8 h-8 rounded-full bg-black/70 text-white hover:bg-black/90" aria-label="Close thread">×</button>
          </div>
          {!foldedThreads[rootId] && (
            <ThreadPanelContent
              rootId={rootId}
              triggerNoteId={threadTriggerNotes[rootId]}
              openMedia={openMedia}
              openProfileByBech={openProfileByBech}
              openProfileByPubkey={openProfileByPubkey}
              onReply={onReply(`thread-stack:${rootId}`)}
              onRepost={onRepost}
              onQuote={onQuote}
              onOpenNote={onOpenNote}
              replyOpen={replyOpen}
              replyBuffers={replyBuffers}
              onChangeReplyText={onChangeReplyText}
              onCloseReply={onCloseReply}
              onSendReply={onSendReply}
              openHashtag={openHashtag}
              userFollows={userFollows}
              repostMode={repostMode}
              onCancelRepost={onCancelRepost}
              quoteOpen={quoteOpen}
              quoteBuffers={quoteBuffers}
              onChangeQuoteText={onChangeQuoteText}
              onCloseQuote={onCloseQuote}
              onSendQuote={onSendQuote}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ThreadPanelContent({ rootId, triggerNoteId, openMedia, openProfileByBech, openProfileByPubkey, onReply, onRepost, onQuote, onOpenNote, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, openHashtag, userFollows, repostMode, onCancelRepost, quoteOpen, quoteBuffers, onChangeQuoteText, onCloseQuote, onSendQuote }: {
  rootId: string;
  triggerNoteId?: string;
  openMedia: (g: MediaGallery) => void;
  openProfileByBech: (bech: string) => void;
  openProfileByPubkey: (pubkey: string) => void;
  onReply: (e: NDKEvent) => void;
  onRepost: (e: NDKEvent) => void;
  onQuote: (e: NDKEvent) => void;
  onOpenNote: (e: NDKEvent) => void;
  replyOpen?: Record<string, boolean>;
  replyBuffers?: Record<string, string>;
  onChangeReplyText?: (id: string, v: string) => void;
  onCloseReply?: (id: string) => void;
  onSendReply?: (key: string) => void;
  openHashtag?: (tag: string) => void;
  userFollows?: string[];
  repostMode?: Record<string, boolean>;
  onCancelRepost?: (e: NDKEvent) => void;
  quoteOpen?: Record<string, boolean>;
  quoteBuffers?: Record<string, string>;
  onChangeQuoteText?: (id: string, v: string) => void;
  onCloseQuote?: (id: string) => void;
  onSendQuote?: (targetId: string) => void;
}) {
  const scopeId = `thread-stack:${rootId}`;
  const { data: root } = useQuery<NDKEvent | null>({
    queryKey: ['thread-root', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [rootId] } as any), 8000, 'fetch thread root')
        return Array.from(set)[0] || null
      } catch {
        return null
      }
    },
  })
  
  // Fetch the triggering note if it's different from the root
  const { data: triggerNote } = useQuery<NDKEvent | null>({
    queryKey: ['trigger-note', triggerNoteId],
    enabled: !!triggerNoteId && triggerNoteId !== rootId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      if (!triggerNoteId || triggerNoteId === rootId) return null
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [triggerNoteId] } as any), 8000, 'fetch trigger note')
        return Array.from(set)[0] || null
      } catch {
        return null
      }
    },
  })
  const { data: children } = useQuery<NDKEvent[]>({
    queryKey: ['thread-children', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      return await fetchThreadEvents(rootId)
    },
  })
  
  const all = useMemo(() => {
    const arr: NDKEvent[] = []
    if (root) arr.push(root)
    for (const c of (children || [])) arr.push(c)
    const map = new Map<string, NDKEvent>()
    for (const ev of arr) { if (ev.id) map.set(ev.id, ev) }
    return Array.from(map.values())
  }, [root, children])

  const { tree, order, truncated } = useMemo(() => {
    // Same tree building logic as ThreadPanel
    const nonReposts = all.filter(ev => ev.kind !== 6)
    const byId = new Map<string, NDKEvent>()
    for (const ev of nonReposts) if (ev.id) byId.set(ev.id, ev)
    const parentOf = new Map<string, string | null>()
    for (const ev of nonReposts) {
      const eTags = (ev.tags || []).filter(t => t[0] === 'e')
      let parent: string | null = null
      const reply = eTags.find(t => t[3] === 'reply')?.[1] as string | undefined
      const rootTag = eTags.find(t => t[3] === 'root')?.[1] as string | undefined
      if (reply) parent = reply
      else if (rootTag && rootTag !== ev.id) parent = rootTag
      else if (eTags.length > 0) parent = (eTags[eTags.length - 1][1] as string)
      else parent = null
      if (parent === ev.id) parent = (ev.id === rootId ? null : rootId)
      if (parent && !byId.has(parent)) parent = rootId
      parentOf.set(ev.id as string, parent)
    }
    const childrenMap = new Map<string, string[]>()
    for (const [id, p] of parentOf) {
      const key = p || 'root'
      if (!childrenMap.has(key)) childrenMap.set(key, [])
      childrenMap.get(key)!.push(id)
    }
    for (const [k, arr] of childrenMap) {
      arr.sort((a, b) => ((byId.get(a)?.created_at || 0) - (byId.get(b)?.created_at || 0)))
    }
    const order: string[] = []
    let truncated = false
    const MAX_VISIT = 1000
    try {
      if (byId.has(rootId)) {
        const stack: string[] = [rootId]
        const visited = new Set<string>()
        while (stack.length > 0) {
          const id = stack.pop() as string
          if (visited.has(id)) continue
          visited.add(id)
          order.push(id)
          if (order.length >= MAX_VISIT) { truncated = true; break }
          const kids = childrenMap.get(id) || []
          for (let i = kids.length - 1; i >= 0; i--) {
            const kid = kids[i]
            if (!visited.has(kid)) stack.push(kid)
          }
        }
      }
    } catch {
      truncated = true
    }
    return { tree: { byId, childrenMap, parentOf }, order, truncated }
  }, [all, rootId])

  return (
    <div className="max-h-[50vh] overflow-y-auto">
      <div className="p-3">
        {order.length === 0 ? (
          <div className="text-sm text-[#cccccc]">Loading thread…</div>
        ) : (
          <div className="space-y-3">
            {/* Show the triggering note at the top with highlighting if it's different from root */}
            {triggerNote && triggerNoteId !== rootId && (
              <div className="border-2 border-[#fff3b0] rounded-lg bg-[#fff3b0]/10 overflow-hidden">
                <div className="px-3 py-1 bg-[#fff3b0]/20 text-[#fff3b0] text-sm font-medium">
                  Note that opened this thread:
                </div>
                <div className="p-1">
                  <NoteCard
                    key={`trigger-${triggerNoteId}`}
                    ev={triggerNote}
                    scopeId={scopeId}
                    onReply={onReply}
                    onRepost={onRepost}
                    onQuote={onQuote}
                    onOpenThread={() => {}}
                    onOpenNote={onOpenNote}
                    openMedia={openMedia}
                    openProfileByBech={openProfileByBech}
                    openProfileByPubkey={openProfileByPubkey}
                    replyOpen={replyOpen}
                    replyBuffers={replyBuffers}
                    onChangeReplyText={onChangeReplyText}
                    onCloseReply={onCloseReply}
                    onSendReply={onSendReply}
                    openHashtag={openHashtag}
                    userFollows={userFollows}
                    hideThread={true}
                    repostMode={repostMode}
                    onCancelRepost={onCancelRepost}
                    quoteOpen={quoteOpen}
                    quoteBuffers={quoteBuffers}
                    onChangeQuoteText={onChangeQuoteText}
                    onCloseQuote={onCloseQuote}
                    onSendQuote={onSendQuote}
                  />
                </div>
              </div>
            )}
            {/* Show regular thread order */}
            {order.slice(0, 10).map((id) => {
              const ev = tree.byId.get(id)
              if (!ev) return null
              return (
                <NoteCard
                  key={id}
                  ev={ev}
                  scopeId={scopeId}
                  onReply={onReply}
                  onRepost={onRepost}
                  onQuote={onQuote}
                  onOpenThread={() => {}}
                  onOpenNote={onOpenNote}
                  openMedia={openMedia}
                  openProfileByBech={openProfileByBech}
                  openProfileByPubkey={openProfileByPubkey}
                  replyOpen={replyOpen}
                  replyBuffers={replyBuffers}
                  onChangeReplyText={onChangeReplyText}
                  onCloseReply={onCloseReply}
                  onSendReply={onSendReply}
                  openHashtag={openHashtag}
                  userFollows={userFollows}
                  hideThread={true}
                  repostMode={repostMode}
                  onCancelRepost={onCancelRepost}
                  quoteOpen={quoteOpen}
                  quoteBuffers={quoteBuffers}
                  onChangeQuoteText={onChangeQuoteText}
                  onCloseQuote={onCloseQuote}
                  onSendQuote={onSendQuote}
                />
              )
            })}
            {order.length > 10 && (
              <div className="text-sm text-[#cccccc] opacity-60 text-center">
                ... and {order.length - 10} more replies
              </div>
            )}
            {truncated && (
              <div className="text-sm text-[#cccccc] opacity-60 text-center">
                Thread truncated (too many replies)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadPanel({ rootId, seedId: _seedId, onClose, openMedia, openProfileByBech, openProfileByPubkey, onReply, onRepost, onQuote, onOpenNote, replyOpen, replyBuffers, onChangeReplyText: onChangeReplyTextById, onCloseReply: onCloseReplyById, onSendReply, activeReplyTargetId, replyText, onChangeReplyText, onCloseReply, openHashtag, userFollows, repostMode, onCancelRepost }: { rootId: string; seedId?: string; onClose: () => void; openMedia: (g: MediaGallery) => void; openProfileByBech: (bech: string) => void; openProfileByPubkey: (pubkey: string) => void; onReply: (e: NDKEvent) => void; onRepost: (e: NDKEvent) => void; onQuote: (e: NDKEvent) => void; onOpenNote: (e: NDKEvent) => void; replyOpen?: Record<string, boolean>; replyBuffers?: Record<string, string>; onChangeReplyText?: (id: string, v: string) => void; onCloseReply?: (id: string) => void; onSendReply?: (targetId: string) => void; activeReplyTargetId?: string | null; replyText?: string; onChangeReplyText?: (v: string) => void; onCloseReply?: () => void; openHashtag?: (tag: string) => void; userFollows?: string[]; repostMode?: Record<string, boolean>; onCancelRepost?: (e: NDKEvent) => void }) {
  const scopeId = `thread-panel:${rootId}`
  const { data: root } = useQuery<NDKEvent | null>({
    queryKey: ['thread-root', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [rootId] } as any), 8000, 'fetch thread root')
        return Array.from(set)[0] || null
      } catch {
        return null
      }
    },
  })
  const { data: children } = useQuery<NDKEvent[]>({
    queryKey: ['thread-children', rootId],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      return await fetchThreadEvents(rootId)
    },
  })
  // Ensure the seed event (the one whose button opened the thread) is included
  const { data: seed } = useQuery<NDKEvent | null>({
    queryKey: ['thread-seed', _seedId],
    enabled: !!_seedId && _seedId !== rootId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      try {
        const set = await withTimeout(ndk.fetchEvents({ ids: [_seedId!] } as any), 8000, 'fetch thread seed')
        return Array.from(set)[0] || null
      } catch {
        return null
      }
    },
  })
  const all = useMemo(() => {
    const arr: NDKEvent[] = []
    if (root) arr.push(root)
    if (seed) arr.push(seed)
    for (const c of (children || [])) arr.push(c)
    const map = new Map<string, NDKEvent>()
    for (const ev of arr) { if (ev.id) map.set(ev.id, ev) }
    return Array.from(map.values())
  }, [root, seed, children])
  const { tree, order, truncated } = useMemo(() => {
    // Exclude reposts (kind 6) from the thread tree; we will summarize them at the bottom
    const nonReposts = all.filter(ev => ev.kind !== 6)
    const byId = new Map<string, NDKEvent>()
    for (const ev of nonReposts) if (ev.id) byId.set(ev.id, ev)
    const parentOf = new Map<string, string | null>()
    for (const ev of nonReposts) {
      const eTags = (ev.tags || []).filter(t => t[0] === 'e')
      let parent: string | null = null
      const reply = eTags.find(t => t[3] === 'reply')?.[1] as string | undefined
      const rootTag = eTags.find(t => t[3] === 'root')?.[1] as string | undefined
      if (reply) parent = reply
      else if (rootTag && rootTag !== ev.id) parent = rootTag
      else if (eTags.length > 0) parent = (eTags[eTags.length - 1][1] as string)
      else parent = null
      // Guard against self-parenting which can cause infinite loops/duplication
      if (parent === ev.id) parent = (ev.id === rootId ? null : rootId)
      if (parent && !byId.has(parent)) parent = rootId
      parentOf.set(ev.id as string, parent)
    }
    const childrenMap = new Map<string, string[]>()
    for (const [id, p] of parentOf) {
      const key = p || 'root'
      if (!childrenMap.has(key)) childrenMap.set(key, [])
      childrenMap.get(key)!.push(id)
    }
    for (const [k, arr] of childrenMap) {
      arr.sort((a, b) => ((byId.get(a)?.created_at || 0) - (byId.get(b)?.created_at || 0)))
    }
    const order: string[] = []
    let truncated = false
    const MAX_VISIT = 1000
    try {
      if (byId.has(rootId)) {
        const stack: string[] = [rootId]
        const visited = new Set<string>()
        while (stack.length > 0) {
          const id = stack.pop() as string
          if (visited.has(id)) continue
          visited.add(id)
          order.push(id)
          if (order.length >= MAX_VISIT) { truncated = true; break }
          const kids = childrenMap.get(id) || []
          for (let i = kids.length - 1; i >= 0; i--) {
            const kid = kids[i]
            if (!visited.has(kid)) stack.push(kid)
          }
        }
      }
    } catch {
      truncated = true
    }
    return { tree: { byId, childrenMap, parentOf }, order, truncated }
  }, [all, rootId])
  // Collect reposters to show at the bottom
  const reposters = useMemo(() => {
    const set = new Set<string>()
    for (const ev of all) {
      if ((ev as any).kind === 6 && ev.pubkey) set.add(ev.pubkey)
    }
    return Array.from(set)
  }, [all])
  return (
    <div className="bg-[#0f1a1d] rounded-lg shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-black/50">
        <div className="text-[#fff3b0] font-semibold">Thread</div>
        <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-black/70 text-white hover:bg-black/90" aria-label="Close thread panel">×</button>
      </div>
      <div className="max-h-[calc(100vh-7rem)] overflow-auto">
        <div className="p-4">
          {!root ? (
            <div className="text-sm text-[#cccccc]">Loading thread…</div>
          ) : (
            <div className="space-y-4">
              {order.map((id) => {
                const ev = tree.byId.get(id) as NDKEvent
                if (!ev) return null
                let depth = 0
                {
                  let cur = id as string
                  let safety = 0
                  while (true) {
                    const p = tree.parentOf.get(cur) || null
                    if (!p || p === rootId) break
                    depth++
                    cur = p
                    if (++safety > 64) break
                  }
                }
                return (
                  <div key={id} className="border border-black rounded bg-[#10181b]" style={{ marginLeft: Math.min(24, depth) * 16 }}>
                    <div className="p-3">
                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0">
                          <header className="mb-2 flex items-center gap-2 text-xs text-[#cccccc]">
                            <AuthorLabel pubkey={ev.pubkey || ''} onOpen={(pk) => openProfileByPubkey(pk)} />
                            <span className="opacity-50">·</span>
                            <time className="opacity-70">{formatTime(ev.created_at)}</time>
                          </header>
                          {ev.kind === 6 ? (
                            <RepostNote 
                              ev={ev} 
                              openMedia={openMedia} 
                              openProfile={openProfileByBech} 
                              openProfileByPubkey={openProfileByPubkey}
                              openHashtag={openHashtag}
                              onReply={onReply}
                              onRepost={onRepost}
                              onQuote={onQuote}
                              onOpenNote={onOpenNote}
                              scopeId={scopeId}
                              actionMessages={undefined}
                              replyOpen={replyOpen}
                              replyBuffers={replyBuffers}
                              onChangeReplyText={onChangeReplyText}
                              onCloseReply={onCloseReply}
                              onSendReply={onSendReply}
                              userFollows={userFollows}
                              repostMode={repostMode}
                              onCancelRepost={onCancelRepost}
                            />
                          ) : (
                            <div className="whitespace-pre-wrap break-words text-[#cccccc]">
                              {renderContent(ev.content, openMedia, openProfileByBech, openHashtag, extractHashtagTags(ev.tags), userFollows ? userFollows.includes(ev.pubkey || '') : false, (id: string) => onOpenNote({id} as NDKEvent), onReply, onRepost, onQuote, undefined, scopeId, undefined, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, userFollows)}
                            </div>
                          )}
                          {(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) && (
                            <ReplyComposer
                              value={(replyBuffers?.[`${scopeId}|${ev.id}`] || '')}
                              onChange={(v) => onChangeReplyTextById?.(`${scopeId}|${ev.id!}`, v)}
                              onClose={() => onCloseReplyById?.(`${scopeId}|${ev.id!}`)}
                              onSend={() => onSendReply?.(ev.id!)}
                              replyKey={`${scopeId}|${ev.id}`}
                            />
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0 self-start">
                          <button type="button" onClick={() => onQuote(ev)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Quote">
                            <QuoteIcon className="w-8 h-8" />
                          </button>
                          {repostMode?.[ev.id || ''] ? (
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => onRepost(ev)} className="bg-[#fff3b0] text-black text-xs px-2 py-1 rounded-full hover:bg-[#ffed80] flex items-center gap-2" title="Repost (active)">
                                <RepostEllipsisBubbleIcon className="w-8 h-8" />
                              </button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); onCancelRepost?.(ev) }} className="bg-red-600 text-white text-xs px-2 py-1 rounded-full hover:bg-red-700 flex items-center gap-2" title="Cancel repost">
                                ×
                              </button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => onRepost(ev)} className="bg-[#1b3a40] text-white text-xs px-2 py-1 rounded-full hover:bg-[#215059] flex items-center gap-2" title="Repost">
                              <RepostEllipsisBubbleIcon className="w-8 h-8" />
                            </button>
                          )}
                          <button type="button" onClick={() => onReply(ev)} className={`${(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Reply">
                            <ReplyBubbleIcon className="w-8 h-8" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {truncated && (
                <div className="text-xs text-[#cccccc] opacity-70">Thread truncated due to size. Some replies may be hidden.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
