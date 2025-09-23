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
      <h2>Welcome to nostrly</h2>
      <p>A simple nostr client focused on performance and user configurability</p>
      
      <div className="status-section">
        <h3>Connection Status</h3>
        {isLoading ? (
          <p>Checking relay connections...</p>
        ) : (
          <div>
            <p>Connected: {relayStatus?.connected ? 'Yes' : 'No'}</p>
            <p>Active Relays: {relayStatus?.activeRelays || 0}</p>
            {Array.isArray(relayStatus?.relays) && relayStatus.relays.length > 0 ? (
              <ul>
                {relayStatus.relays.map((r: any) => (
                  <li key={r.url}>
                    {r.connected ? '✅' : '❌'} {r.url}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No relays configured</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}