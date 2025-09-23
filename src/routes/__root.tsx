import { useEffect, useState } from 'react'
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { loginWithExtension, logout, LoggedInUser } from '@/lib/ndk'

function RootLayout() {
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [user, setUser] = useState<LoggedInUser | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('nostrUser')
      if (saved) setUser(JSON.parse(saved))
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
      <div className="app">
        <header className="header">
          <div className="nav">
            <Link to="/" className="nav-link">
              <h1>nostrly</h1>
            </Link>
            <nav>
              <Link to="/" className="nav-link">Home</Link>
              <Link to="/profile" className="nav-link">Profile</Link>
              <Link to="/feed" className="nav-link">Feed</Link>
            </nav>
            <div>
              {user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {user.picture ? (
                    <img src={user.picture} alt="avatar" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                  ) : null}
                  <span style={{ color: '#ccc' }}>{user.name || user.npub.slice(0, 8) + '…'}</span>
                  <button onClick={handleLogout}>Logout</button>
                </div>
              ) : (
                <button onClick={() => setIsLoginOpen(true)}>Login</button>
              )}
            </div>
          </div>
        </header>
        <main className="main-content">
          <Outlet />
        </main>
      </div>

      {isLoginOpen && (
        <div className="modal-overlay" onClick={() => !isLoggingIn && setIsLoginOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Login with Nostr Extension</h3>
            </div>
            <p style={{ marginBottom: '1rem' }}>
              Connect using a NIP-07 compatible browser extension (e.g., Nos2x, Alby, Unisat, etc.).
            </p>
            {error && (
              <div style={{ color: '#ff6b6b', marginBottom: '0.75rem' }}>{error}</div>
            )}
            <div className="modal-actions">
              <button onClick={handleLogin} disabled={isLoggingIn}>
                {isLoggingIn ? 'Connecting…' : 'Connect Nostr Extension'}
              </button>
              <button className="btn-secondary" onClick={() => setIsLoginOpen(false)} disabled={isLoggingIn}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <TanStackRouterDevtools />
    </>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => (
    <div className="main-content">
      <h2>Something went wrong</h2>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{String(error)}</pre>
    </div>
  ),
  notFoundComponent: () => (
    <div className="main-content">
      <h2>Page not found</h2>
      <p>The page you are looking for does not exist.</p>
      <p>
        Go back to <Link to="/" className="nav-link">Home</Link>
      </p>
    </div>
  ),
})