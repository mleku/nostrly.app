import NDK, {NDKNip07Signer, NDKEvent, NDKFilter, NDKKind} from '@nostr-dev-kit/ndk'

// Default relay configuration
const DEFAULT_RELAYS = [
    'wss://nostr.wine',
    'wss://relay.snort.social',
    'wss://theforest.nostr1.com',
    'wss://relay.orly.dev'
]

// Create NDK instance
export const ndk = new NDK({
    explicitRelayUrls: DEFAULT_RELAYS,
    autoConnectUserRelays: true,
    autoFetchUserMutelist: true,
})

// Connection status
let isConnected = false

// Utility to bound async operations with a timeout
export const withTimeout = async <T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> => {
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        promise.then((value) => {
            clearTimeout(timer)
            resolve(value)
        }).catch((err) => {
            clearTimeout(timer)
            reject(err)
        })
    })
}

// Initialize NDK connection
export const initializeNDK = async (timeoutMs = 7000): Promise<boolean> => {
    try {
        await withTimeout(ndk.connect(), timeoutMs, 'NDK connect')
        isConnected = true
        console.log('NDK connected successfully')
        return true
    } catch (error) {
        console.warn('NDK connect failed or timed out:', error)
        isConnected = false
        return false
    }
}

// Get connection status
export const getConnectionStatus = () => {
    const entries: Array<[string, any]> = Array.from(ndk.pool?.relays?.entries() || []) as any
    const relayStatuses = entries.map(([url, relay]) => ({
        url,
        connected: relay?.connectivity?.status === 'connected'
    }))

    return {
        connected: isConnected,
        // Change relays to be detailed status objects to support UI listing
        relays: relayStatuses,
        activeRelays: relayStatuses.filter(r => r.connected).length
    }
}

// Fetch user profile
export const fetchUserProfile = async (pubkey: string) => {
    try {
        const user = ndk.getUser({pubkey})
        await user.fetchProfile()
        return {
            name: user.profile?.name || 'Anonymous',
            about: user.profile?.about || '',
            picture: user.profile?.picture || '',
            npub: user.npub,
            created_at: Date.now()
        }
    } catch (error) {
        console.error('Failed to fetch user profile:', error)
        return null
    }
}

// Publish a text note
export const publishNote = async (content: string, privateKey?: string): Promise<NDKEvent | null> => {
    try {
        if (!isConnected) {
            await initializeNDK()
        }

        const event = new NDKEvent(ndk)
        event.kind = NDKKind.Text
        event.content = content
        event.created_at = Math.floor(Date.now() / 1000)

        if (privateKey) {
            // If private key is provided, sign the event
            // Note: In a real app, you'd want to handle key management more securely
            await event.sign()
        }

        await event.publish()
        return event
    } catch (error) {
        console.error('Failed to publish note:', error)
        return null
    }
}

// Fetch feed events
export const fetchFeedEvents = async (limit = 50): Promise<NDKEvent[]> => {
    try {
        if (!isConnected) {
            await initializeNDK()
        }

        const filter: NDKFilter = {
            kinds: [1, 1111, 6, 30023, 9802, 1068, 1222, 1244, 20, 21, 22] as unknown as NDKKind[],
            limit,
            since: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000) // Last 24 hours
        }

        const events = await ndk.fetchEvents(filter)
        return Array.from(events).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    } catch (error) {
        console.error('Failed to fetch feed events:', error)
        return []
    }
}

// Subscribe to real-time events
export const subscribeToFeed = (
    onEvent: (event: NDKEvent) => void,
    filters?: NDKFilter[]
) => {
    try {
        const defaultFilters: NDKFilter[] = filters || [{
            kinds: [1, 1111, 6, 30023, 9802, 1068, 1222, 1244, 20, 21, 22] as unknown as NDKKind[],
            since: Math.floor(Date.now() / 1000)
        }]

        const subscription = ndk.subscribe(defaultFilters)

        subscription.on('event', onEvent)
        subscription.on('close', () => {
            console.log('Subscription closed')
        })

        return subscription
    } catch (error) {
        console.error('Failed to subscribe to feed:', error)
        return null
    }
}

