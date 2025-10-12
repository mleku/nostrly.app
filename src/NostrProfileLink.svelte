<script>
    import { onMount } from 'svelte';
    import { getUserProfile, getCachedUserProfile } from './profileManager.js';
    import { getLatestProfileEvent, parseProfileFromEvent } from './nostr.js';
    import { nip19 } from 'nostr-tools';
    
    export let url;
    
    let profile = null;
    let loading = true;
    let error = false;
    let fallbackPubkey = null;
    
    // Extract pubkey from nostr URL using nostr-tools
    function extractPubkeyFromNostrUrl(url) {
        try {
            if (url.startsWith('nostr:npub')) {
                // Extract npub from nostr:npub1... -> npub1...
                const npub = url.replace('nostr:', '');
                
                // Check if npub looks complete (should be ~63 chars total)
                if (npub.length < 63) {
                    return null;
                }
                
                const decoded = nip19.decode(npub);
                if (decoded.type === 'npub') {
                    return decoded.data;
                }
            } else if (url.startsWith('nostr:nprofile')) {
                // Extract nprofile from nostr:nprofile1... -> nprofile1...
                const nprofile = url.replace('nostr:', '');
                
                // Check if nprofile looks complete (should be longer than npub)
                if (nprofile.length < 100) {
                    return null;
                }
                
                const decoded = nip19.decode(nprofile);
                if (decoded.type === 'nprofile') {
                    return decoded.data.pubkey;
                }
            }
        } catch (err) {
            console.error('Failed to decode nostr identifier:', err);
        }
        return null;
    }

    // Extract fallback pubkey for display when decoding fails
    function extractFallbackPubkey(url) {
        if (url.startsWith('nostr:npub')) {
            // Try to extract some identifier from truncated npub
            const npub = url.replace('nostr:npub', '');
            if (npub.length > 0) {
                return npub.substring(0, 8); // First 8 chars as fallback
            }
        } else if (url.startsWith('nostr:nprofile')) {
            // Try to extract some identifier from truncated nprofile
            const nprofile = url.replace('nostr:nprofile', '');
            if (nprofile.length > 0) {
                return nprofile.substring(0, 8); // First 8 chars as fallback
            }
        }
        return null;
    }
    
    onMount(async () => {
        const identifier = extractPubkeyFromNostrUrl(url);
        
        if (!identifier) {
            fallbackPubkey = extractFallbackPubkey(url);
            error = true;
            loading = false;
            return;
        }
        
        try {
            // First check the local IndexedDB cache for kind 0 events
            const cachedEvent = await getLatestProfileEvent(identifier);
            if (cachedEvent) {
                profile = parseProfileFromEvent(cachedEvent);
                loading = false;
                return;
            }
            
            // Then check the profile manager cache
            const cachedProfile = getCachedUserProfile(identifier);
            if (cachedProfile) {
                profile = cachedProfile;
                loading = false;
                return;
            }
            
            // If not cached anywhere, fetch it from relays
            profile = await getUserProfile(identifier);
            loading = false;
        } catch (err) {
            console.error('Failed to fetch profile for nostr link:', err);
            error = true;
            loading = false;
        }
    });
</script>

{#if loading}
    <span class="nostr-profile-link loading">Loading profile...</span>
{:else if error || !profile}
    <span class="nostr-profile-link invalid">
        <div class="nostr-avatar-placeholder">👤</div>
        <span class="nostr-username">{fallbackPubkey || 'Invalid nostr link'}</span>
    </span>
{:else}
    <a href={url} class="nostr-profile-link" target="_blank" rel="noopener noreferrer">
        {#if profile.picture}
            <img src={profile.picture} alt="Avatar" class="nostr-avatar" />
        {:else}
            <div class="nostr-avatar-placeholder">👤</div>
        {/if}
        <span class="nostr-username">{profile.name || profile.display_name || 'Unknown User'}</span>
    </a>
{/if}

<style>
    .nostr-profile-link {
        color: var(--text-color);
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        font-size: inherit;
        font-family: inherit;
        font-weight: inherit;
        padding: 0.125rem 0.25rem;
        border-radius: 0.375rem;
        background-color: var(--button-hover-bg);
        transition: background-color 0.2s;
    }

    .nostr-profile-link:hover {
        background-color: var(--primary-color);
        color: var(--text-color);
    }

    .nostr-profile-link.loading {
        opacity: 0.6;
        font-style: italic;
        background-color: transparent;
        padding: 0;
    }

    .nostr-profile-link.invalid {
        background-color: var(--button-hover-bg);
        color: var(--text-color);
        cursor: not-allowed;
        opacity: 0.8;
    }

    .nostr-avatar {
        width: 1em;
        height: 1em;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
    }

    .nostr-avatar-placeholder {
        width: 1em;
        height: 1em;
        border-radius: 50%;
        background-color: var(--border-color);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.7em;
        flex-shrink: 0;
    }

    .nostr-username {
        font-size: inherit;
        font-family: inherit;
        font-weight: inherit;
        white-space: nowrap;
    }

    .nostr-profile-link.invalid .nostr-username {
        max-width: 12em;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: monospace;
        font-size: 0.9em;
        opacity: 0.7;
    }
</style>
