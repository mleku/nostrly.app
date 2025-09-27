import { useEffect, useMemo, useRef, useState } from 'react'
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { loginWithExtension, logout, LoggedInUser, applyUserRelays } from '@/lib/ndk'
import orlyImg from '../../docs/orly.png'

function RootLayout() {
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [user, setUser] = useState<LoggedInUser | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<string | null>(null)
  // Hashtag search UI state
  const [isHashtagSearchOpen, setIsHashtagSearchOpen] = useState(false)
  const [hashtagCache, setHashtagCache] = useState<string[]>([])
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

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

  // Listen for active view change events from the feed page
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ label?: string }>
      const label = (ce as any).detail?.label as string | undefined
      setActiveView(label || null)
    }
    const onTags = (e: Event) => {
      try {
        const ce = e as CustomEvent<{ tags?: string[] }>
        const list = (ce as any).detail?.tags as string[] | undefined
        if (Array.isArray(list)) setHashtagCache(list)
      } catch {}
    }
    window.addEventListener('nostr-active-view', handler as any)
    window.addEventListener('nostr-hashtags-cache', onTags as any)
    return () => {
      window.removeEventListener('nostr-active-view', handler as any)
      window.removeEventListener('nostr-hashtags-cache', onTags as any)
    }
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
      try { window.dispatchEvent(new CustomEvent('nostr-user-changed', { detail: logged })) } catch {}
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
    setActiveView(null)
    localStorage.removeItem('nostrUser')
    try { window.dispatchEvent(new CustomEvent('nostr-user-changed', { detail: null })) } catch {}
  }

  // Filtered suggestions based on searchText
  const suggestions = useMemo(() => {
    const q = searchText.trim().replace(/^#/, '').toLowerCase()
    if (!q) return hashtagCache
    return hashtagCache.filter(t => t.includes(q))
  }, [searchText, hashtagCache])

  useEffect(() => {
    if (isHashtagSearchOpen) {
      setTimeout(() => { try { inputRef.current?.focus() } catch {} }, 0)
    }
  }, [isHashtagSearchOpen])

  const submitHashtag = (raw: string) => {
    const clean = (raw || '').trim().replace(/^#/, '')
    if (!clean) return
    try { window.dispatchEvent(new CustomEvent('nostr-open-hashtag', { detail: { tag: '#' + clean } })) } catch {}
    setIsHashtagSearchOpen(false)
    setSearchText('')
  }

  return (
    <>
      <div className="min-h-screen flex flex-col bg-[#162a2f] text-[#cccccc]">
        <header className="sticky top-0 z-50 w-full bg-black h-12">
          <div className="w-full sm:pl-3 pr-0 py-0 flex items-center">
            <Link to="/" className="no-underline flex items-center">
              <img src={orlyImg} alt="nostrly owl" style={{ width: '3em', height: '3em', objectFit: 'contain' }} />
              <h1 className="text-[#fff3b0] text-2xl font-bold">{user ? (activeView || 'nostrly') : 'nostrly'}</h1>
            </Link>
            <div className="flex-1 px-2">
              {!isHashtagSearchOpen ? (
                <div />
              ) : (
                <div className="relative">
                  <div className="flex items-center gap-2 h-10 px-3 rounded bg-[#162a2f] text-[#cccccc]">
                    <SearchIcon className="w-5 h-5 text-[#cccccc]" />
                    <input
                      ref={inputRef}
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); submitHashtag(searchText) }
                        if (e.key === 'Escape') { setIsHashtagSearchOpen(false); setSearchText('') }
                      }}
                      placeholder="Search…"
                      className="flex-1 bg-transparent outline-none placeholder-[#9aa0a6]"
                    />
                  </div>
                  {suggestions.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 max-h-64 overflow-auto bg-black border border-black rounded shadow-modal z-50">
                      {suggestions.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => submitHashtag(t)}
                          className="w-full text-left px-3 py-2 hover:bg-[#1b3a40]"
                          title={`Open #${t}`}
                        >
                          #{t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-stretch gap-2 pr-2">
              {!isHashtagSearchOpen && (
                <button
                  type="button"
                  onClick={() => setIsHashtagSearchOpen(true)}
                  className="w-12 h-full bg-transparent text-[#cccccc] hover:bg-transparent flex items-center justify-center"
                  title="Search hashtags"
                  aria-label="Search"
                >
                  <SearchIcon className="w-full h-full p-2" />
                </button>
              )}
              {user ? (
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => { try { window.dispatchEvent(new CustomEvent('nostr-open-me')) } catch {} }}
                    className={`${activeView === 'Me' ? 'bg-[#162a2f]' : 'bg-transparent'} flex items-center gap-2 h-full p-2`}
                    title="Open your profile"
                    aria-label="Open your profile"
                    aria-current={activeView === 'Me' ? 'page' : undefined}
                  >
                    {user.picture ? (
                      <img src={user.picture} alt="avatar" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                    ) : null}
                    <span className="text-[#cccccc] whitespace-nowrap">{user.name || user.npub.slice(0, 8) + '…'}</span>
                  </button>
                  <button onClick={handleLogout} aria-label="Logout" title="Logout" className="w-12 h-full bg-red-600 text-white flex items-center justify-center rounded-none hover:bg-red-700 disabled:opacity-60">
                    <ExitIcon className="w-full h-full p-2" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setIsLoginOpen(true)} aria-label="Login" title="Login" className="w-12 h-full bg-green-600 text-white flex items-center justify-center rounded-none hover:bg-green-700 disabled:opacity-60">
                  <EnterIcon className="w-full h-full p-2" />
                </button>
              )}
            </div>
          </div>
        </header>
        <main className="flex w-full pt-0 pb-2">
          <Outlet />
        </main>
      </div>

      {isHashtagSearchOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={() => { setIsHashtagSearchOpen(false); setSearchText('') }}
          aria-label="Close hashtag search"
          aria-hidden={!isHashtagSearchOpen}
        />
      )}

      {isLoginOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]" onClick={() => !isLoggingIn && setIsLoginOpen(false)}>
          <div className="w-[90%] max-w-[480px] bg-[#162a2f] rounded-xl p-5 shadow-modal" onClick={(e) => e.stopPropagation()}>
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

function ExitIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Door frame */}
      <rect x="3" y="3" width="8" height="18" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 12h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Running figure */}
      <circle cx="15.5" cy="7" r="1.5" fill="currentColor" />
      <path d="M14 12l2-2m-2 2-1.5 2.5M16 10l2 1.5M12.5 16.5l2.5.5M12 9.5l2 .5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Exit arrow */}
      <path d="M13 12h7m0 0-2-2m2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EnterIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Door frame on the right */}
      <rect x="13" y="3" width="8" height="18" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17 12h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Running figure approaching the door */}
      <circle cx="8.5" cy="7" r="1.5" fill="currentColor" />
      <path d="M10 12l-2-2m2 2 1.5 2.5M8 10l-2 1.5M11.5 16.5l-2.5.5M12 9.5l-2 .5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Enter arrow toward the door */}
      <path d="M11 12h-7m0 0 2-2m-2 2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
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