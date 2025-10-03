/// <reference types="vite/client" />

// Minimal NIP-07 typings so TypeScript recognizes window.nostr
interface Nip07 {
  getPublicKey: () => Promise<string>
  // Additional methods may exist but are not required for this feature
}

declare global {
  interface Window {
    nostr?: Nip07
  }
}

export {}
