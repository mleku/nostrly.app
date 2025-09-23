import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getConnectionStatus } from '@/lib/ndk'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const { data: relayStatus, isLoading } = useQuery({
    queryKey: ['relay-status'],
    queryFn: async () => {
      return getConnectionStatus()
    },
    refetchInterval: 5000,
  })

  return (
    <div className="home-page">
      <h2>Welcome to Orly.dev Nostr Client</h2>
      <p>A simple nostr client focused on performance and user configurability</p>
      
      <div className="status-section">
        <h3>Connection Status</h3>
        {isLoading ? (
          <p>Checking relay connections...</p>
        ) : (
          <div>
            <p>Connected: {relayStatus?.connected ? 'Yes' : 'No'}</p>
            <p>Active Relays: {relayStatus?.activeRelays || 0}</p>
          </div>
        )}
      </div>

      <div className="features-section">
        <h3>Features</h3>
        <ul>
          <li>✅ React + TypeScript</li>
          <li>✅ TanStack Router for routing</li>
          <li>✅ React Query for state management</li>
          <li>🔄 NDK for Nostr protocol integration</li>
          <li>🔄 Real-time feed updates</li>
          <li>🔄 Profile management</li>
        </ul>
      </div>
    </div>
  )
}