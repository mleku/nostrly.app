<script>
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import { nostrClient } from './nostr.js';
    import { getCachedUserProfile, loadUserProfiles } from './profileManager.js';

    export let eventId = '';
    export let onClose = () => {};

    const dispatch = createEventDispatcher();

    let originalEvent = null;
    let replies = [];
    let isLoading = false;
    let subscriptionId = null;
    let replyChain = []; // Array of ancestor events in the reply chain
    // Remove local userProfiles cache - using global profileManager instead

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

    // Fetch later replies that reference the same root event
    async function fetchLaterReplies() {
        if (!rootEvent) return;
        
        console.log('Fetching later replies for root event:', rootEvent.id);
        
        try {
            const laterRepliesSubscriptionId = nostrClient.subscribe(
                { 
                    kinds: [1],
                    '#e': [rootEvent.id]
                },
                (event) => {
                    if (event && event.kind === 1) {
                        // Check if this is a reply to the root event
                        const isReplyToRoot = event.tags.some(tag => 
                            tag[0] === 'e' && tag[1] === rootEvent.id && tag[3] === 'reply'
                        );
                        
                        // Exclude events that are already in the main replies or reply chain
                        const isAlreadyIncluded = replies.find(r => r.id === event.id) || 
                                               replyChain.find(r => r.id === event.id) ||
                                               event.id === originalEvent.id;
                        
                        if (isReplyToRoot && !isAlreadyIncluded && !laterReplies.find(r => r.id === event.id)) {
                            laterReplies = [...laterReplies, event].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
                            console.log(`Found ${laterReplies.length} later replies`);
                        }
                    }
                }
            );
            
            // Close subscription after collecting later replies
            setTimeout(() => {
                nostrClient.unsubscribe(laterRepliesSubscriptionId);
            }, 3000);
            
        } catch (error) {
            console.error('Failed to fetch later replies:', error);
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

    // Fetch reply chain (ancestors)
    async function fetchReplyChain() {
        if (!originalEvent || !isReply(originalEvent)) {
            replyChain = [];
            return;
        }

        const chain = [];
        let currentEvent = originalEvent;
        
        // Follow the chain backwards
        while (isReply(currentEvent)) {
            const parentId = getReplyToEventId(currentEvent);
            if (!parentId) break;

            try {
                const parentEvent = await fetchEventById(parentId);
                if (parentEvent) {
                    chain.unshift(parentEvent); // Add to beginning of array
                    currentEvent = parentEvent;
                } else {
                    break;
                }
            } catch (error) {
                console.error('Failed to fetch parent event:', error);
                break;
            }
        }

        replyChain = chain;
    }

    // Fetch a single event by ID
    async function fetchEventById(eventId) {
        return new Promise((resolve) => {
            let found = false;
            const subscriptionId = nostrClient.subscribe(
                { ids: [eventId] },
                (event) => {
                    if (event && event.id === eventId) {
                        found = true;
                        resolve(event);
                    }
                }
            );
            
            // Timeout if no event found
            setTimeout(() => {
                if (!found) {
                    nostrClient.unsubscribe(subscriptionId);
                    resolve(null);
                }
            }, 3000);
        });
    }

    // Handle chain item click
    function handleChainItemClick(event) {
        console.log('Opening thread for chain item:', event.id);
        dispatch('eventSelect', event.id);
    }

    // Toggle previous replies visibility
    function togglePreviousReplies() {
        showPreviousReplies = !showPreviousReplies;
    }

    // Truncate content to first line with ellipsis
    function truncateContent(content) {
        if (!content) return '';
        const firstLine = content.split('\n')[0];
        return firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;
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

    // Check if URL is a media file
    function isMediaUrl(url) {
        const mediaExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mp3', 'wav', 'ogg', 'm4a'];
        const urlLower = url.toLowerCase();
        return mediaExtensions.some(ext => urlLower.includes(`.${ext}`));
    }

    // Extract URLs from text content
    function extractUrls(text) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return text.match(urlRegex) || [];
    }

    // Render content with media blocks
    function renderContentWithMedia(content) {
        const urls = extractUrls(content);
        let renderedContent = content;
        
        urls.forEach(url => {
            if (isMediaUrl(url)) {
                const mediaBlock = createMediaBlock(url);
                renderedContent = renderedContent.replace(url, mediaBlock);
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

    // Fetch profiles for all unique pubkeys in events using global profile manager
    async function fetchAllUserProfiles() {
        const uniquePubkeys = new Set();
        
        if (originalEvent && originalEvent.pubkey) {
            uniquePubkeys.add(originalEvent.pubkey);
        }
        
        replies.forEach(reply => {
            if (reply.pubkey) {
                uniquePubkeys.add(reply.pubkey);
            }
        });
        
        replyChain.forEach(chainEvent => {
            if (chainEvent.pubkey) {
                uniquePubkeys.add(chainEvent.pubkey);
            }
        });

        if (uniquePubkeys.size > 0) {
            await loadUserProfiles(Array.from(uniquePubkeys));
        }
    }

    // Reactive statements
    $: if (originalEvent || replies.length > 0 || replyChain.length > 0) {
        fetchAllUserProfiles();
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
        replyChain = [];
        isLoading = false;
        // Don't reset showPreviousReplies to preserve user's preference
        
        // Clean up previous subscription
        if (subscriptionId) {
            nostrClient.unsubscribe(subscriptionId);
            subscriptionId = null;
        }
        
        // Fetch new thread
        fetchOriginalEvent();
        fetchReplies();
    }

    // React to originalEvent changes to fetch reply chain
    $: if (originalEvent) {
        fetchReplyChain();
    }

    // React to data changes to fetch user profiles
    $: if (originalEvent || replies.length > 0 || replyChain.length > 0) {
        fetchAllUserProfiles();
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
            <!-- Previous replies section -->
            {#if replyChain.length > 0}
                <div class="previous-replies-section">
                    <h4>Previous replies ({replyChain.length})</h4>
                    <div class="previous-replies-list">
                        {#each replyChain as chainEvent (chainEvent.id)}
                            <button class="previous-reply-item" on:click={() => handleChainItemClick(chainEvent)}>
                                <div class="chain-event-header">
                                    <div class="event-author">
                                        {#if getCachedUserProfile(chainEvent.pubkey)}
                                            {@const profile = getCachedUserProfile(chainEvent.pubkey)}
                                            <div class="author-info">
                                                {#if profile.picture}
                                                    <img src={profile.picture} alt="Avatar" class="avatar-small" />
                                                {:else}
                                                    <div class="avatar-placeholder-small"></div>
                                                {/if}
                                                <span class="username-small">{profile.name || profile.display_name || chainEvent.pubkey.slice(0, 8) + '...'}</span>
                                            </div>
                                        {:else}
                                            <span class="pubkey-fallback-small">{chainEvent.pubkey.slice(0, 8)}...</span>
                                        {/if}
                                    </div>
                                    <span class="event-time-small">{formatTime(chainEvent.created_at)}</span>
                                </div>
                                <div class="chain-event-content">
                                    {@html renderContentWithMedia(chainEvent.content)}
                                </div>
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}
            
            <!-- Original event at the top -->
            {#if isReply(originalEvent)}
                <button class="original-event clickable" on:click={handleOriginalEventClick}>
                    <div class="event-header">
                        <div class="event-author">
                            {#if getCachedUserProfile(originalEvent.pubkey)}
                                {@const profile = getCachedUserProfile(originalEvent.pubkey)}
                                <div class="author-info">
                                    {#if profile.picture}
                                        <img src={profile.picture} alt="Avatar" class="avatar" />
                                    {:else}
                                        <div class="avatar-placeholder"></div>
                                    {/if}
                                    <span class="username">{profile.name || profile.display_name || originalEvent.pubkey.slice(0, 8) + '...'}</span>
                                </div>
                            {:else}
                                <span class="pubkey-fallback">{originalEvent.pubkey.slice(0, 8)}...</span>
                            {/if}
                        </div>
                        <span class="event-time">{formatTime(originalEvent.created_at)}</span>
                        <span class="reply-indicator">↩</span>
                    </div>
                    <div class="event-content">
                        {@html renderContentWithMedia(originalEvent.content)}
                    </div>
                </button>
            {:else}
                <div class="original-event">
                    <div class="event-header">
                        <div class="event-author">
                            {#if getCachedUserProfile(originalEvent.pubkey)}
                                {@const profile = getCachedUserProfile(originalEvent.pubkey)}
                                <div class="author-info">
                                    {#if profile.picture}
                                        <img src={profile.picture} alt="Avatar" class="avatar" />
                                    {:else}
                                        <div class="avatar-placeholder"></div>
                                    {/if}
                                    <span class="username">{profile.name || profile.display_name || originalEvent.pubkey.slice(0, 8) + '...'}</span>
                                </div>
                            {:else}
                                <span class="pubkey-fallback">{originalEvent.pubkey.slice(0, 8)}...</span>
                            {/if}
                        </div>
                        <span class="event-time">{formatTime(originalEvent.created_at)}</span>
                        <span class="root-indicator">root</span>
                    </div>
                    <div class="event-content">
                        {@html renderContentWithMedia(originalEvent.content)}
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
                                <div class="event-author">
                                    {#if getCachedUserProfile(reply.pubkey)}
                                        {@const profile = getCachedUserProfile(reply.pubkey)}
                                        <div class="author-info">
                                            {#if profile.picture}
                                                <img src={profile.picture} alt="Avatar" class="avatar" />
                                            {:else}
                                                <div class="avatar-placeholder"></div>
                                            {/if}
                                            <span class="username">{profile.name || profile.display_name || reply.pubkey.slice(0, 8) + '...'}</span>
                                        </div>
                                    {:else}
                                        <span class="pubkey-fallback">{reply.pubkey.slice(0, 8)}...</span>
                                    {/if}
                                </div>
                                <span class="event-time">{formatTime(reply.created_at)}</span>
                                <span class="thread-indicator">💬</span>
                            </div>
                            <div class="event-content">
                                {@html renderContentWithMedia(reply.content)}
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
        /* border-bottom: 1px solid var(--border-color); */
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
        padding: 0.5em;
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

    .author-info {
        font-family: "Noto Sans";
        font-weight: 900;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.5rem;
        border:none;
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

    .previous-replies-section {
        margin-bottom: 1rem;
    }

    .previous-replies-section h4 {
        margin: 0 0 0.5rem 0;
        color: var(--text-color);
        font-size: 0.9rem;
        font-weight: 500;
        opacity: 0.8;
    }


    .previous-replies-list {
        display: flex;
        flex-direction: column;
        gap: 0;
        margin-top: 0.5rem;
    }

    .previous-reply-item {
        background: none;
        border: none;
        padding: 0.5rem 0;
        cursor: pointer;
        text-align: left;
        font-family: inherit;
        font-size: 0.9rem;
        color: var(--text-color);
        opacity: 0.8;
        transition: opacity 0.2s;
        border-bottom: 1px solid var(--border-color);
        width: 100%;
    }

    .chain-event-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.25rem;
        font-size: 0.8rem;
    }

    .chain-event-content {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 0.9rem;
        opacity: 0.9;
        padding-left:1em;
    }

    .avatar-small {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        object-fit: cover;
        border: 1px solid var(--border-color);
    }

    .avatar-placeholder-small {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background-color: var(--primary);
        opacity: 0.3;
        border: 1px solid var(--border-color);
    }

    .username-small {
        font-family: "Noto Sans", sans-serif;
        font-weight: 900;
        color: var(--text-color);
        font-size: 0.8rem;
    }

    .pubkey-fallback-small {
        font-family: monospace;
        color: var(--primary);
        font-size: 0.8rem;
    }

    .event-time-small {
        color: var(--text-color);
        font-size: 0.75rem;
        opacity: 0.7;
    }

    .previous-reply-item:hover {
        opacity: 1;
        background-color: var(--button-hover-bg);
    }

    .previous-reply-item:last-child {
        border-bottom: none;
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
        padding-left:1em;
    }

    .media-block {
        margin: 0.5rem 0;
        width: 100%;
        max-width: 24em;
        border-radius: 0;
        overflow: hidden;
        background-color: var(--button-hover-bg);
        box-sizing: border-box;
    }

    .image-block img {
        width: 100% !important;
        max-width: 24em !important;
        height: auto !important;
        display: block !important;
        border-radius: 0;
        object-fit: contain !important;
        box-sizing: border-box;
    }

    .video-block video {
        width: 100% !important;
        max-width: 24em !important;
        height: auto !important;
        display: block !important;
        border-radius: 0;
        object-fit: contain !important;
        box-sizing: border-box;
    }

    .audio-block audio {
        width: 100%;
        display: block;
        border-radius: 0;
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
