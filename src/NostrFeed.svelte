<script>
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import { nostrClient } from './nostr.js';
    import { getUserProfile, getCachedUserProfile, loadUserProfiles } from './profileManager.js';
    import NostrProfileLink from './NostrProfileLink.svelte';
    import InlineNote from './InlineNote.svelte';

    export let feedFilter = 'replies';

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
    let autoUpdateEnabled = true; // Controls whether new events auto-update the feed
    let newEventsCount = 0; // Count of new events received while auto-update is disabled
    let queuedNewEvents = []; // Store new events received while auto-update is disabled
    // Remove local userProfiles cache - using global profileManager instead

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
            return false;
        }
        
        // Check if we already have this event
        if (eventIds.has(event.id)) {
            return false;
        }
        
        // Track the event
        eventIds.add(event.id);
        
        // If auto-update is enabled, add to pending events for immediate processing
        if (autoUpdateEnabled) {
            pendingEvents.push(event);
            
            // Schedule sorting (debounced)
            if (sortTimeout) {
                clearTimeout(sortTimeout);
            }
            sortTimeout = setTimeout(() => {
                processPendingEvents();
            }, 100); // 100ms debounce
        } else {
            // If auto-update is disabled, queue the event for later processing
            queuedNewEvents.push(event);
            newEventsCount++;
            // Dispatch event to parent to show "load new events" button
            dispatch('newEventsAvailable', { count: newEventsCount });
        }
        
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
        queuedNewEvents = []; // Clear queued events
        if (sortTimeout) {
            clearTimeout(sortTimeout);
            sortTimeout = null;
        }
        oldestEventTime = null;
        hasMore = true;

        try {
            // Wait a bit for connections to be ready
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Only fetch text notes (kind 1) for replies
            let kinds = [1];
            
            subscriptionId = nostrClient.subscribe(
                { kinds: kinds, limit: 50 }, // Dynamic kinds based on filter
                (event) => {
                    if (addEvent(event)) {
                        // Event added successfully
                    }
                }
            );
            
            // Set a timeout to mark initial load as complete
            setTimeout(() => {
                if (!hasLoadedOnce) {
                    hasLoadedOnce = true;
                    isLoading = false;
                    autoUpdateEnabled = false; // Disable auto-updates after initial load
                }
            }, 5000); // Reduced timeout for faster initial load completion
            
        } catch (error) {
            // Failed to load events
        } finally {
            // Don't set isLoading to false immediately, let the timeout handle it
        }
    }

    // Load more events (for infinite scroll)
    async function loadMoreEvents() {
        if (loadingMore || !hasMore || !oldestEventTime || !hasLoadedOnce) return;
        
        loadingMore = true;
        
        let eventsLoaded = 0;
        
        try {
            // Only fetch text notes (kind 1) for replies
            let kinds = [1];
            
            const moreSubscriptionId = nostrClient.subscribe(
                { 
                    kinds: kinds,
                    until: oldestEventTime - 1, // Get events older than the oldest we have
                    limit: 20 // Limit each batch
                },
                (event) => {
                    if (addEvent(event)) {
                        eventsLoaded++;
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
                }
            }, 3000);
            
        } catch (error) {
            loadingMore = false;
        }
    }

    // Handle scroll to detect when to load more
    function handleScroll(event) {
        const { scrollTop, scrollHeight, clientHeight } = event.target;
        
        // Calculate how many events are visible and loaded
        const eventHeight = 80; // Approximate height of each event
        const visibleEvents = Math.ceil(clientHeight / eventHeight);
        const filteredEvents = filterEvents(events);
        const loadedEvents = filteredEvents.length;
        
        // Load more when within 3 events of the end (reduced from 10 for better UX)
        const eventsFromEnd = loadedEvents - visibleEvents - Math.floor(scrollTop / eventHeight);
        
        if (eventsFromEnd <= 3 && hasMore && !loadingMore && hasLoadedOnce) {
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
        // Only show replies
        return events.filter(event => isReply(event));
    }

    // Get the replied-to event ID
    function getReplyToEventId(event) {
        if (!event.tags) return null;
        const replyTag = event.tags.find(tag => 
            tag[0] === 'e' && tag[3] === 'reply'
        );
        return replyTag ? replyTag[1] : null;
    }

    // Parse embedded event from kind 6 repost
    function parseRepostedEvent(repostEvent) {
        try {
            if (repostEvent.kind !== 6) return null;
            
            // Kind 6 events contain the original event in the content field as JSON
            const originalEvent = JSON.parse(repostEvent.content);
            
            // Validate that it's a proper event object
            if (originalEvent && typeof originalEvent === 'object' && 
                originalEvent.id && originalEvent.pubkey && originalEvent.content !== undefined) {
                return originalEvent;
            }
        } catch (error) {
            // Failed to parse reposted event
        }
        return null;
    }

    // Handle event click
    function handleEventClick(event) {
        if (isReply(event)) {
            const replyToId = getReplyToEventId(event);
            if (replyToId) {
                dispatch('eventSelect', replyToId);
            }
        } else {
            // For non-reply events, open a thread view with this event as the root
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

    // Check if URL is a media file
    function isMediaUrl(url) {
        const mediaExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mp3', 'wav', 'ogg', 'm4a'];
        const urlLower = url.toLowerCase();
        return mediaExtensions.some(ext => urlLower.includes(`.${ext}`));
    }

    // Check if URL is a nostr link
    function isNostrUrl(url) {
        return url.startsWith('nostr:nprofile') || url.startsWith('nostr:npub') || url.startsWith('nostr:nevent') || url.startsWith('nostr:note');
    }

    // Check if URL is a nostr note link
    function isNostrNoteUrl(url) {
        return url.startsWith('nostr:note');
    }

    // Extract pubkey from nostr URL
    function extractPubkeyFromNostrUrl(url) {
        if (url.startsWith('nostr:npub')) {
            // Extract npub from nostr:npub1...
            const npub = url.replace('nostr:npub', '');
            // For now, we'll need to decode the npub to get the pubkey
            // This is a simplified approach - in a real implementation you'd use proper bech32 decoding
            return npub; // We'll use the npub directly for now
        } else if (url.startsWith('nostr:nprofile')) {
            // Extract nprofile from nostr:nprofile1...
            const nprofile = url.replace('nostr:nprofile', '');
            return nprofile; // We'll use the nprofile directly for now
        }
        return null;
    }

    // Extract URLs from text content
    function extractUrls(text) {
        // Match nostr: links surrounded by whitespace or at start/end of text
        const urlRegex = /(https?:\/\/[^\s]+|nostr:(?:nprofile|npub|nevent|note)1[a-z0-9]+)/g;
        return text.match(urlRegex) || [];
    }

    // Render content with media blocks and linkify URLs
    function renderContentWithMedia(content) {
        const urls = extractUrls(content);
        let renderedContent = content;
        
        urls.forEach(url => {
            if (isMediaUrl(url)) {
                const mediaBlock = createMediaBlock(url);
                renderedContent = renderedContent.replace(url, mediaBlock);
            } else if (isNostrUrl(url)) {
                // Replace nostr links with placeholder - will be replaced by components
                const placeholder = `__NOSTR_LINK_${Math.random().toString(36).substring(7)}__`;
                renderedContent = renderedContent.replace(url, placeholder);
            } else {
                // Linkify non-media URLs
                const linkHtml = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="content-link">${url}</a>`;
                renderedContent = renderedContent.replace(url, linkHtml);
            }
        });
        
        return renderedContent;
    }

    // Create media block HTML
    function createMediaBlock(url) {
        const urlLower = url.toLowerCase();
        
        if (urlLower.includes('.mp4') || urlLower.includes('.webm')) {
            return `<div class="media-block video-block"><video controls><source src="${url}" type="video/mp4">Your browser does not support the video tag.</video></div>`;
        } else if (urlLower.includes('.mp3') || urlLower.includes('.wav') || urlLower.includes('.ogg') || urlLower.includes('.m4a')) {
            return `<div class="media-block audio-block"><audio controls><source src="${url}" type="audio/mpeg">Your browser does not support the audio tag.</audio></div>`;
        } else if (urlLower.includes('.jpg') || urlLower.includes('.jpeg') || urlLower.includes('.png') || urlLower.includes('.gif') || urlLower.includes('.webp') || urlLower.includes('.svg')) {
            return `<div class="media-block image-block"><img src="${url}" alt="Media content" loading="lazy" /></div>`;
        }
        
        return url; // Return original URL if not recognized media type
    }

    // Create nostr profile link HTML
    function createNostrProfileLink(url) {
        const identifier = extractPubkeyFromNostrUrl(url);
        if (!identifier) return url;

        // Return a placeholder that will be replaced by Svelte components
        return `__NOSTR_LINK_PLACEHOLDER_${url}__`;
    }

    // Extract nostr links from content for component rendering
    function extractNostrLinks(content) {
        const urls = extractUrls(content);
        return urls.filter(url => isNostrUrl(url));
    }

    // Split content into segments for rendering nostr links as components
    function splitContentForNostrLinks(content) {
        const urls = extractUrls(content);
        const nostrUrls = urls.filter(url => isNostrUrl(url));
        
        if (nostrUrls.length === 0) {
            return [{ type: 'html', content: renderContentWithMedia(content) }];
        }
        
        let segments = [];
        let remainingContent = content;
        
        // Sort nostr URLs by their position in the content to process them in order
        const sortedNostrUrls = nostrUrls.sort((a, b) => {
            const indexA = remainingContent.indexOf(a);
            const indexB = remainingContent.indexOf(b);
            return indexA - indexB;
        });
        
        sortedNostrUrls.forEach(url => {
            const urlIndex = remainingContent.indexOf(url);
            if (urlIndex !== -1) {
                // Add text before the nostr link
                if (urlIndex > 0) {
                    const beforeText = remainingContent.substring(0, urlIndex);
                    segments.push({ type: 'html', content: renderContentWithMedia(beforeText) });
                }
                
                // Add the nostr link as a component
                if (isNostrNoteUrl(url)) {
                    segments.push({ type: 'note', url: url });
                } else {
                    segments.push({ type: 'nostr', url: url });
                }
                
                // Update remaining content
                remainingContent = remainingContent.substring(urlIndex + url.length);
            }
        });
        
        // Add any remaining content
        if (remainingContent.length > 0) {
            segments.push({ type: 'html', content: renderContentWithMedia(remainingContent) });
        }
        
        return segments;
    }

    // Fetch profiles for all unique pubkeys in events using global profile manager
    async function fetchAllUserProfiles() {
        const uniquePubkeys = new Set();
        events.forEach(event => {
            if (event.pubkey) {
                uniquePubkeys.add(event.pubkey);
            }
        });

        if (uniquePubkeys.size > 0) {
            await loadUserProfiles(Array.from(uniquePubkeys));
        }
    }

    // Handle reload event from parent
    async function handleReload() {
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
            autoUpdateEnabled = true; // Re-enable auto-updates for reload
            newEventsCount = 0; // Reset new events counter
            queuedNewEvents = []; // Clear queued events
            
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
            // Nostr client not ready for reload
        }
    }

    // Handle loading new events when auto-update is disabled
    function handleLoadNewEvents() {
        if (queuedNewEvents.length > 0) {
            // Add queued events to the pending events for processing
            pendingEvents.push(...queuedNewEvents);
            queuedNewEvents = []; // Clear the queue
            
            // Process the pending events immediately
            processPendingEvents();
            
            // Scroll to top to show new events
            if (feedContainer) {
                feedContainer.scrollTop = 0;
            }
        }
        
        // Reset counter
        newEventsCount = 0;
        
        // Temporarily enable auto-updates for a brief period to catch any new events
        autoUpdateEnabled = true;
        setTimeout(() => {
            autoUpdateEnabled = false; // Disable auto-updates again
        }, 2000); // Give a longer window for new events to be processed
    }

    // React to filter changes
    $: if (feedFilter) {
        // Reset loaded state to allow reloading with new filter
        hasLoadedOnce = false;
        if (nostrClient.relays.size > 0) {
            loadEvents();
        }
    }

    // React to events changes to fetch user profiles
    $: if (events.length > 0) {
        fetchAllUserProfiles();
    }

    // Reactive statement to load more events when filtered results are low
    $: if (hasLoadedOnce && !loadingMore && hasMore) {
        const filteredEvents = filterEvents(events);
        const minEventsForFilter = feedFilter === 'replies' ? 20 : 10; // Replies need more events due to filtering
        
        if (filteredEvents.length < minEventsForFilter) {
            loadMoreEvents();
        }
    }

    // Reactive statement to reload when filtered events are empty
    $: if (hasLoadedOnce && !isLoading) {
        const filteredEvents = filterEvents(events);
        if (filteredEvents.length === 0 && events.length > 0) {
            // Reset loaded state to allow reloading
            hasLoadedOnce = false;
            if (nostrClient.relays.size > 0) {
                loadEvents();
            }
        }
    }

    onMount(async () => {
        // Only load if we haven't loaded once before
        if (!hasLoadedOnce) {
            // Wait for Nostr client to be initialized
            let attempts = 0;
            while (nostrClient.relays.size === 0 && attempts < 10) {
                await new Promise(resolve => setTimeout(resolve, 500));
                attempts++;
            }
            
            if (nostrClient.relays.size > 0) {
                loadEvents();
            } else {
                // Nostr client not initialized after waiting
            }
        } else {
            // Feed already loaded once, skipping initial load
        }
        
        // Listen for reload events
        document.addEventListener('reload', handleReload);
        
        // Listen for load new events events
        document.addEventListener('loadNewEvents', handleLoadNewEvents);
    });

    onDestroy(() => {
        if (subscriptionId) {
            nostrClient.unsubscribe(subscriptionId);
        }
        if (sortTimeout) {
            clearTimeout(sortTimeout);
        }
        document.removeEventListener('reload', handleReload);
        document.removeEventListener('loadNewEvents', handleLoadNewEvents);
    });
</script>

<div class="nostr-feed" bind:this={feedContainer} on:scroll={handleScroll}>
    {#if isLoading && events.length === 0}
        <div class="loading">Loading feed...</div>
    {:else if filterEvents(events).length === 0}
        <div class="empty-feed">
            No replies found
        </div>
    {:else}
        {#each filterEvents(events) as event (event.id)}
            {#if event.kind === 6}
                <!-- Repost Event -->
                {@const repostedEvent = parseRepostedEvent(event)}
                <button class="event-card repost-card" 
                        class:clickable={true}
                        on:click={() => handleEventClick(repostedEvent || event)}>
                    <div class="repost-header">
                        <div class="repost-author">
                            {#if getCachedUserProfile(event.pubkey)}
                                {@const profile = getCachedUserProfile(event.pubkey)}
                                <div class="author-info">
                                    {#if profile.picture}
                                        <img src={profile.picture} alt="Avatar" class="avatar" />
                                    {:else}
                                        <div class="avatar-placeholder"></div>
                                    {/if}
                                    <span class="username">{profile.name || profile.display_name || event.pubkey.slice(0, 8) + '...'}</span>
                                </div>
                            {:else}
                                <span class="pubkey-fallback">{event.pubkey.slice(0, 8)}...</span>
                            {/if}
                        </div>
                        <span class="repost-indicator">🔄 Reposted</span>
                        <span class="event-time">{formatTime(event.created_at)}</span>
                    </div>
                    {#if repostedEvent}
                        <div class="reposted-content">
                            <div class="reposted-header">
                                <div class="reposted-author">
                                    {#if getCachedUserProfile(repostedEvent.pubkey)}
                                        {@const originalProfile = getCachedUserProfile(repostedEvent.pubkey)}
                                        <div class="author-info">
                                            {#if originalProfile.picture}
                                                <img src={originalProfile.picture} alt="Avatar" class="avatar" />
                                            {:else}
                                                <div class="avatar-placeholder"></div>
                                            {/if}
                                            <span class="username">{originalProfile.name || originalProfile.display_name || repostedEvent.pubkey.slice(0, 8) + '...'}</span>
                                        </div>
                                    {:else}
                                        <span class="pubkey-fallback">{repostedEvent.pubkey.slice(0, 8)}...</span>
                                    {/if}
                                </div>
                                <span class="event-time">{formatTime(repostedEvent.created_at)}</span>
                            </div>
                            <div class="event-content">
                                {#each splitContentForNostrLinks(repostedEvent.content) as segment}
                                    {#if segment.type === 'html'}
                                        {@html segment.content}
                                    {:else if segment.type === 'nostr'}
                                        <NostrProfileLink url={segment.url} />
                                    {:else if segment.type === 'note'}
                                        <InlineNote url={segment.url} on:eventSelect={(e) => dispatch('eventSelect', e.detail)} />
                                    {/if}
                                {/each}
                            </div>
                        </div>
                    {:else}
                        <div class="event-content error">
                            Failed to parse reposted event
                        </div>
                    {/if}
                </button>
            {:else}
                <!-- Regular Event -->
                <button class="event-card" 
                        class:reply={isReply(event)}
                        class:clickable={true}
                        on:click={() => handleEventClick(event)}>
                    <div class="event-header">
                        <div class="event-author">
                            {#if getCachedUserProfile(event.pubkey)}
                                {@const profile = getCachedUserProfile(event.pubkey)}
                                <div class="author-info">
                                    {#if profile.picture}
                                        <img src={profile.picture} alt="Avatar" class="avatar" />
                                    {:else}
                                        <div class="avatar-placeholder"></div>
                                    {/if}
                                    <span class="username">{profile.name || profile.display_name || event.pubkey.slice(0, 8) + '...'}</span>
                                    <span class="event-time">{formatTime(event.created_at)}</span>
                                </div>
                            {:else}
                                <span class="pubkey-fallback">{event.pubkey.slice(0, 8)}...</span>
                                <span class="event-time">{formatTime(event.created_at)}</span>
                            {/if}
                        </div>
                        {#if isReply(event)}
                            <span class="reply-indicator">↩</span>
                        {:else}
                            <span class="thread-indicator">💬</span>
                        {/if}
                    </div>
                    <div class="event-content">
                        {#each splitContentForNostrLinks(event.content) as segment}
                            {#if segment.type === 'html'}
                                {@html segment.content}
                            {:else if segment.type === 'nostr'}
                                <NostrProfileLink url={segment.url} />
                            {:else if segment.type === 'note'}
                                <InlineNote url={segment.url} on:eventSelect={(e) => dispatch('eventSelect', e.detail)} />
                            {/if}
                        {/each}
                    </div>
                </button>
            {/if}
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
        padding-right: 1em;
    }

    .loading, .empty-feed, .loading-more {
        text-align: center;
        padding: 2rem;
        color: var(--text-color);
        opacity: 0.7;
    }

    .event-card {
        border:none;
        padding: 0;
        padding-bottom: 0.5em;
        padding-top: 0.5em;
        transition: background-color 0.2s;
        background: none;
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

    .event-card.repost-card {
        border-left: 3px solid var(--primary-color);
        background-color: var(--card-bg, rgba(0, 0, 0, 0.02));
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

    .author-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        object-fit: cover;
        border: 1px solid var(--border-color);
    }

    .avatar-placeholder {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background-color: var(--primary);
        opacity: 0.3;
        border: 1px solid var(--border-color);
    }

    .username {
        font-family: "Noto Sans", sans-serif;
        font-weight: 900;
        color: var(--text-color);
    }

    .pubkey-fallback {
        font-family: monospace;
        color: var(--primary);
    }

    .event-time {
        color: var(--text-color);
        font-size: 0.8rem;
        opacity: 0.6;
        margin-left: 0.5rem;
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
        word-wrap: break-word;
        white-space: pre-wrap;
        color: var(--text-color);
        padding-left:1em;
        max-width: 30em;
    }

    .repost-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
    }

    .repost-indicator {
        color: var(--primary-color);
        font-size: 0.875rem;
        font-weight: 500;
    }

    .reposted-content {
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        padding: 0.75rem;
        margin-top: 0.5rem;
        background-color: var(--background-color);
    }

    .reposted-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--border-color);
    }

    .reposted-content .event-content {
        padding-left: 0;
        margin-top: 0;
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
