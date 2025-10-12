import { DEFAULT_RELAYS } from './constants.js';
import NDK from '@nostr-dev-kit/ndk';

// Simple WebSocket relay manager
class NostrClient {
    constructor() {
        this.relays = new Map();
        this.subscriptions = new Map();
    }

    async connect() {
        console.log('Starting connection to', DEFAULT_RELAYS.length, 'relays...');
        
        const connectionPromises = DEFAULT_RELAYS.map(relayUrl => {
            return new Promise((resolve) => {
                try {
                    console.log(`Attempting to connect to ${relayUrl}`);
                    const ws = new WebSocket(relayUrl);
                    
                    ws.onopen = () => {
                        console.log(`✓ Successfully connected to ${relayUrl}`);
                        resolve(true);
                    };
                    
                    ws.onerror = (error) => {
                        console.error(`✗ Error connecting to ${relayUrl}:`, error);
                        resolve(false);
                    };
                    
                    ws.onclose = (event) => {
                        console.warn(`Connection closed to ${relayUrl}:`, event.code, event.reason);
                    };
                    
                    ws.onmessage = (event) => {
                        console.log(`Message from ${relayUrl}:`, event.data);
                        try {
                            this.handleMessage(relayUrl, JSON.parse(event.data));
                        } catch (error) {
                            console.error(`Failed to parse message from ${relayUrl}:`, error, event.data);
                        }
                    };
                    
                    this.relays.set(relayUrl, ws);
                    
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        if (ws.readyState !== WebSocket.OPEN) {
                            console.warn(`Connection timeout for ${relayUrl}`);
                            resolve(false);
                        }
                    }, 5000);
                    
                } catch (error) {
                    console.error(`Failed to create WebSocket for ${relayUrl}:`, error);
                    resolve(false);
                }
            });
        });
        
        const results = await Promise.all(connectionPromises);
        const successfulConnections = results.filter(Boolean).length;
        console.log(`Connected to ${successfulConnections}/${DEFAULT_RELAYS.length} relays`);
        
        // Wait a bit more for connections to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    handleMessage(relayUrl, message) {
        console.log(`Processing message from ${relayUrl}:`, message);
        const [type, subscriptionId, event, ...rest] = message;
        
        console.log(`Message type: ${type}, subscriptionId: ${subscriptionId}`);
        
        if (type === 'EVENT') {
            console.log(`Received EVENT for subscription ${subscriptionId}:`, event);
            if (this.subscriptions.has(subscriptionId)) {
                console.log(`Found callback for subscription ${subscriptionId}, executing...`);
                const callback = this.subscriptions.get(subscriptionId);
                callback(event);
            } else {
                console.warn(`No callback found for subscription ${subscriptionId}`);
            }
        } else if (type === 'EOSE') {
            console.log(`End of stored events for subscription ${subscriptionId} from ${relayUrl}`);
        } else if (type === 'NOTICE') {
            console.warn(`Notice from ${relayUrl}:`, subscriptionId);
        } else {
            console.log(`Unknown message type ${type} from ${relayUrl}:`, message);
        }
    }

    subscribe(filters, callback) {
        const subscriptionId = Math.random().toString(36).substring(7);
        console.log(`Creating subscription ${subscriptionId} with filters:`, filters);
        
        this.subscriptions.set(subscriptionId, callback);
        
        const subscription = ['REQ', subscriptionId, filters];
        console.log(`Subscription message:`, JSON.stringify(subscription));
        
        let sentCount = 0;
        for (const [relayUrl, ws] of this.relays) {
            console.log(`Checking relay ${relayUrl}, readyState: ${ws.readyState} (${ws.readyState === WebSocket.OPEN ? 'OPEN' : 'NOT OPEN'})`);
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(subscription));
                    console.log(`✓ Sent subscription to ${relayUrl}`);
                    sentCount++;
                } catch (error) {
                    console.error(`✗ Failed to send subscription to ${relayUrl}:`, error);
                }
            } else {
                console.warn(`✗ Cannot send to ${relayUrl}, connection not ready`);
            }
        }
        
        console.log(`Subscription ${subscriptionId} sent to ${sentCount}/${this.relays.size} relays`);
        return subscriptionId;
    }

    unsubscribe(subscriptionId) {
        this.subscriptions.delete(subscriptionId);
        
        const closeMessage = ['CLOSE', subscriptionId];
        
        for (const [relayUrl, ws] of this.relays) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(closeMessage));
            }
        }
    }

    disconnect() {
        for (const [relayUrl, ws] of this.relays) {
            ws.close();
        }
        this.relays.clear();
        this.subscriptions.clear();
    }
}

