<script>
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import { nostrClient } from './nostr.js';

    export let eventId = '';
    export let onClose = () => {};

    const dispatch = createEventDispatcher();

    let originalEvent = null;
    let replies = [];
    let isLoading = false;
    let subscriptionId = null;

    // Fetch the original event
    async function fetchOriginalEvent() {
        if (!eventId) return;
        
        isLoading = true;
        console.log('Fetching original event:', eventId);
        
        try {
            subscriptionId = nostrClient.subscribe(
                { ids: [eventId] },
                (event) => {
                    if (event && event.id === eventId) {
                        originalEvent = event;
                        console.log('Found original event:', event);
                        isLoading = false;
                    }
                }
            );
            
            // Timeout if no event found
            setTimeout(() => {
                if (!originalEvent) {
                    console.log('Original event not found');
                    isLoading = false;
                }
            }, 5000);
            
        } catch (error) {
            console.error('Failed to fetch original event:', error);
            isLoading = false;
        }
    }

    // Fetch replies to the event
    async function fetchReplies() {
        if (!eventId) return;
        
        console.log('Fetching replies for event:', eventId);
        
        try {
            const repliesSubscriptionId = nostrClient.subscribe(
                { 
                    kinds: [1],
                    '#e': [eventId]
                },
                (event) => {
                    if (event && event.kind === 1) {
                        // Check if this is a reply to our event
                        const isReplyToEvent = event.tags.some(tag => 
                            tag[0] === 'e' && tag[1] === eventId && tag[3] === 'reply'
                        );
                        
                        if (isReplyToEvent && !replies.find(r => r.id === event.id)) {
                            replies = [...replies, event].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
                            console.log(`Found ${replies.length} replies`);
                        }
                    }
                }
            );
            
            // Close subscription after collecting replies
            setTimeout(() => {
                nostrClient.unsubscribe(repliesSubscriptionId);
            }, 3000);
            
        } catch (error) {
            console.error('Failed to fetch replies:', error);
        }
    }

    // Check if event is a reply (has 'e' tag with 'reply' in 4th position)
    function isReply(event) {
        if (!event || !event.tags) return false;
        return event.tags.some(tag => 
            tag[0] === 'e' && tag[3] === 'reply'
        );
    }

    // Get the replied-to event ID
    function getReplyToEventId(event) {
        if (!event || !event.tags) return null;
        const replyTag = event.tags.find(tag => 
            tag[0] === 'e' && tag[3] === 'reply'
        );
        return replyTag ? replyTag[1] : null;
    }

    // Handle original event click
    function handleOriginalEventClick() {
        if (originalEvent && isReply(originalEvent)) {
            const replyToId = getReplyToEventId(originalEvent);
            if (replyToId) {
                console.log('Opening parent thread for event:', replyToId);
                dispatch('eventSelect', replyToId);
            }
        }
    }

    // Handle reply click - always clickable
    function handleReplyClick(reply) {
        console.log('Opening thread for reply:', reply.id);
        dispatch('eventSelect', reply.id);
    }

    // Handle keyboard events for accessibility
    function handleKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOriginalEventClick();
        }
    }

    // Format timestamp
    function formatTime(timestamp) {
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diffMs = now - date;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffHours < 1) {
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            return `${diffMinutes}m ago`;
        } else if (diffHours < 24) {
            return `${diffHours}h ago`;
        } else if (diffDays < 7) {
            return `${diffDays}d ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    onMount(() => {
        if (eventId) {
            fetchOriginalEvent();
            fetchReplies();
        }
    });

    // React to eventId changes
    $: if (eventId) {
        console.log('ReplyThread: eventId changed to:', eventId);
        // Reset state for new thread
        originalEvent = null;
        replies = [];
        isLoading = false;
        
        // Clean up previous subscription
        if (subscriptionId) {
            nostrClient.unsubscribe(subscriptionId);
            subscriptionId = null;
        }
        
        // Fetch new thread
        fetchOriginalEvent();
        fetchReplies();
    }

    onDestroy(() => {
        if (subscriptionId) {
            nostrClient.unsubscribe(subscriptionId);
        }
    });
</script>

<div class="reply-thread">
    <div class="thread-header">
        <h3>{originalEvent && originalEvent.tags?.some(tag => tag[0] === 'e' && tag[3] === 'reply') ? 'Reply Thread' : 'Thread'}</h3>
        <button class="close-btn" on:click={onClose}>✕</button>
    </div>
    
    <div class="thread-content">
        {#if isLoading && !originalEvent}
            <div class="loading">Loading thread...</div>
        {:else if originalEvent}
            <!-- Original event at the top -->
            {#if isReply(originalEvent)}
                <button class="original-event clickable" on:click={handleOriginalEventClick}>
                    <div class="event-header">
                        <span class="event-author">{originalEvent.pubkey.slice(0, 8)}...</span>
                        <span class="event-time">{formatTime(originalEvent.created_at)}</span>
                        <span class="reply-indicator">↩</span>
                    </div>
                    <div class="event-content">
                        {originalEvent.content}
                    </div>
                </button>
            {:else}
                <div class="original-event">
                    <div class="event-header">
                        <span class="event-author">{originalEvent.pubkey.slice(0, 8)}...</span>
                        <span class="event-time">{formatTime(originalEvent.created_at)}</span>
                        <span class="root-indicator">root</span>
                    </div>
                    <div class="event-content">
                        {originalEvent.content}
                    </div>
                </div>
            {/if}
            
            <!-- Replies -->
            {#if replies.length > 0}
                <div class="replies-section">
                    <h4>Replies ({replies.length})</h4>
                    {#each replies as reply (reply.id)}
                        <button class="reply-event clickable" on:click={() => handleReplyClick(reply)}>
                            <div class="event-header">
                                <span class="event-author">{reply.pubkey.slice(0, 8)}...</span>
                                <span class="event-time">{formatTime(reply.created_at)}</span>
                                <span class="thread-indicator">💬</span>
                            </div>
                            <div class="event-content">
                                {reply.content}
                            </div>
                        </button>
                    {/each}
                </div>
            {:else}
                <div class="no-replies">No replies yet</div>
            {/if}
        {:else}
            <div class="error">Event not found</div>
        {/if}
    </div>
</div>

<style>
    .reply-thread {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background-color: var(--bg-color);
        border-left: 1px solid var(--border-color);
        width: 32em;
        max-width: 32em;
        min-width: 0;
        flex-shrink: 1;
        flex-grow: 0;
    }

    .thread-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0;
        border-bottom: 1px solid var(--border-color);
        background-color: var(--header-bg);
        height: 2em;
    }

    .thread-header h3 {
        margin: 0;
        color: var(--text-color);
        font-size: 1em;
        font-weight: 600;
        padding-left:1em;
    }

    .close-btn {
        background: none;
        border: none;
        font-size: 1.2em;
        cursor: pointer;
        color: var(--text-color);
        padding: 0;
        transition: background-color 0.2s;
        align-items: center;
        width:2em;
        height: 2em;
    }

    .close-btn:hover {
        background: var(--button-hover-bg);
    }

    .thread-content {
        flex: 1;
        overflow-y: auto;
        padding: 1rem 1.5rem;
    }

    .loading, .error, .no-replies {
        text-align: center;
        padding: 2rem;
        color: var(--text-color);
        opacity: 0.7;
    }

    .original-event {
        background-color: var(--button-hover-bg);
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 1rem;
        border-left: 3px solid var(--primary);
    }

    .original-event.clickable {
        cursor: pointer;
        transition: background-color 0.2s;
        border: none;
        width: 100%;
        text-align: left;
        font-family: inherit;
        font-size: inherit;
    }

    .original-event.clickable:hover {
        background-color: var(--button-hover-bg);
        opacity: 0.8;
    }

    .replies-section {
        margin-top: 1rem;
    }

    .replies-section h4 {
        margin: 0 0 1rem 0;
        color: var(--text-color);
        font-size: 1rem;
        font-weight: 600;
    }

    .reply-event {
        border-bottom: 1px solid var(--border-color);
        padding: 1rem 0;
    }

    .reply-event:last-child {
        border-bottom: none;
    }

    .reply-event.clickable {
        cursor: pointer;
        transition: background-color 0.2s;
        border: none;
        width: 100%;
        text-align: left;
        font-family: inherit;
        font-size: inherit;
        background: none;
        padding: 1rem 0;
    }

    .reply-event.clickable:hover {
        background-color: var(--button-hover-bg);
        opacity: 0.8;
    }

    .event-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
        font-size: 0.9rem;
        opacity: 0.7;
    }

    .event-author {
        font-family: monospace;
        color: var(--primary);
    }

    .event-time {
        color: var(--text-color);
    }

    .reply-indicator {
        color: var(--primary);
        font-size: 0.9rem;
        margin-left: 0.5rem;
    }

    .root-indicator {
        color: var(--primary);
        font-size: 0.8rem;
        margin-left: 0.5rem;
        font-weight: 600;
        text-transform: uppercase;
        opacity: 0.8;
    }

    .thread-indicator {
        color: var(--text-color);
        font-size: 0.9rem;
        margin-left: 0.5rem;
    }

    .event-content {
        line-height: 1.5;
        word-wrap: break-word;
        white-space: pre-wrap;
        color: var(--text-color);
    }

    /* Custom scrollbar styling */
    .thread-content::-webkit-scrollbar {
        width: 8px;
    }

    .thread-content::-webkit-scrollbar-track {
        background: var(--button-hover-bg);
        border-radius: 4px;
    }

    .thread-content::-webkit-scrollbar-thumb {
        background: var(--border-color);
        border-radius: 4px;
    }

    .thread-content::-webkit-scrollbar-thumb:hover {
        background: var(--text-color);
    }

    /* Firefox scrollbar styling */
    .thread-content {
        scrollbar-width: thin;
        scrollbar-color: var(--border-color) var(--button-hover-bg);
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
        .reply-thread {
            width: 28em;
            max-width: 28em;
        }
    }

    @media (max-width: 480px) {
        .reply-thread {
            width: 24em;
            max-width: 24em;
        }
    }
</style>
