import { DEFAULT_RELAYS } from './constants.js';

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

// Fetch user profile metadata (kind 0)
export async function fetchUserProfile(pubkey) {
    return new Promise((resolve, reject) => {
        let profileFound = false;
        
        console.log(`Starting profile fetch for pubkey: ${pubkey}`);
        
        const timeout = setTimeout(() => {
            if (!profileFound) {
                console.log('Profile fetch timeout reached');
                reject(new Error('Profile fetch timeout'));
            }
        }, 15000); // Increased timeout to 15 seconds
        
        // Wait a bit to ensure connections are ready
        setTimeout(() => {
            console.log('Starting subscription after connection delay...');
            const subscriptionId = nostrClient.subscribe(
                {
                    kinds: [0],
                    authors: [pubkey],
                    limit: 1
                },
                (event) => {
                    console.log('Profile event received:', event);
                    if (!profileFound) {
                        profileFound = true;
                        clearTimeout(timeout);
                        
                        try {
                            const profile = JSON.parse(event.content);
                            console.log('Parsed profile data:', profile);
                            resolve({
                                name: profile.name || profile.display_name || '',
                                picture: profile.picture || '',
                                banner: profile.banner || '',
                                about: profile.about || '',
                                nip05: profile.nip05 || '',
                                lud16: profile.lud16 || profile.lud06 || ''
                            });
                        } catch (error) {
                            console.error('Failed to parse profile data:', error);
                            reject(new Error('Failed to parse profile data'));
                        }
                        
                        nostrClient.unsubscribe(subscriptionId);
                    }
                }
            );
        }, 2000); // Wait 2 seconds for connections to be ready
    });
}

// Initialize client connection
export async function initializeNostrClient() {
    await nostrClient.connect();
}