export interface LoggedInUser {
    pubkey: string
    npub: string
    name?: string
    picture?: string
}

export const loginWithExtension = async (): Promise<LoggedInUser | null> => {
    try {
        const nip07 = (window as any).nostr
        if (!nip07 || typeof nip07.getPublicKey !== 'function') {
            throw new Error('No Nostr extension detected (NIP-07). Please install a Nostr browser extension.')
        }
        // Create signer and assign before any network calls
        const signer = new NDKNip07Signer()
        ndk.signer = signer

        // Get the user (triggers getPublicKey permission) with a reasonable timeout
        const user = await withTimeout(signer.user(), 6000, 'NIP-07 getPublicKey')

        // Start/attempt NDK connection but do not block login if it takes too long
        try {
            await initializeNDK(6000)
        } catch (_) {
            // Non-fatal for login; user object is still usable locally
        }

        // Try to fetch profile, but don't block if relays are slow/unavailable
        try {
            await withTimeout(user.fetchProfile(), 2500, 'Profile fetch')
        } catch (e) {
            console.warn('Profile fetch skipped/failed:', e)
        }

        // Attempt to switch to user's relay list (NIP-65 / kind 10002) if available
        try {
            await withTimeout(applyUserRelays(user.pubkey), 6000, 'Apply user relays')
        } catch (e) {
            console.warn('Using default relays; user relay application failed or timed out:', e)
        }

        return {
            pubkey: user.pubkey,
            npub: user.npub,
            name: user.profile?.name || undefined,
            picture: user.profile?.picture || undefined
        }
    } catch (error) {
        console.error('Login with NIP-07 failed:', error)
        return null
    }
}

export const logout = () => {
    // Clear signer reference
    // @ts-ignore
    ndk.signer = undefined
    // Switch back to default relays asynchronously
    switchRelays(DEFAULT_RELAYS).catch(() => {})
}

// Ensure an NIP-07 signer is available on the NDK instance
export const ensureSigner = async (): Promise<boolean> => {
    try {
        if ((ndk as any).signer) return true
        const nip07 = (window as any).nostr
        if (!nip07 || typeof nip07.getPublicKey !== 'function') return false
        const signer = new NDKNip07Signer()
        ndk.signer = signer
        // Warm up permissions (non-fatal if it times out)
        try { await withTimeout(signer.user(), 5000, 'NIP-07 getPublicKey') } catch {}
        return true
    } catch {
        return false
    }
}

// Initialize NDK when module loads
initializeNDK()

// --- User relay list handling (NIP-65 kind 10002) ---
export const fetchUserRelays = async (pubkey: string, timeoutMs = 5000): Promise<string[]> => {
    try {
        const filter: NDKFilter = { kinds: [NDKKind.RelayList], authors: [pubkey], limit: 1 }
        const set = await withTimeout(ndk.fetchEvents(filter), timeoutMs, 'fetch relay list')
        const latest = Array.from(set).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]
        if (!latest) return []
        const urls = latest.tags
            .filter(t => t[0] === 'r' && typeof t[1] === 'string')
            .map(t => (t[1] as string).trim())
            .filter(u => u.startsWith('ws'))
        return Array.from(new Set(urls))
    } catch (e) {
        console.warn('fetchUserRelays failed:', e)
        return []
    }
}

export const switchRelays = async (urls: string[], timeoutMs = 7000): Promise<boolean> => {
    try {
        if (!urls || urls.length === 0) return false
        try {
            const relays: any[] = Array.from((ndk.pool as any)?.relays?.values?.() || [])
            for (const r of relays) {
                try { await r.disconnect?.() } catch {}
            }
        } catch {}
        ;(ndk as any).explicitRelayUrls = urls
        isConnected = false
        await initializeNDK(timeoutMs)
        return true
    } catch (e) {
        console.warn('switchRelays failed:', e)
        return false
    }
}

export const applyUserRelays = async (pubkey: string): Promise<boolean> => {
    try {
        const urls = await fetchUserRelays(pubkey)
        if (!urls.length) return false
        const ok = await switchRelays(urls)
        if (ok) {
            console.log('Applied user relays:', urls)
        }
        return ok
    } catch {
        return false
    }
}
