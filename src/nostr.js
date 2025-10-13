import { DEFAULT_RELAYS } from './constants.js';
import NDK from '@nostr-dev-kit/ndk';

// Simple WebSocket relay manager
class NostrClient {
    constructor() {
        this.relays = new Map();
        this.subscriptions = new Map();
    }

    async connect() {
        const connectionPromises = DEFAULT_RELAYS.map(relayUrl => {
            return new Promise((resolve) => {
                try {
                    const ws = new WebSocket(relayUrl);
                    
                    ws.onopen = () => {
                        resolve(true);
                    };
                    
                    ws.onerror = (error) => {
                        resolve(false);
                    };
                    
                    ws.onclose = (event) => {
                        // Connection closed
                    };
                    
                    ws.onmessage = (event) => {
                        try {
                            this.handleMessage(relayUrl, JSON.parse(event.data));
                        } catch (error) {
                            // Failed to parse message
                        }
                    };
                    
                    this.relays.set(relayUrl, ws);
                    
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        if (ws.readyState !== WebSocket.OPEN) {
                            resolve(false);
                        }
                    }, 5000);
                    
                } catch (error) {
                    resolve(false);
                }
            });
        });
        
        const results = await Promise.all(connectionPromises);
        const successfulConnections = results.filter(Boolean).length;
        
        // Wait a bit more for connections to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    handleMessage(relayUrl, message) {
        const [type, subscriptionId, event, ...rest] = message;
        
        if (type === 'EVENT') {
            if (this.subscriptions.has(subscriptionId)) {
                const callback = this.subscriptions.get(subscriptionId);
                callback(event);
            }
        } else if (type === 'EOSE') {
            // End of stored events
        } else if (type === 'NOTICE') {
            // Notice received
        }
    }

    subscribe(filters, callback) {
        const subscriptionId = Math.random().toString(36).substring(7);
        
        this.subscriptions.set(subscriptionId, callback);
        
        const subscription = ['REQ', subscriptionId, filters];
        
        let sentCount = 0;
        for (const [relayUrl, ws] of this.relays) {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(subscription));
                    sentCount++;
                } catch (error) {
                    // Failed to send subscription
                }
            }
        }
        
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
        // IDB putEvent failed
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
                const profile = parseProfileFromEvent(cachedEvent);
                resolved = true; // resolve immediately with cache
                resolve(profile);
            }
        } catch (e) {
            // Failed to load cached profile
        }

        // 2) Set overall timeout
        overallTimer = setTimeout(() => {
            if (!newestEvent) {
                if (!resolved) reject(new Error('Profile fetch timeout'));
            } else if (!resolved) {
                resolve(parseProfileFromEvent(newestEvent));
            }
            cleanup();
        }, 15000);

        // 3) Wait a bit to ensure connections are ready and then subscribe without limit
        setTimeout(() => {
            subscriptionId = nostrClient.subscribe(
                {
                    kinds: [0],
                    authors: [pubkey]
                },
                (event) => {
                    // Collect all kind 0 events and pick the newest by created_at
                    if (!event || event.kind !== 0) return;

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
                                    // Failed to dispatch profile-updated event
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
    
    return {
        async getPublicKey() {
            try {
                const pubkey = await window.nostr.getPublicKey();
                
                if (!pubkey || typeof pubkey !== 'string') {
                    throw new Error('Invalid public key received from extension');
                }
                
                return pubkey;
            } catch (error) {
                throw new Error(`Failed to get public key: ${error.message}`);
            }
        },
        async signEvent(event) {
            try {
                if (!event || typeof event !== 'object') {
                    throw new Error('Invalid event object');
                }
                
                const signedEvent = await window.nostr.signEvent(event);
                
                if (!signedEvent || !signedEvent.sig) {
                    throw new Error('Invalid signed event received from extension');
                }
                
                return signedEvent;
            } catch (error) {
                throw new Error(`Failed to sign event: ${error.message}`);
            }
        }
    };
}

// Test extension availability
export function testExtension() {
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
    
    return {
        available: true,
        methods
    };
}

// Simple NIP-07 login without NDK dependency
export async function loginWithNIP07() {
    try {
        // Check if extension is available
        if (!window.nostr) {
            throw new Error('No Nostr extension found. Please install a NIP-07 compatible extension like nos2x or Alby.');
        }
        
        // Check if the extension has the required methods
        if (typeof window.nostr.getPublicKey !== 'function') {
            throw new Error('Nostr extension does not support getPublicKey method. Please update your extension.');
        }
        
        const pubkey = await window.nostr.getPublicKey();
        
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
        
        return {
            pubkey,
            profile: null, // Will be fetched separately
            signer
        };
    } catch (error) {
        throw error;
    }
}

// Login with extension using NDK
export async function loginWithExtension() {
    try {
        
        // First check if extension is available
        if (!window.nostr) {
            throw new Error('No Nostr extension found. Please install a NIP-07 compatible extension like nos2x or Alby.');
        }
        
        const signer = createExtensionSigner();
        
        // Get the user's public key first
        const pubkey = await signer.getPublicKey();
        
        // Initialize NDK with the signer
        const ndk = await initializeNDK();
        
        // Set the signer on NDK
        ndk.signer = signer;
        
        // Get user profile
        const user = ndk.getUser({ pubkey });
        
        try {
            await user.fetchProfile();
        } catch (profileError) {
            // Failed to fetch profile, continuing with basic info
            // Continue even if profile fetch fails
        }
        
        const result = {
            pubkey,
            profile: user.profile || null,
            ndk,
            signer
        };
        
        return result;
    } catch (error) {
        
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

// Fetch a specific event by ID
export async function fetchEvent(eventId) {
    return new Promise(async (resolve, reject) => {

        let resolved = false;
        let foundEvent = null;
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

        // 1) Try cached event first
        try {
            const cachedEvent = await getEvent(eventId);
            if (cachedEvent) {
                resolved = true;
                resolve(cachedEvent);
            }
        } catch (e) {
            // Failed to load cached event
        }

        // 2) Set overall timeout
        overallTimer = setTimeout(() => {
            if (!foundEvent) {
                if (!resolved) reject(new Error('Event fetch timeout'));
            } else if (!resolved) {
                resolve(foundEvent);
            }
            cleanup();
        }, 10000);

        // 3) Subscribe for the event
        setTimeout(() => {
            subscriptionId = nostrClient.subscribe(
                {
                    ids: [eventId]
                },
                (event) => {
                    if (!event || event.id !== eventId) return;

                    foundEvent = event;

                    // Debounce to wait for more relays
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(async () => {
                        try {
                            if (foundEvent) {
                                await putEvent(foundEvent); // cache the event
                                if (!resolved) {
                                    resolved = true;
                                    resolve(foundEvent);
                                }
                            }
                        } catch (e) {
                            // Failed to cache event
                        }
                        cleanup();
                    }, 1000);
                }
            );
        }, 100);
    });
}

// Export getLatestProfileEvent and parseProfileFromEvent for direct cache access
export { getLatestProfileEvent, parseProfileFromEvent };