import { useRef, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '@/lib/ndk'
import { renderContent, type MediaGallery, QuoteIcon, RepostEllipsisBubbleIcon, ReplyBubbleIcon, formatTime, AuthorLabel, ReactionButtonRow, ReplyComposer, QuoteComposer, RepostNote } from './index'

export function NoteCard({ ev, scopeId, onReply, onRepost, onQuote, onOpenThread, onOpenNote, openMedia, openProfileByBech, openProfileByPubkey, actionMessages, replyOpen, replyBuffers, onChangeReplyText, onCloseReply, onSendReply, openHashtag, userFollows, userPubkey, showActionMessage, repostMode, onCancelRepost, quoteOpen, quoteBuffers, onChangeQuoteText, onCloseQuote, onSendQuote, onHoverOpen }: { ev: NDKEvent; scopeId: string; onReply: (e: NDKEvent) => void; onRepost: (e: NDKEvent) => void; onQuote: (e: NDKEvent) => void; onOpenThread: (e: NDKEvent) => void; onOpenNote: (e: NDKEvent) => void; openMedia: (g: MediaGallery) => void; openProfileByBech: (bech: string) => void; openProfileByPubkey: (pubkey: string) => void; actionMessages?: Record<string, string | undefined>; replyOpen?: Record<string, boolean>; replyBuffers?: Record<string, string>; onChangeReplyText?: (id: string, v: string) => void; onCloseReply?: (id: string) => void; onSendReply?: (targetId: string) => void; openHashtag?: (tag: string) => void; userFollows?: string[]; userPubkey?: string; showActionMessage?: (e: NDKEvent, msg: string) => void; repostMode?: Record<string, boolean>; onCancelRepost?: (e: NDKEvent) => void; quoteOpen?: Record<string, boolean>; quoteBuffers?: Record<string, string>; onChangeQuoteText?: (id: string, v: string) => void; onCloseQuote?: (id: string) => void; onSendQuote?: (targetId: string) => void; onHoverOpen?: (e: NDKEvent) => void }) {
  // Moved implementation from index.tsx without functional changes.
  const handleReaction = async (targetEvent: NDKEvent, emoji: string) => {
    if (!targetEvent.id || !userPubkey) return
    try {
      const reactionEvent = new NDKEvent(ndk)
      reactionEvent.kind = 7
      reactionEvent.content = emoji
      reactionEvent.tags = [
        ['e', targetEvent.id],
        ['p', targetEvent.pubkey],
      ]
      await reactionEvent.publish()
      showActionMessage?.(targetEvent, `Reacted with ${emoji}`)
    } catch (error) {
      console.error('Failed to publish reaction:', error)
      showActionMessage?.(targetEvent, 'Failed to react')
    }
  }
  const mentionsUser = userPubkey && (ev.tags || []).some(t => t[0] === 'p' && t[1] === userPubkey)

  const [jsonViewerOpen, setJsonViewerOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLElement | null>(null)
  const buttonRowRef = useRef<HTMLDivElement | null>(null)




  const scrollQuoteComposerToCenter = (ev: NDKEvent) => {
    if (scopeId?.startsWith('hover-preview')) return
    setTimeout(() => {
      const quoteKey = `quote|${stateScope}|${ev.id}`
      const quoteComposer = document.querySelector(`[data-quote-key="${quoteKey}"]`)
      if (quoteComposer) {
        const rect = (quoteComposer as HTMLElement).getBoundingClientRect()
        const viewportCenter = window.innerHeight / 2
        const elementCenter = rect.top + rect.height / 2
        const scrollAmount = elementCenter - viewportCenter
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' })
        const textarea = quoteComposer.querySelector('textarea') as HTMLTextAreaElement | null
        if (textarea) {
          textarea.focus()
          textarea.setSelectionRange(0, 0)
        }
      }
    }, 100)
  }

  const handleQuote = (ev: NDKEvent) => {
    onQuote(ev)
    scrollQuoteComposerToCenter(ev)
  }

  const scrollReplyComposerToCenter = (ev: NDKEvent) => {
    setTimeout(() => {
      const replyKey = `${scopeId}|${ev.id}`
      const replyComposer = document.querySelector(`[data-reply-key="${replyKey}"]`)
      if (replyComposer) {
        const rect = (replyComposer as HTMLElement).getBoundingClientRect()
        const viewportCenter = window.innerHeight / 2
        const elementCenter = rect.top + rect.height / 2
        const scrollAmount = elementCenter - viewportCenter
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' })
      }
    }, 100)
  }

  const handleReply = (ev: NDKEvent) => {
    onReply(ev)
    scrollReplyComposerToCenter(ev)
  }


  const hasRootMarker = Array.isArray(ev.tags) && ev.tags.some((tag: any[]) => tag?.[0] === 'e' && tag?.[3] === 'root')
  const stateScope = (scopeId && scopeId.startsWith('hover-preview')) ? 'hover-preview' : scopeId

  return (
  <article className={`p-3 relative rounded-lg bg-black/20 ${hasRootMarker ? 'note-hover-target' : ''}`} ref={cardRef} data-ev-id={ev.id} data-ts={ev.created_at} onClick={(e) => {
        const t = e.target as HTMLElement | null;
        if (t && t.closest('button, a, input, textarea, [contenteditable="true"]')) return;
        if (!hasRootMarker) return;
        onHoverOpen?.(ev);
      }}>
      <div className="flex flex-col">
        <div className="flex gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="relative">
              <header className="mb-1 flex items-center text-sm text-[#cccccc]">
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

            <div
              ref={wrapperRef}
              className="relative"
            >
              <div
                ref={innerRef}
                className="prose prose-invert max-w-none py-4"
              >
                {ev.kind === 6 ? (
                  <RepostNote
                    ev={ev}
                    openMedia={openMedia}
                    openProfile={(bech) => openProfileByBech(bech)}
                    openProfileByPubkey={(pk) => openProfileByPubkey(pk)}
                    openHashtag={(tag) => openHashtag?.(tag)}
                    onReply={(e) => handleReply(e)}
                    onRepost={(e) => onRepost(e)}
                    onQuote={(e) => handleQuote(e)}
                    onOpenNote={(e) => onOpenNote(e)}
                    scopeId={scopeId}
                    actionMessages={actionMessages as any}
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
                  renderContent(
                    ev.content || '',
                    openMedia,
                    (bech) => openProfileByBech(bech),
                    (tag) => openHashtag?.(tag),
                    undefined,
                    (userFollows || []).includes(ev.pubkey || ''),
                    (id) => onOpenNote?.({ ...ev, id } as any),
                    (e) => handleReply(e),
                    (e) => onRepost(e),
                    (e) => handleQuote(e),
                    (e) => onOpenThread(e),
                    scopeId,
                    actionMessages as any,
                    replyOpen,
                    replyBuffers,
                    onChangeReplyText,
                    onCloseReply,
                    onSendReply,
                    userFollows,
                  )
                )}
              </div>

            </div>
            </div>

          </div>
        </div>

        {(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) && (
          <ReplyComposer
            value={(replyBuffers?.[`${scopeId}|${ev.id}`] || '')}
            onChange={(v) => onChangeReplyText?.(`${scopeId}|${ev.id!}`, v)}
            onClose={() => onCloseReply?.(`${scopeId}|${ev.id!}`)}
            onSend={() => onSendReply?.(`${scopeId}|${ev.id!}`)}
            replyKey={`${scopeId}|${ev.id}`}
          />
        )}

        {(ev.id && stateScope && quoteOpen?.[`quote|${stateScope}|${ev.id}`]) && (
          <QuoteComposer
            value={(quoteBuffers?.[`quote|${stateScope}|${ev.id}`] || '')}
            onChange={(v) => onChangeQuoteText?.(`quote|${stateScope}|${ev.id!}`, v)}
            onClose={() => onCloseQuote?.(`quote|${stateScope}|${ev.id!}`)}
            onSend={() => onSendQuote?.(`quote|${stateScope}|${ev.id!}`)}
            quoteKey={`quote|${stateScope}|${ev.id}`}
          />
        )}

        <div className="grid grid-cols-[1fr_auto] items-end gap-x-2 gap-y-1" ref={buttonRowRef}>
          <div className="min-w-0 flex flex-wrap-reverse items-end content-end gap-2">
            {!!ev.id && (
              <ReactionButtonRow eventId={ev.id} onReact={(emoji: string) => handleReaction(ev, emoji)} excludeEl={cardRef.current}
              />
            )}
          </div>

          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={() => handleQuote(ev)} className={`${(ev.id && stateScope && quoteOpen?.[`quote|${stateScope}|${ev.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Quote">
              <QuoteIcon className="w-8 h-8" />
            </button>
            {repostMode?.[`${stateScope}|${ev.id || ''}`] ? (
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
            <button type="button" onClick={() => handleReply(ev)} className={`${(ev.id && replyOpen?.[`${scopeId}|${ev.id}`]) ? 'bg-[#fff3b0] text-black' : 'bg-[#1b3a40] text-white hover:bg-[#215059]'} text-xs px-2 py-1 rounded-full flex items-center gap-2`} title="Reply">
              <ReplyBubbleIcon className="w-8 h-8" />
            </button>
          </div>
        </div>

        {/* Action messages */}
        {!!ev.id && !!actionMessages?.[ev.id] && (
          <div className="mt-1 text-xs text-[#cccccc] opacity-80">{actionMessages[ev.id]}</div>
        )}
      </div>
    </article>
  )
}

export default NoteCard
