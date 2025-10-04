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
import NotesFilterPanel, { FilterMode } from './components/NotesFilterPanel'
import ProfileView from './components/ProfileView'
import { useQueryClient } from '@tanstack/react-query'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

const HeaderRoute = createRootRoute({
  component: () => {
    const queryClient = useQueryClient()
    const containerRef = useRef<HTMLDivElement | null>(null)
    const dividerRef = useRef<HTMLDivElement | null>(null)
    const leftPaneRef = useRef<HTMLDivElement | null>(null)
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
    
    // User tabs state for dynamic user profiles
    interface UserTab {
      id: string
      pubkey: string
      metadata: UserMetadata | null
      displayName: string
    }
    const [userTabs, setUserTabs] = useState<UserTab[]>([])
    const [activeUserTabId, setActiveUserTabId] = useState<string | null>(null)

    // Filter mode state for notes/replies filtering
    const [filterMode, setFilterMode] = useState<FilterMode>('replies')

    // Responsive divider width state
    const [isSmallScreen, setIsSmallScreen] = useState(false)

    // State for which panel is open in small screen mode ('main' or 'thread')
    const [smallScreenPanel, setSmallScreenPanel] = useState<'main' | 'thread'>(() => {
      const saved = localStorage.getItem('smallScreenPanel')
      return (saved === 'main' || saved === 'thread') ? saved : 'main'
    })

    // State to control ThreadView header visibility in narrow screen mode
    const [hideThreadHeader, setHideThreadHeader] = useState(false)

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

    // Switch to Follows tab when user logs in
    useEffect(() => {
      if (isLoggedIn && activeTab === 'Global') {
        setActiveTab('Follows')
      }
    }, [isLoggedIn, activeTab])

    // Custom handler to clear view before changing filter mode
    const handleModeChange = useCallback((newMode: FilterMode) => {
      // Clear all event queries to remove entries from view
      queryClient.removeQueries({ queryKey: ['events'] })

      // Set new filter mode after clearing
      setFilterMode(newMode)
    }, [queryClient])

    // Auto-login with signer on mount
    useEffect(() => {
      const attemptAutoLogin = async () => {
        // Don't auto-login if already logged in
        if (isLoggedIn) return

        // Check for NIP-07 signer
        const nostr = (window as any).nostr as { getPublicKey?: () => Promise<string> } | undefined
        if (!nostr || typeof nostr.getPublicKey !== 'function') {
          return // No signer available, skip auto-login
        }

        try {
          // Attempt to get public key without showing any UI
          const pk = await nostr.getPublicKey!()
          setPubkey(pk)
          setIsLoggedIn(true)

          // Fetch user metadata in background
          setLoadingMetadata(true)
          try {
            const metadata = await nostrService.fetchUserMetadata(pk)
            setUserMetadata(metadata)
          } catch (metadataError) {
            console.warn('Failed to fetch user metadata during auto-login:', metadataError)
          } finally {
            setLoadingMetadata(false)
          }
        } catch (err: any) {
          // Auto-login failed silently - user can still manually log in
          console.log('Auto-login failed:', err?.message || 'Unknown error')
        }
      }

      attemptAutoLogin()
    }, [isLoggedIn])

    // Handle note click to show in thread panel
    const handleNoteClick = useCallback(async (event: NostrEvent, metadata?: UserMetadata | null) => {
      setSelectedNote(event)
      setSelectedNoteMetadata(metadata || null)
      
      // Reset thread header visibility when selecting a new note
      setHideThreadHeader(false)

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

    // Handle user click to open profile
    const handleUserClick = useCallback(async (pubkey: string, metadata?: UserMetadata | null) => {
      // Clear all event queries to refresh the note thread view (same as filter buttons)
      queryClient.removeQueries({ queryKey: ['events'] })
      
      // Check if tab for this user already exists
      const existingTab = userTabs.find(tab => tab.pubkey === pubkey)
      
      if (existingTab) {
        // Switch to existing tab
        setActiveTab('UserProfile')
        setActiveUserTabId(existingTab.id)
        return
      }
      
      // Create new tab for this user
      const tabId = `user-${pubkey.slice(0, 8)}-${Date.now()}`
      let userMetadata = metadata
      
      // If we don't have metadata, try to fetch it
      if (!metadata) {
        try {
          userMetadata = await nostrService.fetchUserMetadata(pubkey)
        } catch (error) {
          console.warn('Failed to fetch user metadata:', error)
        }
      }
      
      const displayName = userMetadata?.display_name || userMetadata?.name || `${pubkey.slice(0, 8)}...`
      
      const newTab: UserTab = {
        id: tabId,
        pubkey,
        metadata: userMetadata,
        displayName
      }
      
      // Add new tab and switch to it
      setUserTabs(prev => [...prev, newTab])
      setActiveTab('UserProfile')
      setActiveUserTabId(tabId)
    }, [userTabs, queryClient])

    // Function to close a user tab
    const closeUserTab = useCallback((tabId: string) => {
      setUserTabs(prev => {
        const newTabs = prev.filter(tab => tab.id !== tabId)
        // If we're closing the active tab, switch to Global
        if (activeUserTabId === tabId) {
          setActiveTab('Global')
          setActiveUserTabId(null)
        }
        return newTabs
      })
    }, [activeUserTabId])

    // Check screen width on mount and resize
    useEffect(() => {
      const checkScreenWidth = () => {
        const wasSmallScreen = isSmallScreen
        const nowSmallScreen = window.innerWidth <= 1024

        if (wasSmallScreen && !nowSmallScreen) {
          // Transitioning from small to large screen - restore previous panel split and sidebar state
          // If no thread is open, fold the thread panel closed
          if (!selectedNote) {
            setLeftPct(100)
          } else {
            setLeftPct(largeScreenLeftPct)
          }
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
          // If no thread is open, fold the thread panel closed
          if (!selectedNote) {
            setLeftPct(100)
          }
          setSidebarCollapsed(largeScreenSidebarCollapsed)
        }

        setIsSmallScreen(nowSmallScreen)
      }

      checkScreenWidth()
      window.addEventListener('resize', checkScreenWidth)

      return () => window.removeEventListener('resize', checkScreenWidth)
    }, [isSmallScreen, leftPct, largeScreenLeftPct, smallScreenPanel, sidebarCollapsed, smallScreenSidebarCollapsed, largeScreenSidebarCollapsed, selectedNote])

    const handleLoginClick = useCallback(async () => {
      if (isLoggedIn) {
        // Logout - clear all user-related state and cached data
        setIsLoggedIn(false)
        setPubkey(null)
        setUserMetadata(null)
        setLoadingMetadata(false)
        setShowLoginModal(false)
        setLoginModalMsg('')
        
        // Clear any selected note/thread that might be user-specific
        setSelectedNote(null)
        setSelectedNoteMetadata(null)
        
        // Clear all cached queries (including user-specific data like follows, metadata, etc.)
        queryClient.clear()
        
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

    // Handle clicking on empty space in the left pane to scroll to top
    const handleLeftPaneClick = useCallback((e: React.MouseEvent) => {
      // Only scroll to top if clicking directly on the pane (not on child elements)
      if (e.target === e.currentTarget && leftPaneRef.current) {
        leftPaneRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }, [])

    const dividerWidth = isSmallScreen || !selectedNote || leftPct === 100 ? '0' : '2em'
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
                onClick={() => setActiveTab('Profile')}
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
            {/* Dynamic User Tabs - appear at the top */}
            {userTabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex items-center w-full cursor-pointer ${activeTab === 'UserProfile' && activeUserTabId === tab.id ? 'bg-[#263238]' : 'bg-[#131A1D]'} text-[#CFD8DC] ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
                style={{ height: '2.5em' }}
                aria-label={`User: ${tab.displayName}`}
                title={`User: ${tab.displayName}`}
                onClick={() => {
                  setActiveTab('UserProfile')
                  setActiveUserTabId(tab.id)
                }}
              >
                {/* Avatar circle */}
                <span
                  className={sidebarCollapsed ? '' : 'mr-2'}
                  style={{ width: '2em', height: '2em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  aria-hidden
                >
                  {tab.metadata?.picture ? (
                    <img
                      src={tab.metadata.picture}
                      alt={tab.displayName}
                      className="w-6 h-6 rounded-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <span style={{ width: '1.5em', height: '1.5em', borderRadius: '9999px', background: '#455A64', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {tab.displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                {!sidebarCollapsed && (
                  <div className="flex items-center justify-between w-full">
                    <span className="truncate max-w-[6em]">{tab.displayName}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        closeUserTab(tab.id)
                      }}
                      className="ml-1 w-4 h-4 rounded-full bg-[#37474F] hover:bg-[#455A64] flex items-center justify-center text-xs transition-colors"
                      title="Close tab"
                      aria-label="Close tab"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}

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
          <div className="bg-black">
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
          <div ref={leftPaneRef} className="pane overflow-y-scroll" onClick={handleLeftPaneClick}>
            <NotesFilterPanel 
              activeMode={filterMode} 
              onModeChange={handleModeChange} 
              selectedNote={selectedNote}
              isThreadOpen={!isSmallScreen && selectedNote && leftPct !== 100}
              onThreadClick={() => {
                if (isSmallScreen) {
                  const newPanel = smallScreenPanel === 'thread' ? 'main' : 'thread'
                  setSmallScreenPanel(newPanel)
                  // Reset thread header visibility when switching back to thread
                  if (newPanel === 'thread') {
                    setHideThreadHeader(false)
                  }
                } else {
                  setLeftPct(leftPct === 100 ? 50 : 100)
                }
              }}
            />
            {activeTab === 'Global' && <EventFeed feedType="global" onNoteClick={handleNoteClick} onUserClick={handleUserClick} filterMode={filterMode} />}
            {activeTab === 'Follows' && <EventFeed feedType="follows" onNoteClick={handleNoteClick} onUserClick={handleUserClick} userPubkey={pubkey} filterMode={filterMode} />}
            {activeTab === 'Note' && <EventFeed feedType="note" onNoteClick={handleNoteClick} onUserClick={handleUserClick} filterMode={filterMode} />}
            {activeTab === 'Hashtag' && <EventFeed feedType="hashtag" onNoteClick={handleNoteClick} onUserClick={handleUserClick} filterMode={filterMode} />}
            {activeTab === 'User' && <EventFeed feedType="user" onNoteClick={handleNoteClick} onUserClick={handleUserClick} filterMode={filterMode} />}
            {activeTab === 'Relay' && <EventFeed feedType="relay" onNoteClick={handleNoteClick} onUserClick={handleUserClick} filterMode={filterMode} />}
            {activeTab === 'Profile' && isLoggedIn && pubkey && (
              <ProfileView 
                pubkey={pubkey} 
                metadata={userMetadata} 
                onNoteClick={handleNoteClick}
                filterMode={filterMode}
                onClose={() => setActiveTab('Global')}
              />
            )}
            {activeTab === 'UserProfile' && activeUserTabId && (() => {
              const activeUserTab = userTabs.find(tab => tab.id === activeUserTabId)
              return activeUserTab ? (
                <ProfileView 
                  pubkey={activeUserTab.pubkey} 
                  metadata={activeUserTab.metadata} 
                  onNoteClick={handleNoteClick}
                  filterMode={filterMode}
                  onClose={() => closeUserTab(activeUserTab.id)}
                />
              ) : null
            })()}
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
            {!isSmallScreen && selectedNote && leftPct === 0 && (
              <button
                className="absolute top-0 z-40"
                style={{ width: '2em', height: '2em', background: 'transparent', border: 'none', padding: 0, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25em', opacity: 0.5 }}
                aria-label="Restore 50-50 split"
                title="Restore 50-50 split"
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setLeftPct(50); }}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
              >
                <span aria-hidden style={{ display: 'block', width: 0, height: 0, borderStyle: 'solid', borderWidth: '0.5em 0.75em 0.5em 0', borderColor: 'transparent var(--main-fg) transparent transparent' }} />
              </button>
            )}


            {/* Floating maximize-right tab (2em transparent square) on the left side, centered */}
            {selectedNote && leftPct === 0 && (
              <button
                className="absolute top-1/2 -translate-y-1/2 right-full z-50"
                style={{ width: '2em', height: '2em', background: 'transparent', border: 'none', padding: 0, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}
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
                  <span aria-hidden style={{ display: 'block', width: 0, height: 0, borderStyle: 'solid', borderWidth: '0.5em 0.75em 0.5em 0', borderColor: 'transparent transparent transparent var(--main-fg)' }} />
              </button>
            )}

            {/* Left-pointing triangle button when thread view is hidden */}
            {!isSmallScreen && selectedNote && leftPct === 100 && (
              <button
                className="absolute left-full z-50"
                style={{ 
                  top: '3.5rem',
                  width: '2em', 
                  height: '2em', 
                  background: 'rgba(255, 255, 255, 0.1)', 
                  border: '1px solid rgba(255, 255, 255, 0.2)', 
                  padding: 0, 
                  borderRadius: '50%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  opacity: 0.8 
                }}
                aria-label="Show thread panel"
                title="Show thread panel"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setLeftPct(50);
                }}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
              >
                {/* Left-pointing triangle in primary text color */}
                <span aria-hidden style={{ display: 'block', width: 0, height: 0, borderStyle: 'solid', borderWidth: '0.5em 0 0.5em 0.75em', borderColor: 'transparent transparent transparent var(--main-fg)' }} />
              </button>
            )}
          </div>

          {/* Right: thread */}
          <div className="pane overflow-y-scroll bg-[#263238] relative">
            {selectedNote ? (
              <ThreadView
                focusedEvent={selectedNote}
                focusedEventMetadata={selectedNoteMetadata}
                onNoteClick={handleNoteClick}
                onClose={() => {
                  if (isSmallScreen) {
                    setHideThreadHeader(false)
                    setSmallScreenPanel('main')
                  } else {
                    setLeftPct(100)
                  }
                  setSelectedNote(null)
                  setSelectedNoteMetadata(null)
                }}
                onMaximizeLeft={() => {
                  if (isSmallScreen) {
                    setHideThreadHeader(true)
                    setSmallScreenPanel('main')
                  } else {
                    setLeftPct(100)
                  }
                }}
                headerLeft={isSmallScreen ? `${sidebarWidthEm}em` : `calc(${sidebarWidthEm}em + ${leftPct}% + ${dividerWidth})`}
                headerWidth={isSmallScreen ? `calc(100vw - ${sidebarWidthEm}em)` : `calc(${100 - leftPct}% - ${dividerWidth})`}
                hideHeader={isSmallScreen && hideThreadHeader || !selectedNote || (!isSmallScreen && leftPct === 100)}
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
