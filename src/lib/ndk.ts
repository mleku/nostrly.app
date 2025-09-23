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
    return {
        connected: isConnected,
        relays: Array.from(ndk.pool?.relays?.keys() || []),
        activeRelays: Array.from(ndk.pool?.relays?.values() || [])
            .filter((relay: any) => relay?.connectivity?.status === 'connected').length
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
            kinds: [NDKKind.Text],
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
            kinds: [NDKKind.Text],
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
}

// Initialize NDK when module loads
initializeNDK()