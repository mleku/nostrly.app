import { getNDK, fetchUserProfile } from './nostr.js';

// Global profile cache with expiration
class ProfileManager {
    constructor() {
        this.profiles = new Map(); // pubkey -> { profile, timestamp, loading }
        this.loadingPromises = new Map(); // pubkey -> Promise
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.batchSize = 10; // Process profiles in batches
        this.batchDelay = 100; // Delay between batches
        
        // Listen for profile updates from nostr.js
        if (typeof window !== 'undefined') {
            window.addEventListener('profile-updated', this.handleProfileUpdate.bind(this));
        }
    }

    // Handle profile updates from nostr.js
    handleProfileUpdate(event) {
        const { pubkey, profile, event: profileEvent } = event.detail;
        console.log('Profile updated:', pubkey, profile);
        
        // Update cache with new profile
        this.profiles.set(pubkey, {
            profile,
            timestamp: Date.now(),
            loading: false
        });
        
        // Resolve any pending promises
        if (this.loadingPromises.has(pubkey)) {
            const resolve = this.loadingPromises.get(pubkey);
            resolve(profile);
            this.loadingPromises.delete(pubkey);
        }
    }

    // Get profile from cache or start loading
    async getProfile(pubkey) {
        if (!pubkey) return null;

        const cached = this.profiles.get(pubkey);
        const now = Date.now();

        // Return cached profile if still valid
        if (cached && !cached.loading && (now - cached.timestamp) < this.cacheTimeout) {
            return cached.profile;
        }

        // Return null for expired cache
        if (cached && !cached.loading && (now - cached.timestamp) >= this.cacheTimeout) {
            this.profiles.delete(pubkey);
        }

        // If already loading, return the existing promise
        if (this.loadingPromises.has(pubkey)) {
            return this.loadingPromises.get(pubkey);
        }

        // Start loading profile
        const loadingPromise = this.loadProfile(pubkey);
        this.loadingPromises.set(pubkey, loadingPromise);

        try {
            const profile = await loadingPromise;
            return profile;
        } finally {
            this.loadingPromises.delete(pubkey);
        }
    }

    // Load profile from nostr.js
    async loadProfile(pubkey) {
        console.log('Loading profile for:', pubkey);
        
        // Mark as loading
        this.profiles.set(pubkey, {
            profile: null,
            timestamp: Date.now(),
            loading: true
        });

        try {
            const profile = await fetchUserProfile(pubkey);
            
            // Update cache
            this.profiles.set(pubkey, {
                profile,
                timestamp: Date.now(),
                loading: false
            });

            return profile;
        } catch (error) {
            console.error('Failed to load profile for:', pubkey, error);
            
            // Cache null result to avoid repeated failures
            this.profiles.set(pubkey, {
                profile: null,
                timestamp: Date.now(),
                loading: false
            });

            return null;
        }
    }

    // Batch load profiles for multiple pubkeys
    async loadProfiles(pubkeys) {
        if (!pubkeys || pubkeys.length === 0) return;

        const uniquePubkeys = [...new Set(pubkeys)].filter(pubkey => pubkey);
        const needsLoading = uniquePubkeys.filter(pubkey => {
            const cached = this.profiles.get(pubkey);
            const now = Date.now();
            
            if (!cached) return true;
            if (cached.loading) return false;
            if ((now - cached.timestamp) >= this.cacheTimeout) return true;
            
            return false;
        });

        console.log(`Loading ${needsLoading.length} profiles (${uniquePubkeys.length} total)`);

        // Process in batches to avoid overwhelming relays
        for (let i = 0; i < needsLoading.length; i += this.batchSize) {
            const batch = needsLoading.slice(i, i + this.batchSize);
            
            // Load batch in parallel
            const batchPromises = batch.map(pubkey => this.getProfile(pubkey));
            await Promise.allSettled(batchPromises);
            
            // Delay between batches
            if (i + this.batchSize < needsLoading.length) {
                await new Promise(resolve => setTimeout(resolve, this.batchDelay));
            }
        }
    }

    // Get cached profile synchronously
    getCachedProfile(pubkey) {
        if (!pubkey) return null;
        
        const cached = this.profiles.get(pubkey);
        const now = Date.now();
        
        if (cached && !cached.loading && (now - cached.timestamp) < this.cacheTimeout) {
            return cached.profile;
        }
        
        return null;
    }

    // Check if profile is loading
    isLoading(pubkey) {
        const cached = this.profiles.get(pubkey);
        return cached && cached.loading;
    }

    // Clear cache
    clearCache() {
        this.profiles.clear();
        this.loadingPromises.clear();
    }

    // Get cache stats
    getCacheStats() {
        const now = Date.now();
        let valid = 0;
        let expired = 0;
        let loading = 0;

        for (const [pubkey, cached] of this.profiles) {
            if (cached.loading) {
                loading++;
            } else if ((now - cached.timestamp) < this.cacheTimeout) {
                valid++;
            } else {
                expired++;
            }
        }

        return {
            total: this.profiles.size,
            valid,
            expired,
            loading,
            pendingPromises: this.loadingPromises.size
        };
    }
}

// Global instance
export const profileManager = new ProfileManager();

// Helper functions for components
export async function getUserProfile(pubkey) {
    return await profileManager.getProfile(pubkey);
}

export function getCachedUserProfile(pubkey) {
    return profileManager.getCachedProfile(pubkey);
}

export async function loadUserProfiles(pubkeys) {
    return await profileManager.loadProfiles(pubkeys);
}

export function isProfileLoading(pubkey) {
    return profileManager.isLoading(pubkey);
}
