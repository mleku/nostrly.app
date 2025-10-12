<script>
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import { nostrClient } from './nostr.js';

    export let feedFilter = 'notes';

    const dispatch = createEventDispatcher();

    let events = [];
    let isLoading = false;
    let hasMore = true;
    let oldestEventTime = null;
    let subscriptionId = null;
    let loadingMore = false;
    let feedContainer = null;
    let hasLoadedOnce = false;
    let eventIds = new Set(); // For efficient deduplication
    let pendingEvents = []; // Batch events before sorting
    let sortTimeout = null;

    // Check if event timestamp is in the future
    function isFutureEvent(event) {
        if (!event || !event.created_at) return false;
        const now = Math.floor(Date.now() / 1000); // Current time in seconds
        return event.created_at > now;
    }

    // Add event with proper deduplication and sorting
    function addEvent(event) {
        if (!event || event.kind !== 1 || !event.id) return false;
        
        // Skip events with future timestamps
        if (isFutureEvent(event)) {
            console.log('Skipping future event:', event.id, 'timestamp:', event.created_at);
            return false;
        }
        
        // Check if we already have this event
        if (eventIds.has(event.id)) {
            return false;
        }
        
        // Add to pending events
        pendingEvents.push(event);
        eventIds.add(event.id);
        
        // Schedule sorting (debounced)
        if (sortTimeout) {
            clearTimeout(sortTimeout);
        }
        sortTimeout = setTimeout(() => {
            processPendingEvents();
        }, 100); // 100ms debounce
        
        return true;
    }

    // Process pending events and sort them
    function processPendingEvents() {
        if (pendingEvents.length === 0) return;
        
        // Add pending events to main events array
        events = [...events, ...pendingEvents];
        pendingEvents = [];
        
        // Filter out any future events that might have slipped through
        const now = Math.floor(Date.now() / 1000);
        events = events.filter(event => {
            if (isFutureEvent(event)) {
                console.log('Removing future event from display:', event.id, 'timestamp:', event.created_at);
                eventIds.delete(event.id); // Remove from tracking set too
                return false;
            }
            return true;
        });
        
        // Sort events by created_at in reverse chronological order (newest first)
        events.sort((a, b) => {
            const timeA = a.created_at || 0;
            const timeB = b.created_at || 0;
            if (timeA !== timeB) {
                return timeB - timeA; // Reverse chronological order
            }
            // If timestamps are equal, sort by id for stability
            return a.id.localeCompare(b.id);
        });
        
        // Update oldest event time
        if (events.length > 0) {
            oldestEventTime = Math.min(...events.map(e => e.created_at || 0));
        }
        
        // Trigger reactivity
        events = [...events];
    }

    // Load initial events
    async function loadEvents() {
        if (isLoading) return;
        
        isLoading = true;
        events = [];
        eventIds.clear();
        pendingEvents = [];
        if (sortTimeout) {
            clearTimeout(sortTimeout);
            sortTimeout = null;
        }
        oldestEventTime = null;
        hasMore = true;

        try {
            console.log('Loading initial events...');
            console.log('Nostr client relays:', nostrClient.relays.size);
            
            // Wait a bit for connections to be ready
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            subscriptionId = nostrClient.subscribe(
                { kinds: [1], limit: 50 }, // Text notes only, limit initial load
                (event) => {
                    console.log('Received event:', event);
                    if (addEvent(event)) {
                        console.log(`Loaded ${events.length} events`);
                    }
                }
            );
            
            // Set a timeout to mark initial load as complete
            setTimeout(() => {
                if (!hasLoadedOnce) {
                    hasLoadedOnce = true;
                    isLoading = false;
                    console.log('Initial load completed');
                }
            }, 5000); // Reduced timeout for faster initial load completion
            
        } catch (error) {
            console.error('Failed to load events:', error);
        } finally {
            // Don't set isLoading to false immediately, let the timeout handle it
        }
    }

    // Load more events (for infinite scroll)
    async function loadMoreEvents() {
        if (loadingMore || !hasMore || !oldestEventTime || !hasLoadedOnce) return;
        
        loadingMore = true;
        console.log('Loading more events...');
        
        let eventsLoaded = 0;
        
        try {
            const moreSubscriptionId = nostrClient.subscribe(
                { 
                    kinds: [1],
                    until: oldestEventTime - 1, // Get events older than the oldest we have
                    limit: 20 // Limit each batch
                },
                (event) => {
                    if (addEvent(event)) {
                        eventsLoaded++;
                        console.log(`Total events: ${events.length}`);
                    }
                }
            );
            
            // Close the subscription after a delay
            setTimeout(() => {
                nostrClient.unsubscribe(moreSubscriptionId);
                loadingMore = false;
                
                // If no events were loaded, we've reached the end
                if (eventsLoaded === 0) {
                    hasMore = false;
                    console.log('No more events to load');
                }
            }, 3000);
            
        } catch (error) {
            console.error('Failed to load more events:', error);
            loadingMore = false;
        }
    }

    // Handle scroll to detect when to load more
    function handleScroll(event) {
        const { scrollTop, scrollHeight, clientHeight } = event.target;
        
        // Calculate how many events are visible and loaded
        const eventHeight = 80; // Approximate height of each event
        const visibleEvents = Math.ceil(clientHeight / eventHeight);
        const loadedEvents = events.length;
        
        // Load more when within 10 events of the end
        const eventsFromEnd = loadedEvents - visibleEvents - Math.floor(scrollTop / eventHeight);
        
        if (eventsFromEnd <= 10 && hasMore && !loadingMore && hasLoadedOnce) {
            console.log('Scroll triggered load more - within 10 events of end');
            loadMoreEvents();
        }
    }

    // Check if event is a reply (has 'e' tag with 'reply' in 4th position)
    function isReply(event) {
        if (!event.tags) return false;
        return event.tags.some(tag => 
            tag[0] === 'e' && tag[3] === 'reply'
        );
    }

    // Filter events based on current feed filter
    function filterEvents(events) {
        if (feedFilter === 'replies') {
            return events.filter(event => isReply(event));
        } else if (feedFilter === 'notes') {
            return events.filter(event => !isReply(event));
        } else if (feedFilter === 'reposts') {
            // For now, reposts are not implemented, show all events
            return events;
        }
        return events;
    }

    // Get the replied-to event ID
    function getReplyToEventId(event) {
        if (!event.tags) return null;
        const replyTag = event.tags.find(tag => 
            tag[0] === 'e' && tag[3] === 'reply'
        );
        return replyTag ? replyTag[1] : null;
    }

    // Handle event click
    function handleEventClick(event) {
        if (isReply(event)) {
            const replyToId = getReplyToEventId(event);
            if (replyToId) {
                console.log('Opening reply thread for event:', replyToId);
                dispatch('eventSelect', replyToId);
            }
        } else {
            // For non-reply events, open a thread view with this event as the root
            console.log('Opening thread view for event:', event.id);
            dispatch('eventSelect', event.id);
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

    // Handle reload event from parent
    async function handleReload() {
        console.log('Reload triggered');
        // Wait for Nostr client to be ready
        let attempts = 0;
        while (nostrClient.relays.size === 0 && attempts < 5) {
            await new Promise(resolve => setTimeout(resolve, 200));
            attempts++;
        }

        if (nostrClient.relays.size > 0) {
            // Reset all state for fresh loading
            hasLoadedOnce = false;
            hasMore = true;
            loadingMore = false;
            events = [];
            eventIds.clear();
            pendingEvents = [];
            oldestEventTime = null;
            
            if (subscriptionId) {
                nostrClient.unsubscribe(subscriptionId);
                subscriptionId = null;
            }
            
            if (sortTimeout) {
                clearTimeout(sortTimeout);
                sortTimeout = null;
            }
            
            loadEvents();
        } else {
            console.error('Nostr client not ready for reload');
        }
    }

    // React to filter changes
    $: if (feedFilter) {
        console.log('Feed filter changed to:', feedFilter);
        // Reset loaded state to allow reloading with new filter
        hasLoadedOnce = false;
        if (nostrClient.relays.size > 0) {
            loadEvents();
        }
    }

    onMount(async () => {
        // Only load if we haven't loaded once before
        if (!hasLoadedOnce) {
            // Wait for Nostr client to be initialized
            let attempts = 0;
            while (nostrClient.relays.size === 0 && attempts < 10) {
                console.log('Waiting for Nostr client initialization...', attempts);
                await new Promise(resolve => setTimeout(resolve, 500));
                attempts++;
            }
            
            if (nostrClient.relays.size > 0) {
                console.log('Nostr client ready, loading events...');
                loadEvents();
            } else {
                console.error('Nostr client not initialized after waiting');
            }
        } else {
            console.log('Feed already loaded once, skipping initial load');
        }
        
        // Listen for reload events
        document.addEventListener('reload', handleReload);
    });

    onDestroy(() => {
        if (subscriptionId) {
            nostrClient.unsubscribe(subscriptionId);
        }
        if (sortTimeout) {
            clearTimeout(sortTimeout);
        }
        document.removeEventListener('reload', handleReload);
    });
</script>

<div class="nostr-feed" bind:this={feedContainer} on:scroll={handleScroll}>
    {#if isLoading && events.length === 0}
        <div class="loading">Loading feed...</div>
    {:else if filterEvents(events).length === 0}
        <div class="empty-feed">
            {#if feedFilter === 'replies'}
                No replies found
            {:else if feedFilter === 'notes'}
                No notes found
            {:else if feedFilter === 'reposts'}
                No reposts found
            {:else}
                No events found
            {/if}
        </div>
    {:else}
        {#each filterEvents(events) as event (event.id)}
            <button class="event-card" 
                    class:reply={isReply(event)}
                    class:clickable={true}
                    on:click={() => handleEventClick(event)}>
                <div class="event-header">
                    <span class="event-author">{event.pubkey.slice(0, 8)}...</span>
                    <span class="event-time">{formatTime(event.created_at)}</span>
                    {#if isReply(event)}
                        <span class="reply-indicator">↩</span>
                    {:else}
                        <span class="thread-indicator">💬</span>
                    {/if}
                </div>
                <div class="event-content">
                    {event.content}
                </div>
            </button>
        {/each}
        
        {#if loadingMore}
            <div class="loading-more">Loading more...</div>
        {/if}
    {/if}
</div>

<style>
    .nostr-feed {
        height: 100%;
        overflow-y: auto;
        padding: 0;
    }

    .loading, .empty-feed, .loading-more {
        text-align: center;
        padding: 2rem;
        color: var(--text-color);
        opacity: 0.7;
    }

    .event-card {
        border-bottom: 1px solid var(--border-color);
        padding: 1rem;
        transition: background-color 0.2s;
        background: none;
        border-left: none;
        border-right: none;
        border-top: none;
        width: 100%;
        text-align: left;
        font-family: inherit;
        font-size: inherit;
    }

    .event-card.clickable {
        cursor: pointer;
    }

    .event-card.clickable:hover {
        background-color: var(--button-hover-bg);
    }

    .event-card:not(.clickable):hover {
        background-color: transparent;
    }

    .event-card:last-child {
        border-bottom: none;
    }

    .event-card.reply {
        padding-left: calc(1rem - 3px);
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

    .thread-indicator {
        color: var(--text-color);
        font-size: 0.9rem;
        margin-left: 0.5rem;
        opacity: 0.7;
    }

    .event-content {
        line-height: 1.5;
        word-wrap: break-word;
        white-space: pre-wrap;
        color: var(--text-color);
    }

    /* Custom scrollbar styling */
    .nostr-feed::-webkit-scrollbar {
        width: 8px;
    }

    .nostr-feed::-webkit-scrollbar-track {
        background: var(--button-hover-bg);
        border-radius: 4px;
    }

    .nostr-feed::-webkit-scrollbar-thumb {
        background: var(--border-color);
        border-radius: 4px;
    }

    .nostr-feed::-webkit-scrollbar-thumb:hover {
        background: var(--text-color);
    }

    /* Firefox scrollbar styling */
    .nostr-feed {
        scrollbar-width: thin;
        scrollbar-color: var(--border-color) var(--button-hover-bg);
    }
</style>