// Create a global client instance
export const nostrClient = new NostrClient();

// IndexedDB helpers for caching events (kind 0 profiles)
const DB_NAME = 'nostrCache';
const DB_VERSION = 1;
const STORE_EVENTS = 'events';

function openDB() {
    return new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_EVENTS)) {
                    const store = db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
                    store.createIndex('byKindAuthor', ['kind', 'pubkey'], { unique: false });
                    store.createIndex('byKindAuthorCreated', ['kind', 'pubkey', 'created_at'], { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
}

async function getLatestProfileEvent(pubkey) {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_EVENTS, 'readonly');
            const idx = tx.objectStore(STORE_EVENTS).index('byKindAuthorCreated');
            const range = IDBKeyRange.bound([0, pubkey, -Infinity], [0, pubkey, Infinity]);
            const req = idx.openCursor(range, 'prev'); // newest first
            req.onsuccess = () => {
                const cursor = req.result;
                resolve(cursor ? cursor.value : null);
            };
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('IDB getLatestProfileEvent failed', e);
        return null;
    }
}

async function putEvent(event) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_EVENTS, 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.objectStore(STORE_EVENTS).put(event);
        });
    } catch (e) {
        console.warn('IDB putEvent failed', e);
    }
}

function parseProfileFromEvent(event) {
    try {
        const profile = JSON.parse(event.content || '{}');
        return {
            name: profile.name || profile.display_name || '',
            picture: profile.picture || '',
            banner: profile.banner || '',
            about: profile.about || '',
            nip05: profile.nip05 || '',
            lud16: profile.lud16 || profile.lud06 || ''
        };
    } catch (e) {
        return { name: '', picture: '', banner: '', about: '', nip05: '', lud16: '' };
    }
}

// Fetch user profile metadata (kind 0)
export async function fetchUserProfile(pubkey) {
    return new Promise(async (resolve, reject) => {
        console.log(`Starting profile fetch for pubkey: ${pubkey}`);

        let resolved = false;
        let newestEvent = null;
        let debounceTimer = null;
        let overallTimer = null;
        let subscriptionId = null;

        function cleanup() {
            if (subscriptionId) {
                try { nostrClient.unsubscribe(subscriptionId); } catch {}
            }
            if (debounceTimer) clearTimeout(debounceTimer);
            if (overallTimer) clearTimeout(overallTimer);
        }

        // 1) Try cached profile first and resolve immediately if present
        try {
            const cachedEvent = await getLatestProfileEvent(pubkey);
            if (cachedEvent) {
                console.log('Using cached profile event');
                const profile = parseProfileFromEvent(cachedEvent);
                resolved = true; // resolve immediately with cache
                resolve(profile);
            }
        } catch (e) {
            console.warn('Failed to load cached profile', e);
        }

        // 2) Set overall timeout
        overallTimer = setTimeout(() => {
            if (!newestEvent) {
                console.log('Profile fetch timeout reached');
                if (!resolved) reject(new Error('Profile fetch timeout'));
            } else if (!resolved) {
                resolve(parseProfileFromEvent(newestEvent));
            }
            cleanup();
        }, 15000);

        // 3) Wait a bit to ensure connections are ready and then subscribe without limit
        setTimeout(() => {
            console.log('Starting subscription after connection delay...');
            subscriptionId = nostrClient.subscribe(
                {
                    kinds: [0],
                    authors: [pubkey]
                },
                (event) => {
                    // Collect all kind 0 events and pick the newest by created_at
                    if (!event || event.kind !== 0) return;
                    console.log('Profile event received:', event);

                    if (!newestEvent || (event.created_at || 0) > (newestEvent.created_at || 0)) {
                        newestEvent = event;
                    }

                    // Debounce to wait for more relays; then finalize selection
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(async () => {
                        try {
                            if (newestEvent) {
                                await putEvent(newestEvent); // cache newest only
                                const profile = parseProfileFromEvent(newestEvent);

                                // Notify listeners that an updated profile is available
                                try {
                                    if (typeof window !== 'undefined' && window.dispatchEvent) {
                                        window.dispatchEvent(new CustomEvent('profile-updated', {
                                            detail: { pubkey, profile, event: newestEvent }
                                        }));
                                    }
                                } catch (e) {
                                    console.warn('Failed to dispatch profile-updated event', e);
                                }

                                if (!resolved) {
                                    resolve(profile);
                                    resolved = true;
                                }
                            }
                        } finally {
                            cleanup();
                        }
                    }, 800);
                }
            );
        }, 2000);
    });
}

