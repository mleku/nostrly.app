import React, { useState, useEffect } from 'react'

interface MediaItem {
  url: string
  type: 'image' | 'video' | 'audio'
}

interface MediaModalProps {
  src: string
  alt: string
  isOpen: boolean
  onClose: () => void
  mediaType: 'image' | 'video' | 'audio'
  mediaItems?: MediaItem[]
  currentIndex?: number
}

const MediaModal: React.FC<MediaModalProps> = ({ src, alt, isOpen, onClose, mediaType, mediaItems, currentIndex = 0 }) => {
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, startX: 0, startY: 0 })
  const [activeIndex, setActiveIndex] = useState(currentIndex)

  // Reset zoom and position when modal opens or media changes
  useEffect(() => {
    if (isOpen) {
      setZoom(1)
      setPosition({ x: 0, y: 0 })
    }
  }, [isOpen, activeIndex])

  // Update active index when currentIndex prop changes
  useEffect(() => {
    setActiveIndex(currentIndex)
  }, [currentIndex])

  // Get current media item
  const currentMedia = mediaItems && mediaItems.length > 0 ? mediaItems[activeIndex] : { url: src, type: mediaType }
  const hasMultipleMedia = mediaItems && mediaItems.length > 1

  // Navigation functions
  const goToPrevious = () => {
    if (hasMultipleMedia) {
      setActiveIndex((prev) => (prev - 1 + mediaItems.length) % mediaItems.length)
    }
  }

  const goToNext = () => {
    if (hasMultipleMedia) {
      setActiveIndex((prev) => (prev + 1) % mediaItems.length)
    }
  }

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev * 1.5, 5))
  }

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev / 1.5, 0.1))
  }

  const handleResetZoom = () => {
    setZoom(1)
    setPosition({ x: 0, y: 0 })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true)
      setDragStart({
        x: e.clientX,
        y: e.clientY,
        startX: position.x,
        startY: position.y
      })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      const deltaX = e.clientX - dragStart.x
      const deltaY = e.clientY - dragStart.y
      setPosition({
        x: dragStart.startX + deltaX,
        y: dragStart.startY + deltaY
      })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const renderMedia = () => {
    const mediaStyle = {
      transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
      cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
      maxWidth: '90vw',
      maxHeight: '90vh',
      objectFit: 'contain' as const
    }

    switch (currentMedia.type) {
      case 'image':
        return (
          <img
            src={currentMedia.url}
            alt={alt}
            style={mediaStyle}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            draggable={false}
            className="select-none"
          />
        )
      case 'video':
        return (
          <video
            src={currentMedia.url}
            controls
            style={mediaStyle}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="select-none"
          />
        )
      case 'audio':
        return (
          <audio
            src={currentMedia.url}
            controls
            className="w-full max-w-md"
          />
        )
      default:
        return null
    }
  }

  return (
    <div 
      className="fixed z-50 flex items-center justify-center"
      style={{
        top: '3.5rem', // Below header (top-14 = 3.5rem)
        left: '12em', // To the right of sidebar (default expanded width)
        right: '0',
        bottom: '0'
      }}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50" 
        onClick={onClose}
      />
      
      {/* Modal content */}
      <div className="absolute bg-black-50 z-120 flex flex-col items-center justify-center h-full w-full pointer-events-none">
        {/* Navigation arrows (top left) */}
        {hasMultipleMedia && (
          <div className="absolute top-4 left-4 flex items-center space-x-2 z-20 pointer-events-auto">
            <button
              onClick={goToPrevious}
              className="bg-black bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 transition-colors"
              title="Previous media"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            
            <span className="bg-black bg-opacity-70 text-white px-3 py-1 rounded-full text-sm">
              {activeIndex + 1} / {mediaItems!.length}
            </span>
            
            <button
              onClick={goToNext}
              className="bg-black bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 transition-colors"
              title="Next media"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
        
        {/* Controls */}
        <div className="absolute top-4 right-4 flex items-center space-x-2 z-20 pointer-events-auto">
          {currentMedia.type === 'image' && (
            <>
              <button
                onClick={handleZoomOut}
                className="bg-black bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 transition-colors"
                title="Zoom Out"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
              
              <button
                onClick={handleZoomIn}
                className="bg-black bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 transition-colors"
                title="Zoom In"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              
              <button
                onClick={handleResetZoom}
                className="bg-black bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 transition-colors"
                title="Reset Zoom"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </>
          )}
          
          {/* Close button */}
          <button
            onClick={onClose}
            className="bg-black bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 transition-colors"
            title="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Media content */}
        <div className="flex items-center justify-center pointer-events-auto">
          {renderMedia()}
        </div>
      </div>
    </div>
  )
}

export default MediaModal