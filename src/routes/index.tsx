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
    <div className="max-w-2xl mx-auto">
      <h2 className="text-[#00d4aa] mb-4 text-2xl">Welcome to nostrly</h2>
      <p className="mb-6">A simple nostr client focused on performance and user configurability</p>
      
      <div className="bg-[#263238] rounded-xl p-6 mb-8">
        <h3 className="text-white text-lg mb-4">Connection Status</h3>
        {isLoading ? (
          <p>Checking relay connections...</p>
        ) : (
          <div>
            <p>Connected: {relayStatus?.connected ? 'Yes' : 'No'}</p>
            <p>Active Relays: {relayStatus?.activeRelays || 0}</p>
            {Array.isArray(relayStatus?.relays) && relayStatus.relays.length > 0 ? (
              <ul className="list-none pl-0">
                {relayStatus.relays.map((r: any) => (
                  <li key={r.url} className="py-2">
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