// Initialize client connection
export async function initializeNostrClient() {
    await nostrClient.connect();
}

// NDK instance
let ndk = null;

// Initialize NDK
export async function initializeNDK() {
    if (!ndk) {
        ndk = new NDK({
            explicitRelayUrls: DEFAULT_RELAYS
        });
        await ndk.connect();
    }
    return ndk;
}

// Get NDK instance
export function getNDK() {
    return ndk;
}

// Create extension signer
export function createExtensionSigner() {
    console.log('Checking for Nostr extension...');
    console.log('window.nostr:', window.nostr);
    console.log('window.nostr type:', typeof window.nostr);
    
    if (!window.nostr) {
        throw new Error('No Nostr extension found. Please install a NIP-07 compatible extension like nos2x or Alby.');
    }
    
    // Check if the extension has the required methods
    if (typeof window.nostr.getPublicKey !== 'function') {
        throw new Error('Nostr extension does not support getPublicKey method. Please update your extension.');
    }
    
    if (typeof window.nostr.signEvent !== 'function') {
        throw new Error('Nostr extension does not support signEvent method. Please update your extension.');
    }
    
    console.log('Nostr extension found and validated, creating signer...');
    
    return {
        async getPublicKey() {
            try {
                console.log('Getting public key from extension...');
                const pubkey = await window.nostr.getPublicKey();
                console.log('Got public key:', pubkey);
                
                if (!pubkey || typeof pubkey !== 'string') {
                    throw new Error('Invalid public key received from extension');
                }
                
                return pubkey;
            } catch (error) {
                console.error('Error getting public key:', error);
                throw new Error(`Failed to get public key: ${error.message}`);
            }
        },
        async signEvent(event) {
            try {
                console.log('Signing event with extension...');
                console.log('Event to sign:', event);
                
                if (!event || typeof event !== 'object') {
                    throw new Error('Invalid event object');
                }
                
                const signedEvent = await window.nostr.signEvent(event);
                console.log('Event signed:', signedEvent);
                
                if (!signedEvent || !signedEvent.sig) {
                    throw new Error('Invalid signed event received from extension');
                }
                
                return signedEvent;
            } catch (error) {
                console.error('Error signing event:', error);
                throw new Error(`Failed to sign event: ${error.message}`);
            }
        }
    };
}

