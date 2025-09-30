import { useEffect, useState, useRef, useCallback } from 'react'

export function useScrollToTop() {
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrollTop = container.scrollTop
      const scrollHeight = container.scrollHeight
      const clientHeight = container.clientHeight
      
      // Only show button if there's scrollable content
      const hasScrollableContent = scrollHeight > clientHeight
      if (!hasScrollableContent) {
        setShowBackToTop(false)
        return
      }
      
      // Calculate if scrolled more than 50% of the viewable height
      const scrolledPercentage = scrollTop / clientHeight
      setShowBackToTop(scrolledPercentage > 0.5)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    
    // Initial check
    handleScroll()

    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }, [])

  const scrollToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: 0,
        behavior: 'smooth'
      })
    }
  }, [])

  return {
    scrollContainerRef,
    showBackToTop,
    scrollToTop
  }
}

// Back to Top Button Component
interface BackToTopButtonProps {
  show: boolean
  onClick: () => void
}

export function BackToTopButton({ show, onClick }: BackToTopButtonProps) {
  if (!show) return null

  return (
    <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
      <span className="text-xs text-white/70 bg-black/50 px-2 py-1 rounded-full select-none whitespace-nowrap">
        back to top
      </span>
      <button
        type="button"
        onClick={onClick}
        className="w-8 h-8 rounded-full bg-black/70 text-white hover:bg-black/90 flex items-center justify-center transition-all duration-200 shadow-lg"
        aria-label="Back to top"
        title="Back to top"
      >
        ↑
      </button>
    </div>
  )
}