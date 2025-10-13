<script>
    import { onMount } from 'svelte';
    import { fetchEvent } from './nostr.js';
    import { getUserProfile, getCachedUserProfile } from './profileManager.js';
    import { nip19 } from 'nostr-tools';
    
    export let eventId;
    
    let event = null;
    let loading = true;
    let error = false;
    let profile = null;
    
    // Extract URLs from text content
    function extractUrls(text) {
        const urlRegex = /(https?:\/\/[^\s]+|nostr:(?:nprofile|npub)1[a-z0-9]+)/g;
        return text.match(urlRegex) || [];
    }
    
    // Check if URL is a media URL
    function isMediaUrl(url) {
        const urlLower = url.toLowerCase();
        return urlLower.includes('.jpg') || urlLower.includes('.jpeg') || 
               urlLower.includes('.png') || urlLower.includes('.gif') || 
               urlLower.includes('.webp') || urlLower.includes('.svg') ||
               urlLower.includes('.mp4') || urlLower.includes('.webm') ||
               urlLower.includes('.mp3') || urlLower.includes('.wav') || 
               urlLower.includes('.ogg') || urlLower.includes('.m4a');
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
        
        return url;
    }
    
    // Render content with media blocks
    function renderContentWithMedia(content) {
        const urls = extractUrls(content);
        let renderedContent = content;
        
        urls.forEach(url => {
            if (isMediaUrl(url)) {
                const mediaBlock = createMediaBlock(url);
                renderedContent = renderedContent.replace(url, mediaBlock);
            } else {
                // Linkify non-media URLs
                const linkHtml = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="content-link">${url}</a>`;
                renderedContent = renderedContent.replace(url, linkHtml);
            }
        });
        
        return renderedContent;
    }
    
    // Format timestamp
    function formatTimestamp(timestamp) {
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
    
    onMount(async () => {
        try {
            event = await fetchEvent(eventId);
            if (event) {
                // Fetch profile for the event author
                const cachedProfile = getCachedUserProfile(event.pubkey);
                if (cachedProfile) {
                    profile = cachedProfile;
                } else {
                    profile = await getUserProfile(event.pubkey);
                }
            }
            loading = false;
        } catch (err) {
            error = true;
            loading = false;
        }
    });
</script>

{#if loading}
    <div class="inline-event loading">
        <div class="event-header">
            <div class="event-avatar-placeholder">👤</div>
            <div class="event-meta">
                <div class="event-author">Loading...</div>
                <div class="event-time">...</div>
            </div>
        </div>
        <div class="event-content">Loading event...</div>
    </div>
{:else if error || !event}
    <div class="inline-event error">
        <div class="event-header">
            <div class="event-avatar-placeholder">⚠️</div>
            <div class="event-meta">
                <div class="event-author">Event not found</div>
                <div class="event-time">...</div>
            </div>
        </div>
        <div class="event-content">Unable to load event {eventId}</div>
    </div>
{:else}
    <div class="inline-event">
        <div class="event-header">
            {#if profile?.picture}
                <img src={profile.picture} alt="Avatar" class="event-avatar" />
            {:else}
                <div class="event-avatar-placeholder">👤</div>
            {/if}
            <div class="event-meta">
                <div class="event-author">
                    {profile?.name || profile?.display_name || event.pubkey.substring(0, 8) + '...'}
                </div>
                <div class="event-time">{formatTimestamp(event.created_at)}</div>
            </div>
        </div>
        <div class="event-content">
            {@html renderContentWithMedia(event.content)}
        </div>
    </div>
{/if}

<style>
    .inline-event {
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        padding: 0.75rem;
        margin: 0.5rem 0;
        background-color: var(--card-bg, var(--background-color));
        max-width: 100%;
        box-sizing: border-box;
    }
    
    .inline-event.loading {
        opacity: 0.6;
    }
    
    .inline-event.error {
        border-color: var(--error-color, #ff6b6b);
        background-color: var(--error-bg, rgba(255, 107, 107, 0.1));
    }
    
    .event-header {
        display: flex;
        align-items: flex-start;
    }
    
    .event-avatar {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
    }
    
    .event-avatar-placeholder {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        background-color: var(--button-hover-bg);
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        font-size: 0.8rem;
        flex-shrink: 0;
    }
    
    .event-meta {
        flex: 1;
        min-width: 0;
    }
    
    .event-author {
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    
    .event-time {
        font-size: 0.75rem;
        color: var(--text-color-secondary, var(--text-color));
        opacity: 0.7;
    }
    
    .event-content {
        font-size: 0.875rem;
        line-height: 1.4;
        color: var(--text-color);
        word-wrap: break-word;
    }
    
    .event-content :global(.media-block) {
        margin: 0.5rem 0;
        width: 100%;
    }
    
    .event-content :global(.image-block img) {
        width: 100% !important;
        max-width: 20em !important;
        height: auto;
        border-radius: 0.25rem;
    }
    
    .event-content :global(.video-block video) {
        width: 100% !important;
        max-width: 20em !important;
        height: auto;
        border-radius: 0.25rem;
    }
    
    .event-content :global(.audio-block audio) {
        width: 100%;
        display: block;
    }
    
    .event-content :global(.content-link) {
        color: var(--primary-color);
        text-decoration: underline;
    }
    
    .event-content :global(.content-link:hover) {
        opacity: 0.8;
    }
</style>
