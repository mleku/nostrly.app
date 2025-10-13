<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import { nostrClient } from './nostr.js';
    import { getCachedUserProfile } from './profileManager.js';

    export let noteId = '';
    export let url = '';

    const dispatch = createEventDispatcher();

    let note = null;
    let loading = true;
    let error = false;
    let profile = null;

    // Decode note ID from nostr:note URL
    function decodeNoteId(noteUrl) {
        if (noteUrl.startsWith('nostr:note')) {
            // Extract note ID from nostr:note1...
            return noteUrl.replace('nostr:note', '');
        }
        return null;
    }

    // Fetch the note event
    async function fetchNote() {
        if (!noteId) return;
        
        loading = true;
        error = false;
        
        try {
            const subscriptionId = nostrClient.subscribe(
                { ids: [noteId] },
                (event) => {
                    if (event && event.id === noteId) {
                        note = event;
                        loading = false;
                        
                        // Fetch profile for the note author
                        if (event.pubkey) {
                            profile = getCachedUserProfile(event.pubkey);
                        }
                    }
                }
            );
            
            // Timeout if no note found
            setTimeout(() => {
                if (!note) {
                    loading = false;
                    error = true;
                }
            }, 5000);
            
        } catch (err) {
            loading = false;
            error = true;
        }
    }

    // Handle note click
    function handleNoteClick() {
        if (note) {
            dispatch('eventSelect', { eventId: note.id });
        }
    }

    // Format timestamp
    function formatTime(timestamp) {
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        if (diffDays < 7) return `${diffDays}d`;
        return date.toLocaleDateString();
    }

    onMount(() => {
        if (noteId) {
            fetchNote();
        } else if (url) {
            const decodedId = decodeNoteId(url);
            if (decodedId) {
                noteId = decodedId;
                fetchNote();
            } else {
                loading = false;
                error = true;
            }
        }
    });
</script>

<div class="inline-note" on:click={handleNoteClick} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && handleNoteClick()}>
    {#if loading}
        <div class="loading">Loading note...</div>
    {:else if error}
        <div class="error">Note not found</div>
    {:else if note}
        <div class="note-header">
            <div class="note-author">
                {#if profile}
                    <div class="author-info">
                        {#if profile.picture}
                            <img src={profile.picture} alt="Avatar" class="avatar-small" />
                        {:else}
                            <div class="avatar-placeholder-small"></div>
                        {/if}
                        <span class="username-small">{profile.name || profile.display_name || note.pubkey.slice(0, 8) + '...'}</span>
                        <span class="note-time">{formatTime(note.created_at)}</span>
                    </div>
                {:else}
                    <span class="pubkey-fallback-small">{note.pubkey.slice(0, 8)}...</span>
                    <span class="note-time">{formatTime(note.created_at)}</span>
                {/if}
            </div>
        </div>
        <div class="note-content">
            {note.content}
        </div>
    {/if}
</div>

<style>
    .inline-note {
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 0.75rem;
        margin: 0.5rem 0;
        background-color: var(--bg-color-secondary, var(--bg-color));
        cursor: pointer;
        transition: background-color 0.2s, border-color 0.2s;
    }

    .inline-note:hover {
        background-color: var(--button-hover-bg);
        border-color: var(--primary);
    }

    .inline-note:focus {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
    }

    .loading, .error {
        text-align: center;
        padding: 1rem;
        color: var(--text-color-secondary, var(--text-color));
        font-style: italic;
        font-size: 0.9rem;
    }

    .error {
        color: var(--error-color, #ef4444);
    }

    .note-header {
        margin-bottom: 0.5rem;
    }

    .note-author {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .author-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .avatar-small {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
    }

    .avatar-placeholder-small {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        background-color: var(--border-color);
    }

    .username-small {
        font-weight: 600;
        color: var(--text-color);
        font-size: 0.85rem;
    }

    .note-time {
        color: var(--text-color);
        font-size: 0.75rem;
        opacity: 0.7;
        margin-left: 0.5rem;
    }

    .pubkey-fallback-small {
        font-family: monospace;
        font-size: 0.8rem;
        color: var(--text-color-secondary);
        opacity: 0.7;
    }

    .note-content {
        font-size: 0.9rem;
        line-height: 1.4;
        color: var(--text-color);
        word-wrap: break-word;
        white-space: pre-wrap;
    }
</style>
