import { useEffect, useState } from 'react'
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { loginWithExtension, logout, LoggedInUser, applyUserRelays } from '@/lib/ndk'
import orlyImg from '../../docs/orly.png'

function RootLayout() {
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [user, setUser] = useState<LoggedInUser | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('nostrUser')
      if (saved) {
        const parsed = JSON.parse(saved)
        setUser(parsed)
        // Attempt to apply user relays on app load
        if (parsed?.pubkey) {
          applyUserRelays(parsed.pubkey).catch(() => {})
        }
      }
    } catch {}
  }, [])

  const handleLogin = async () => {
    setIsLoggingIn(true)
    setError(null)
    try {
      const logged = await loginWithExtension()
      if (!logged) {
        setError('Login failed. Ensure a Nostr (NIP-07) extension is installed and unlocked.')
        return
      }
      setUser(logged)
      localStorage.setItem('nostrUser', JSON.stringify(logged))
      setIsLoginOpen(false)
    } catch (e: any) {
      setError(e?.message || 'Login failed')
    } finally {
      setIsLoggingIn(false)
    }
  }

  const handleLogout = () => {
    try { logout() } catch {}
    setUser(null)
    localStorage.removeItem('nostrUser')
  }

  return (
    <>
      <div className="min-h-screen flex flex-col bg-[#162a2f] text-[#cccccc]">
        <header className="sticky top-0 z-50 w-full bg-black">
          <div className="w-full px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
            <Link to="/" className="no-underline flex items-center gap-3">
              <img src={orlyImg} alt="nostrly owl" style={{ width: '3em', height: '3em', objectFit: 'contain' }} />
              <h1 className="text-[#fff3b0] text-2xl font-bold">nostrly</h1>
            </Link>
            <div>
              {user ? (
                <div className="flex items-center gap-3">
                  {user.picture ? (
                    <img src={user.picture} alt="avatar" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                  ) : null}
                  <span className="text-[#cccccc]">{user.name || user.npub.slice(0, 8) + '…'}</span>
                  <button onClick={handleLogout} className="bg-[#162a2f] text-[#cccccc] px-4 py-2 rounded hover:bg-[#1b3a40] disabled:bg-[#162a2f] disabled:text-[#666666]">
                    Logout
                  </button>
                </div>
              ) : (
                <button onClick={() => setIsLoginOpen(true)} className="bg-[#162a2f] text-[#cccccc] px-4 py-2 rounded hover:bg-[#1b3a40] disabled:bg-[#162a2f] disabled:text-[#666666]">
                  Login
                </button>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 w-full pt-4">
          <Outlet />
        </main>
      </div>

      {isLoginOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]" onClick={() => !isLoggingIn && setIsLoginOpen(false)}>
          <div className="w-[90%] max-w-[480px] bg-[#263238] rounded-xl p-5 shadow-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 pb-2">
              <h3 className="text-[#fff3b0] text-xl">Login with Nostr Extension</h3>
            </div>
            <p className="mb-4">
              Connect using a NIP-07 compatible browser extension (e.g., Nos2x, Alby, Unisat, etc.).
            </p>
            {error && (
              <div className="text-[#ff6b6b] mb-3">{error}</div>
            )}
            <div className="mt-4 flex gap-3">
              <button onClick={handleLogin} disabled={isLoggingIn} className="bg-[#162a2f] text-[#cccccc] px-4 py-2 rounded hover:bg-[#1b3a40] disabled:bg-[#162a2f] disabled:text-[#666666]">
                {isLoggingIn ? 'Connecting…' : 'Connect Nostr Extension'}
              </button>
              <button className="bg-[#162a2f] text-[#cccccc] px-4 py-2 rounded hover:bg-[#16213e] disabled:bg-[#162a2f] disabled:text-[#666666]" onClick={() => setIsLoginOpen(false)} disabled={isLoggingIn}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => (
    <div className="flex-1 w-full max-w-[1200px] mx-auto p-8">
      <h2 className="text-[#fff3b0] mb-4 text-2xl">Something went wrong</h2>
      <pre className="whitespace-pre-wrap">{String(error)}</pre>
    </div>
  ),
  notFoundComponent: () => (
    <div className="flex-1 w-full max-w-[1200px] mx-auto p-8">
      <h2 className="text-[#fff3b0] mb-2 text-2xl">Page not found</h2>
      <p className="mb-2">The page you are looking for does not exist.</p>
      <p>
        Go back to <Link to="/" className="text-[#fff3b0] underline">Home</Link>
      </p>
    </div>
  ),
})