// Test extension availability
export function testExtension() {
    console.log('Testing Nostr extension availability...');
    console.log('window.nostr:', window.nostr);
    console.log('typeof window.nostr:', typeof window.nostr);
    
    if (!window.nostr) {
        return {
            available: false,
            error: 'No Nostr extension found'
        };
    }
    
    const methods = {
        getPublicKey: typeof window.nostr.getPublicKey === 'function',
        signEvent: typeof window.nostr.signEvent === 'function',
        getRelays: typeof window.nostr.getRelays === 'function',
        nip04: {
            encrypt: typeof window.nostr.nip04?.encrypt === 'function',
            decrypt: typeof window.nostr.nip04?.decrypt === 'function'
        }
    };
    
    console.log('Extension methods available:', methods);
    
    return {
        available: true,
        methods
    };
}

// Simple NIP-07 login without NDK dependency
export async function loginWithNIP07() {
    try {
        console.log('Starting NIP-07 login...');
        
        // Check if extension is available
        if (!window.nostr) {
            throw new Error('No Nostr extension found. Please install a NIP-07 compatible extension like nos2x or Alby.');
        }
        
        // Check if the extension has the required methods
        if (typeof window.nostr.getPublicKey !== 'function') {
            throw new Error('Nostr extension does not support getPublicKey method. Please update your extension.');
        }
        
        console.log('Extension detected, getting public key...');
        const pubkey = await window.nostr.getPublicKey();
        console.log('Public key obtained:', pubkey);
        
        if (!pubkey || typeof pubkey !== 'string') {
            throw new Error('Invalid public key received from extension');
        }
        
        // Create a simple signer object
        const signer = {
            async getPublicKey() {
                return pubkey;
            },
            async signEvent(event) {
                if (!window.nostr.signEvent) {
                    throw new Error('Extension does not support signEvent');
                }
                return await window.nostr.signEvent(event);
            }
        };
        
        console.log('NIP-07 login successful');
        return {
            pubkey,
            profile: null, // Will be fetched separately
            signer
        };
    } catch (error) {
        console.error('NIP-07 login failed:', error);
        throw error;
    }
}

// Login with extension using NDK
export async function loginWithExtension() {
    try {
        console.log('Starting extension login...');
        
        // First check if extension is available
        if (!window.nostr) {
            throw new Error('No Nostr extension found. Please install a NIP-07 compatible extension like nos2x or Alby.');
        }
        
        console.log('Extension detected, creating signer...');
        const signer = createExtensionSigner();
        console.log('Signer created:', signer);
        
        // Get the user's public key first
        console.log('Getting public key...');
        const pubkey = await signer.getPublicKey();
        console.log('Public key obtained:', pubkey);
        
        // Initialize NDK with the signer
        console.log('Initializing NDK...');
        const ndk = await initializeNDK();
        console.log('NDK initialized:', ndk);
        
        // Set the signer on NDK
        console.log('Setting signer on NDK...');
        ndk.signer = signer;
        
        // Get user profile
        console.log('Fetching user profile...');
        const user = ndk.getUser({ pubkey });
        
        try {
            await user.fetchProfile();
            console.log('User profile fetched:', user.profile);
        } catch (profileError) {
            console.warn('Failed to fetch profile, continuing with basic info:', profileError);
            // Continue even if profile fetch fails
        }
        
        const result = {
            pubkey,
            profile: user.profile || null,
            ndk,
            signer
        };
        
        console.log('Extension login successful:', result);
        return result;
    } catch (error) {
        console.error('Extension login failed:', error);
        
        // Provide more specific error messages
        if (error.message.includes('No Nostr extension')) {
            throw new Error('No Nostr extension found. Please install a NIP-07 compatible extension like nos2x or Alby.');
        } else if (error.message.includes('getPublicKey')) {
            throw new Error('Failed to get public key from extension. Please check your extension permissions.');
        } else if (error.message.includes('signEvent')) {
            throw new Error('Failed to sign event with extension. Please check your extension permissions.');
        } else {
            throw new Error(`Extension login failed: ${error.message}`);
        }
    }
}

// Export getLatestProfileEvent and parseProfileFromEvent for direct cache access
export { getLatestProfileEvent, parseProfileFromEvent };