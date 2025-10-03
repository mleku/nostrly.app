import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
} from '@tanstack/react-router'
import { Home } from './routes/Home'
import orlyImg from '../docs/orly.png'
import { nostrService, UserMetadata, NostrEvent } from './lib/nostr'
import EventFeed from './components/EventFeed'
import NoteCard from './components/NoteCard'
import ThreadView from './components/ThreadView'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

const HeaderRoute = createRootRoute({
  component: () => {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const dividerRef = useRef<HTMLDivElement | null>(null)
    const [leftPct, setLeftPct] = useState<number>(() => {
      // Load persisted position for wide screens
      const saved = localStorage.getItem('wideScreenLeftPct')
      return saved ? parseFloat(saved) : 50
    })
    const draggingRef = useRef(false)
    const downXRef = useRef(0)
    const movedRef = useRef(false)
    const MOVE_THRESHOLD = 4 // px

    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const sidebarWidthEm = sidebarCollapsed ? 2.5 : 12
    const sidebarWidth = `${sidebarWidthEm}em`

    // Active tab state for radio button behavior
    const [activeTab, setActiveTab] = useState<string>('Global')

    // Responsive divider width state
    const [isSmallScreen, setIsSmallScreen] = useState(false)
    
    // State for which panel is open in small screen mode ('main' or 'thread')
    const [smallScreenPanel, setSmallScreenPanel] = useState<'main' | 'thread'>(() => {
      const saved = localStorage.getItem('smallScreenPanel')
      return (saved === 'main' || saved === 'thread') ? saved : 'main'
    })
    
    // Remember the leftPct when switching to small screen
    const [largeScreenLeftPct, setLargeScreenLeftPct] = useState<number>(() => {
      // Load persisted position for wide screens
      const saved = localStorage.getItem('wideScreenLeftPct')
      return saved ? parseFloat(saved) : 50
    })
    
    // Remember the sidebar collapse state for small screens (default to collapsed/folded up)
    const [smallScreenSidebarCollapsed, setSmallScreenSidebarCollapsed] = useState<boolean>(true)
    const [largeScreenSidebarCollapsed, setLargeScreenSidebarCollapsed] = useState<boolean>(false)

    // Save smallScreenPanel to localStorage whenever it changes
    useEffect(() => {
      localStorage.setItem('smallScreenPanel', smallScreenPanel)
    }, [smallScreenPanel])

    // Save leftPct to localStorage for wide screens (>1024px) whenever it changes
    useEffect(() => {
      if (window.innerWidth > 1024) {
        localStorage.setItem('wideScreenLeftPct', leftPct.toString())
      }
    }, [leftPct])

    // Selected note state for thread panel
    const [selectedNote, setSelectedNote] = useState<NostrEvent | null>(null)
    const [selectedNoteMetadata, setSelectedNoteMetadata] = useState<UserMetadata | null>(null)

    // Minimal auth UI state + NIP-07 integration
    const [isLoggedIn, setIsLoggedIn] = useState(false)
    const [pubkey, setPubkey] = useState<string | null>(null)
    const [showLoginModal, setShowLoginModal] = useState(false)
    const [loginModalMsg, setLoginModalMsg] = useState<string>('')
    const [userMetadata, setUserMetadata] = useState<UserMetadata | null>(null)
    const [loadingMetadata, setLoadingMetadata] = useState(false)

    const username = userMetadata?.display_name || userMetadata?.name || (isLoggedIn ? 'you' : 'guest')
    const avatarEmoji = isLoggedIn ? '🙂' : '👤'

    // Handle note click to show in thread panel
    const handleNoteClick = useCallback(async (event: NostrEvent, metadata?: UserMetadata | null) => {
      setSelectedNote(event)
      setSelectedNoteMetadata(metadata || null)
      
      // If metadata is not provided, try to fetch it
      if (!metadata && event.pubkey) {
        try {
          const fetchedMetadata = await nostrService.fetchUserMetadata(event.pubkey)
          setSelectedNoteMetadata(fetchedMetadata)
        } catch (error) {
          console.warn('Failed to fetch metadata for selected note:', error)
        }
      }
      
      // Handle responsive behavior
      if (isSmallScreen) {
        setSmallScreenPanel('thread')
      } else {
        setLeftPct(50)
      }
    }, [isSmallScreen])

    // Check screen width on mount and resize
    useEffect(() => {
      const checkScreenWidth = () => {
        const wasSmallScreen = isSmallScreen
        const nowSmallScreen = window.innerWidth <= 1024
        
        if (wasSmallScreen && !nowSmallScreen) {
          // Transitioning from small to large screen - restore previous panel split and sidebar state
          setLeftPct(largeScreenLeftPct)
          setSidebarCollapsed(largeScreenSidebarCollapsed)
        } else if (!wasSmallScreen && nowSmallScreen) {
          // Transitioning from large to small screen - save current states and apply small screen defaults
          setLargeScreenLeftPct(leftPct)
          setLargeScreenSidebarCollapsed(sidebarCollapsed)
          setSidebarCollapsed(smallScreenSidebarCollapsed)
        } else if (nowSmallScreen) {
          // Already in small screen mode - apply the selected panel and sidebar state
          setLeftPct(smallScreenPanel === 'main' ? 100 : 0)
          setSidebarCollapsed(smallScreenSidebarCollapsed)
        } else {
          // Already in large screen mode - apply the saved sidebar state
          setSidebarCollapsed(largeScreenSidebarCollapsed)
        }
        
        setIsSmallScreen(nowSmallScreen)
      }
      
      checkScreenWidth()
      window.addEventListener('resize', checkScreenWidth)
      
      return () => window.removeEventListener('resize', checkScreenWidth)
    }, [isSmallScreen, leftPct, largeScreenLeftPct, smallScreenPanel, sidebarCollapsed, smallScreenSidebarCollapsed, largeScreenSidebarCollapsed])

    const handleLoginClick = useCallback(async () => {
      if (isLoggedIn) {
        // Logout
        setIsLoggedIn(false)
        setPubkey(null)
        setUserMetadata(null)
        return
      }

      // Login via NIP-07
      const nostr = (window as any).nostr as { getPublicKey?: () => Promise<string> } | undefined
      if (!nostr || typeof nostr.getPublicKey !== 'function') {
        setLoginModalMsg('No NIP-07 signer detected. Install a Nostr browser extension (e.g., Alby, nos2x) and try again.')
        setShowLoginModal(true)
        return
      }
      try {
        setLoginModalMsg('Requesting permission from your Nostr signer…')
        setShowLoginModal(true)
        const pk = await nostr.getPublicKey!()
        setPubkey(pk)
        setIsLoggedIn(true)
        setLoginModalMsg('Login successful! Fetching your profile…')
        
        // Fetch user metadata
        setLoadingMetadata(true)
        try {
          const metadata = await nostrService.fetchUserMetadata(pk)
          setUserMetadata(metadata)
          setLoginModalMsg('Login successful! Your profile has been loaded.')
        } catch (metadataError) {
          console.warn('Failed to fetch user metadata:', metadataError)
          setLoginModalMsg('Login successful! (Profile could not be loaded)')
        } finally {
          setLoadingMetadata(false)
        }
      } catch (err: any) {
        setLoginModalMsg(err?.message || 'Login was cancelled or failed. Please try again.')
        setShowLoginModal(true)
      }
    }, [isLoggedIn])

    const startDrag = useCallback((clientX: number) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      // Measure actual divider width to keep it visible even at extremes
      const dividerEl = dividerRef.current
      const dividerPx = dividerEl ? dividerEl.getBoundingClientRect().width : 0
      const usable = Math.max(0, rect.width - dividerPx)
      // X relative to left edge, clamped to usable area (excluding divider width)
      const x = clamp(clientX - rect.left, 0, usable)
      const pct = usable === 0 ? 0 : (x / usable) * 100
      setLeftPct(pct)
    }, [])

    useEffect(() => {
      const onMove = (e: MouseEvent) => {
        if (!draggingRef.current) return
        if (!movedRef.current && Math.abs(e.clientX - downXRef.current) > MOVE_THRESHOLD) {
          movedRef.current = true
        }
        if (movedRef.current) {
          startDrag(e.clientX)
        }
      }
      const onUp = () => {
        if (!draggingRef.current) return
        draggingRef.current = false
        document.body.style.userSelect = ''
        if (!movedRef.current) {
          setLeftPct(50)
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
    }, [startDrag])

    useEffect(() => {
      const onTouchMove = (e: TouchEvent) => {
        if (!draggingRef.current) return
        const t = e.touches[0]
        if (!t) return
        if (!movedRef.current && Math.abs(t.clientX - downXRef.current) > MOVE_THRESHOLD) {
          movedRef.current = true
        }
        if (movedRef.current) {
          startDrag(t.clientX)
        }
      }
      const onTouchEnd = () => {
        if (!draggingRef.current) return
        draggingRef.current = false
        document.body.style.userSelect = ''
        if (!movedRef.current) {
          setLeftPct(50)
        }
      }
      window.addEventListener('touchmove', onTouchMove, { passive: false })
      window.addEventListener('touchend', onTouchEnd)
      return () => {
        window.removeEventListener('touchmove', onTouchMove)
        window.removeEventListener('touchend', onTouchEnd)
      }
    }, [startDrag])

    const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
      draggingRef.current = true
      movedRef.current = false
      downXRef.current = e.clientX
      document.body.style.userSelect = 'none'
      // Do not resize yet; wait for movement threshold. Click will reset to 50% on mouseup.
    }, [])

    const onDividerTouchStart = useCallback((e: React.TouchEvent) => {
      if (!e.touches[0]) return
      draggingRef.current = true
      movedRef.current = false
      downXRef.current = e.touches[0].clientX
      document.body.style.userSelect = 'none'
      // Do not resize yet; wait for movement threshold. Tap will reset to 50% on touchend.
    }, [])

    const dividerWidth = isSmallScreen ? '0' : '2em'
    const gridStyle = useMemo<React.CSSProperties>(() => ({
      display: 'grid',
      // Use fractional units so the fixed divider stays fully visible even when a side is 0
      gridTemplateColumns: `${leftPct}fr ${dividerWidth} ${100 - leftPct}fr`,
    }), [leftPct, dividerWidth])

    return (
      <div className="min-h-screen bg-[#263238] text-[#CFD8DC] overflow-hidden">
        {/* Header */}
        <header className="fixed top-0 left-0 right-0 h-14 bg-black flex items-center pl-0 pr-4 z-50">
          <img src={orlyImg} alt="ORLY" className="w-14 h-14 object-cover block" />
          {/* Active tab indicator */}
          <div className="ml-4 text-[#CFD8DC] font-medium">
            {activeTab}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {/* User Profile Button (when logged in) */}
            {isLoggedIn && (
              <button
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#263238] hover:bg-[#37474F] transition-colors"
                title={`Profile: ${username}`}
              >
                {/* Avatar Circle */}
                <div
                  className="flex items-center justify-center rounded-full bg-[#455A64] overflow-hidden"
                  style={{ width: '1.75em', height: '1.75em' }}
                >
                  {userMetadata?.picture ? (
                    <img
                      src={userMetadata.picture}
                      alt="Profile"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // Fallback to emoji if image fails to load
                        e.currentTarget.style.display = 'none'
                        e.currentTarget.nextElementSibling!.textContent = avatarEmoji
                      }}
                    />
                  ) : (
                    <span className="text-sm">{avatarEmoji}</span>
                  )}
                </div>
                {/* Username */}
                <span className="text-sm text-[#CFD8DC] max-w-[8em] truncate">
                  {loadingMetadata ? 'Loading...' : username}
                </span>
              </button>
            )}
            
            {/* Login/Logout button */}
            <button
              aria-label={isLoggedIn ? 'Log out' : 'Log in'}
              title={isLoggedIn ? 'Log out' : 'Log in'}
              className="flex items-center justify-center"
              style={{ width: '2.25em', height: '2.25em', padding: 0 }}
              onClick={handleLoginClick}
            >
              {/* SVG icon: box with arrow entering/exiting to the right */}
              {isLoggedIn ? (
                // Logout: arrow going out of the box to the right
                <svg width="1.5em" height="1.5em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="5" width="12" height="14" rx="2" stroke="var(--main-fg)" strokeWidth="2" />
                  <path d="M13 12H21" stroke="var(--main-fg)" strokeWidth="2" strokeLinecap="round" />
                  <path d="M17 8L21 12L17 16" stroke="var(--main-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                // Login: arrow going right into the box
                <svg width="1.5em" height="1.5em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="9" y="5" width="12" height="14" rx="2" stroke="var(--main-fg)" strokeWidth="2" />
                  <path d="M3 12H11" stroke="var(--main-fg)" strokeWidth="2" strokeLinecap="round" />
                  <path d="M7 8L11 12L7 16" stroke="var(--main-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {/* Login modal overlay */}
        {showLoginModal && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[100] flex items-center justify-center"
          >
            <div
              className="absolute inset-0 bg-black"
            />
            <div
              className="relative z-[101] bg-[#263238] text-[#CFD8DC] max-w-md w-[90%] p-4"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl" aria-hidden>🔑</div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold mb-2">Nostr Signer</h2>
                  <p className="mb-3">{loginModalMsg || 'You can log in if you have a NIP-07 signer extension installed in your browser.'}</p>
                  {!isLoggedIn && (
                    <div className="text-sm opacity-80">
                      If you don’t have one installed, try Alby or nos2x and reload this page.
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setShowLoginModal(false)}>Ok</button>
              </div>
            </div>
          </div>
        )}

        {/* Left Sidebar */}
        <div
          className="fixed top-14 left-0 bottom-0 z-40 bg-black text-white flex flex-col justify-between"
          style={{ width: sidebarWidth }}
        >
          {/* Tabs at the very top */}
          <div className="flex flex-col" style={{ gap: '0.5em' }}>
            {/* Note - very top */}
            <div
              className={`flex items-center w-full cursor-pointer ${activeTab === 'Note' ? 'bg-[#263238]' : 'bg-[#131A1D]'} text-[#CFD8DC] ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
              style={{ height: '2.5em' }}
              aria-label="Note"
              title="Note"
              onClick={() => setActiveTab('Note')}
            >
              {/* Avatar circle (author = logged-in user) */}
              <span
                className={sidebarCollapsed ? '' : 'mr-2'}
                style={{ width: '2em', height: '2em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                aria-hidden
              >
                <span style={{ width: '1.5em', height: '1.5em', borderRadius: '9999px', background: '#455A64', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{avatarEmoji}</span>
              </span>
              {!sidebarCollapsed && (
                <span className="flex items-center">
                  <span aria-hidden className="mr-1">📝</span>
                  note
                </span>
              )}
            </div>

            {/* Above Global */}
            <div
              className={`flex items-center w-full cursor-pointer ${activeTab === 'Hashtag' ? 'bg-[#263238]' : 'bg-[#131A1D]'} text-[#CFD8DC] ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
              style={{ height: '2.5em' }}
              aria-label="Hashtag"
              title="Hashtag"
              onClick={() => setActiveTab('Hashtag')}
            >
              <span
                className={sidebarCollapsed ? '' : 'mr-2'}
                style={{ width: '2em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25em' }}
                aria-hidden
              >
                #
              </span>
              {!sidebarCollapsed && <span>Hashtag</span>}
            </div>

            <div
              className={`flex items-center w-full cursor-pointer ${activeTab === 'User' ? 'bg-[#263238]' : 'bg-[#131A1D]'} text-[#CFD8DC] ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
              style={{ height: '2.5em' }}
              aria-label="User"
              title="User"
              onClick={() => setActiveTab('User')}
            >
              {/* Avatar circle */}
              <span
                className={sidebarCollapsed ? '' : 'mr-2'}
                style={{ width: '2em', height: '2em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                aria-hidden
              >
                <span style={{ width: '1.5em', height: '1.5em', borderRadius: '9999px', background: '#455A64', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>👤</span>
              </span>
              {!sidebarCollapsed && <span>username</span>}
            </div>

            <div
              className={`flex items-center w-full cursor-pointer ${activeTab === 'Relay' ? 'bg-[#263238]' : 'bg-[#131A1D]'} text-[#CFD8DC] ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
              style={{ height: '2.5em' }}
              aria-label="Relay"
              title="example.com"
              onClick={() => setActiveTab('Relay')}
            >
              <span
                className={sidebarCollapsed ? '' : 'mr-2'}
                style={{ width: '2em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                aria-hidden
              >
                🖧
              </span>
              {!sidebarCollapsed && <div className="overflow-hidden">wss://example.com</div>}
            </div>

            {/* Global */}
            <div
              className={`flex items-center w-full cursor-pointer ${activeTab === 'Global' ? 'bg-[#263238]' : 'bg-[#131A1D]'} text-[#CFD8DC] ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
              style={{ height: '2.5em' }}
              aria-label="Global"
              title="Global"
              onClick={() => setActiveTab('Global')}
            >
              <span
                className={sidebarCollapsed ? '' : 'mr-2'}
                style={{ width: '2em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                aria-hidden
              >
                🌐
              </span>
              {!sidebarCollapsed && <span>Global</span>}
            </div>

            {/* Below Global */}
            <div
              className={`flex items-center w-full cursor-pointer ${activeTab === 'Follows' ? 'bg-[#263238]' : 'bg-[#131A1D]'} text-[#CFD8DC] ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
              style={{ height: '2.5em' }}
              aria-label="Follows"
              title="Follows"
              onClick={() => setActiveTab('Follows')}
            >
              <span
                className={sidebarCollapsed ? '' : 'mr-2'}
                style={{ width: '2em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                aria-hidden
              >
                👥
              </span>
              {!sidebarCollapsed && <span>Follows</span>}
            </div>

            <div
              className={`flex items-center w-full cursor-pointer ${activeTab === 'Write' ? 'bg-[#263238]' : 'bg-[#131A1D]'} text-[#CFD8DC] ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
              style={{ height: '2.5em' }}
              aria-label="Write"
              title="Write"
              onClick={() => setActiveTab('Write')}
            >
              <span
                className={sidebarCollapsed ? '' : 'mr-2'}
                style={{ width: '2em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                aria-hidden
              >
                ✍️
              </span>
              {!sidebarCollapsed && <span>Write</span>}
            </div>
          </div>

          {/* Bottom control strip */}
          <div className="bg-[#263238]">
            <div
              className="flex items-center justify-center bg-black text-white"
              style={{ width: '2.5em', height: '2.5em' }}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => {
                const newCollapsedState = !sidebarCollapsed;
                setSidebarCollapsed(newCollapsedState);
                // Save the state to the appropriate screen-size-specific variable
                if (isSmallScreen) {
                  setSmallScreenSidebarCollapsed(newCollapsedState);
                } else {
                  setLargeScreenSidebarCollapsed(newCollapsedState);
                }
              }}
            >
              <span aria-hidden>{sidebarCollapsed ? '▶' : '◀'}</span>
            </div>
          </div>
        </div>

        {/* Resizable two panes below header with a grabber divider */}
        <section ref={containerRef} className="fixed top-14 left-0 right-0 bottom-0" style={{ ...gridStyle, left: sidebarWidth }}>
          {/* Left: main */}
          <div className="pane overflow-y-scroll">
            {activeTab === 'Global' && <EventFeed feedType="global" onNoteClick={handleNoteClick} />}
            {activeTab === 'Follows' && <EventFeed feedType="follows" onNoteClick={handleNoteClick} userPubkey={pubkey} />}
            {activeTab === 'Note' && <EventFeed feedType="note" onNoteClick={handleNoteClick} />}
            {activeTab === 'Hashtag' && <EventFeed feedType="hashtag" onNoteClick={handleNoteClick} />}
            {activeTab === 'User' && <EventFeed feedType="user" onNoteClick={handleNoteClick} />}
            {activeTab === 'Relay' && <EventFeed feedType="relay" onNoteClick={handleNoteClick} />}
            {activeTab === 'Write' && (
              <div className="h-full flex items-center justify-center">
                <span className="text-xl tracking-wide">Write new note</span>
              </div>
            )}
          </div>

        {/* Divider / grabber */}
          <div
            ref={dividerRef}
            className="relative bg-transparent cursor-col-resize"
            style={{ width: dividerWidth }}
            onMouseDown={onDividerMouseDown}
            onTouchStart={onDividerTouchStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
          >
            {/* Center reset button (2em square) inside divider */}
            {!isSmallScreen && (
              <button
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40"
                style={{ width: '2em', height: '2em', background: 'transparent', border: 'none', padding: 0, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25em' }}
                aria-label="Restore 50-50 split"
                title="Restore 50-50 split"
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setLeftPct(50); }}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
              >
                {/* Two inward-pointing arrows using border-based triangles */}
                <span aria-hidden style={{ display: 'block', width: 0, height: 0, borderStyle: 'solid', borderWidth: '0.5em 0 0.5em 0.75em', borderColor: 'transparent transparent transparent var(--main-fg)' }} />
                <span aria-hidden style={{ display: 'block', width: 0, height: 0, borderStyle: 'solid', borderWidth: '0.5em 0.75em 0.5em 0', borderColor: 'transparent var(--main-fg) transparent transparent' }} />
              </button>
            )}

            {/* Floating maximize-left tab (2em transparent square) on the right side, centered */}
            <button
              className="absolute top-1/2 -translate-y-1/2 left-full z-50"
              style={{ width: '2em', height: '2em', background: 'transparent', border: 'none', padding: 0, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Maximize left panel"
              title="Maximize left panel"
              onClick={(e) => { 
                e.stopPropagation(); 
                e.preventDefault(); 
                if (isSmallScreen) {
                  setSmallScreenPanel('main');
                } else {
                  setLeftPct(100);
                }
              }}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
            >
              {/* Left-pointing triangle in primary text color */}
              <span aria-hidden style={{ display: 'block', width: 0, height: 0, borderStyle: 'solid', borderWidth: '0.5em 0 0.5em 0.75em', borderColor: 'transparent transparent transparent var(--main-fg)' }} />
            </button>

            {/* Floating maximize-right tab (2em transparent square) on the left side, centered */}
            <button
              className="absolute top-1/2 -translate-y-1/2 right-full z-50"
              style={{ width: '2em', height: '2em', background: 'transparent', border: 'none', padding: 0, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Maximize right panel"
              title="Maximize right panel"
              onClick={(e) => { 
                e.stopPropagation(); 
                e.preventDefault(); 
                if (isSmallScreen) {
                  setSmallScreenPanel('thread');
                } else {
                  setLeftPct(0);
                }
              }}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
            >
              {/* Right-pointing triangle in primary text color */}
              <span aria-hidden style={{ display: 'block', width: 0, height: 0, borderStyle: 'solid', borderWidth: '0.5em 0.75em 0.5em 0', borderColor: 'transparent var(--main-fg) transparent transparent' }} />
            </button>

            {/* Visual grabber dots */}
            {/*<div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 flex flex-col gap-1">*/}
            {/*  <span className="block w-1 h-1 bg-[#00BCD4] rounded" />*/}
            {/*  <span className="block w-1 h-1 bg-[#00BCD4] rounded" />*/}
            {/*  <span className="block w-1 h-1 bg-[#00BCD4] rounded" />*/}
            {/*</div>*/}
          </div>

          {/* Right: thread */}
          <div className="pane overflow-y-scroll bg-[#263238]">
            {selectedNote ? (
              <ThreadView
                focusedEvent={selectedNote}
                focusedEventMetadata={selectedNoteMetadata}
                onNoteClick={handleNoteClick}
                onClose={() => {
                  if (isSmallScreen) {
                    setSmallScreenPanel('main')
                  } else {
                    setSelectedNote(null)
                    setSelectedNoteMetadata(null)
                  }
                }}
                headerLeft={isSmallScreen ? '0' : `calc(${sidebarWidthEm}em + ${leftPct}vw - ${sidebarWidthEm * leftPct / 100}em + ${isSmallScreen ? '0em' : '2em'})`}
                headerWidth={isSmallScreen ? '100vw' : `calc(${100 - leftPct}vw - ${sidebarWidthEm * (100 - leftPct) / 100}em - ${isSmallScreen ? '0em' : '2em'})`}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <span className="text-xl tracking-wide text-gray-400">Select a note to view thread</span>
              </div>
            )}
          </div>
        </section>
      </div>
    )
  },
})

const MainViewRoute = createRoute({
  getParentRoute: () => HeaderRoute,
  path: '/',
  component: Home,
})

const routeTree = HeaderRoute.addChildren([MainViewRoute])

export const router = createRouter({
  routeTree,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
