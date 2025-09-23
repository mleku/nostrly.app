import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { fetchFeedEvents, publishNote } from '@/lib/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'

export const Route = createFileRoute('/feed')({
  component: Feed,
})

interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  content: string
  author_name?: string
}

function Feed() {
  const [newNote, setNewNote] = useState('')
  const queryClient = useQueryClient()

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['nostr-feed'],
    queryFn: async (): Promise<NostrEvent[]> => {
      const ndkEvents = await fetchFeedEvents(50)
      return ndkEvents.map((event: NDKEvent) => ({
        id: event.id || '',
        pubkey: event.pubkey || '',
        created_at: (event.created_at || 0) * 1000, // Convert to milliseconds
        kind: event.kind || 1,
        content: event.content || '',
        author_name: event.author?.profile?.name || undefined
      }))
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  })

  const publishNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      const event = await publishNote(content)
      if (event) {
        return {
          id: event.id || '',
          pubkey: event.pubkey || '',
          created_at: (event.created_at || 0) * 1000,
          kind: event.kind || 1,
          content: event.content || '',
          author_name: 'You'
        }
      }
      throw new Error('Failed to publish note')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nostr-feed'] })
      setNewNote('')
    },
  })

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault()
    if (newNote.trim()) {
      publishNoteMutation.mutate(newNote)
    }
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  return (
    <div className="feed-page">
      <h2>Nostr Feed</h2>
      
      <div className="compose-section">
        <h3>Compose Note</h3>
        <form onSubmit={handlePublish}>
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="What's happening?"
            rows={3}
            className="compose-textarea"
          />
          <button 
            type="submit" 
            disabled={publishNoteMutation.isPending || !newNote.trim()}
          >
            {publishNoteMutation.isPending ? 'Publishing...' : 'Publish Note'}
          </button>
        </form>
      </div>

      <div className="feed-section">
        <h3>Recent Notes</h3>
        {isLoading ? (
          <p>Loading feed...</p>
        ) : events.length === 0 ? (
          <p>No notes found. Be the first to post!</p>
        ) : (
          <div className="notes-list">
            {events.map((event) => (
              <div key={event.id} className="note-card">
                <div className="note-header">
                  <strong>{event.author_name || event.pubkey.slice(0, 16) + '...'}</strong>
                  <span className="note-timestamp">
                    {formatTimestamp(event.created_at)}
                  </span>
                </div>
                <div className="note-content">
                  {event.content}
                </div>
                <div className="note-meta">
                  <small>Event ID: {event.id}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}