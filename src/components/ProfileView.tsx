import React, { useEffect, useRef, useState } from 'react'
import { nostrService, UserMetadata, NostrEvent } from '../lib/nostr'
import EventFeed from './EventFeed'
import { FilterMode } from './NotesFilterPanel'

interface ProfileViewProps {
  pubkey: string
  metadata: UserMetadata | null
  onNoteClick: (event: NostrEvent, metadata?: UserMetadata | null) => void
  onUserClick?: (pubkey: string, metadata?: UserMetadata | null) => void
  filterMode: FilterMode
  mutedPubkeys?: string[]
  onClose: () => void
}

const ProfileView: React.FC<ProfileViewProps> = ({
  pubkey,
  metadata,
  onNoteClick,
  onUserClick,
  filterMode,
  mutedPubkeys = [],
  onClose
}) => {
  const [profileMetadata, setProfileMetadata] = useState<UserMetadata | null>(metadata)
  const [loading, setLoading] = useState(!metadata)
  const headerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Scroll to top when profile opens or changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [pubkey])

  // Fetch profile metadata if not provided
  useEffect(() => {
    if (!metadata) {
      const fetchProfile = async () => {
        setLoading(true)
        try {
          const fetchedMetadata = await nostrService.fetchUserMetadata(pubkey)
          setProfileMetadata(fetchedMetadata)
        } catch (error) {
          console.error('Failed to fetch profile metadata:', error)
        } finally {
          setLoading(false)
        }
      }
      fetchProfile()
    } else {
      setProfileMetadata(metadata)
      setLoading(false)
    }
  }, [pubkey, metadata])

  const displayName = profileMetadata?.display_name || profileMetadata?.name || 'Unknown User'
  const username = profileMetadata?.name || profileMetadata?.display_name || 'unknown'
  const avatar = profileMetadata?.picture
  const banner = profileMetadata?.banner
  const about = profileMetadata?.about

  return (
    <div className="h-full flex flex-col relative">
      {/* Sticky Header with Profile Info */}
      <div 
        ref={headerRef}
        className="sticky top-0 z-10 bg-[#263238] border-b border-[#37474F]"
        style={{ 
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Banner */}
        {banner && (
          <div className="h-32 w-full bg-cover bg-center relative" style={{ backgroundImage: `url(${banner})` }}>
            <div className="absolute inset-0 bg-black bg-opacity-30" />
          </div>
        )}
        
        {/* Profile Info */}
        <div className="p-4 relative">
          {/* Close button - always visible in top right */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-6 h-6 rounded-full bg-[#37474F] hover:bg-[#455A64] flex items-center justify-center text-[#CFD8DC] transition-colors z-10"
            title="Close profile"
            aria-label="Close profile"
          >
            ✕
          </button>
          
          <div className="flex items-start gap-4 pr-10">
            {/* Avatar */}
            <div 
              className="flex-shrink-0 rounded-full bg-[#455A64] overflow-hidden border-4 border-[#263238]"
              style={{ 
                width: '5rem', 
                height: '5rem',
                marginTop: banner ? '-2.5rem' : '0'
              }}
            >
              {avatar ? (
                <img
                  src={avatar}
                  alt={displayName}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl">
                  🙂
                </div>
              )}
            </div>

            {/* Name and About */}
            <div className="flex-1 min-w-0" style={{ marginTop: banner ? '-1rem' : '0' }}>
              <h1 className="text-2xl font-bold text-[#CFD8DC] mb-1 truncate">
                {loading ? 'Loading...' : displayName}
              </h1>
              <p className="text-[#90A4AE] mb-2">@{username}</p>
              {about && (
                <p className="text-[#CFD8DC] text-sm leading-relaxed">
                  {about}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Content - User's Notes */}
      <div 
        ref={contentRef}
        className="flex-1 overflow-y-auto"
        style={{
          scrollPaddingTop: headerRef.current?.offsetHeight || 0
        }}
      >
        <EventFeed 
          feedType="user" 
          onNoteClick={onNoteClick}
          onUserClick={onUserClick}
          userPubkey={pubkey}
          filterMode={filterMode}
          mutedPubkeys={mutedPubkeys}
        />
      </div>
    </div>
  )
}

export default ProfileView