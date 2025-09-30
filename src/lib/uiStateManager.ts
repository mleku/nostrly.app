import { eventDB, UIState } from './eventDB'

// UI State Manager - Handles persistence and synchronization of UI state
class UIStateManager {
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private savePromise: Promise<void> | null = null
  
  /**
   * Save UI state to database with debouncing to avoid excessive writes
   */
  async saveUIState(state: Partial<UIState>, debounceKey?: string): Promise<void> {
    // If a debounce key is provided, debounce the save operation
    if (debounceKey) {
      const existingTimer = this.debounceTimers.get(debounceKey)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }
      
      return new Promise((resolve) => {
        const timer = setTimeout(async () => {
          await this.performSave(state)
          this.debounceTimers.delete(debounceKey)
          resolve()
        }, 500) // 500ms debounce
        
        this.debounceTimers.set(debounceKey, timer)
      })
    }
    
    // Immediate save without debouncing
    return this.performSave(state)
  }
  
  /**
   * Perform the actual save operation
   */
  private async performSave(partialState: Partial<UIState>): Promise<void> {
    try {
      // Wait for any ongoing save to complete to avoid conflicts
      if (this.savePromise) {
        await this.savePromise
      }
      
      this.savePromise = this.doSave(partialState)
      await this.savePromise
      this.savePromise = null
    } catch (error) {
      console.warn('Failed to save UI state:', error)
      this.savePromise = null
    }
  }
  
  /**
   * Internal save implementation
   */
  private async doSave(partialState: Partial<UIState>): Promise<void> {
    // Get existing state first
    const existingState = await eventDB.getUIState()
    
    // Merge with partial state
    const fullState: UIState = {
      // Default values
      mode: 'global',
      currentNoteId: null,
      profilePubkey: null,
      currentHashtag: null,
      openedNotes: [],
      openedProfiles: [],
      openedHashtags: [],
      openedThreads: [],
      threadTriggerNotes: {},
      isNewNoteOpen: false,
      isThreadsModalOpen: false,
      isThreadsHiddenInWideMode: false,
      isSidebarDrawerOpen: false,
      hoverPreviewId: null,
      newNoteText: '',
      replyBuffers: {},
      quoteBuffers: {},
      scrollY: 0,
      topMostTs: null,
      replyOpen: {},
      quoteOpen: {},
      repostMode: {},
      actionMessages: {},
      
      // Override with existing state
      ...existingState,
      
      // Override with new partial state
      ...partialState
    }
    
    await eventDB.storeUIState(fullState)
  }
  
  /**
   * Load UI state from database
   */
  async loadUIState(): Promise<UIState | null> {
    try {
      return await eventDB.getUIState()
    } catch (error) {
      console.warn('Failed to load UI state:', error)
      return null
    }
  }
  
  /**
   * Clear all UI state from database
   */
  async clearUIState(): Promise<void> {
    try {
      await eventDB.deleteUIState()
    } catch (error) {
      console.warn('Failed to clear UI state:', error)
    }
  }
  
  /**
   * Save editor content with automatic expiration handling
   */
  async saveEditorContent(key: string, content: string): Promise<void> {
    const now = Date.now()
    const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000)
    
    // Load existing state to get current editor buffers
    const existingState = await this.loadUIState()
    
    // Clean up old editor content (>1 month old) while preserving recent content
    const cleanBuffers = (buffers: Record<string, string>) => {
      const cleaned: Record<string, string> = {}
      for (const [k, v] of Object.entries(buffers)) {
        // Keep content that has been recently modified or is not empty
        if (v.trim() !== '' || k === key) {
          cleaned[k] = v
        }
      }
      return cleaned
    }
    
    let updatedState: Partial<UIState>
    
    if (key === 'newNoteText') {
      updatedState = { newNoteText: content }
    } else if (key.includes('reply|')) {
      const replyBuffers = cleanBuffers(existingState?.replyBuffers || {})
      replyBuffers[key] = content
      updatedState = { replyBuffers }
    } else if (key.includes('quote|')) {
      const quoteBuffers = cleanBuffers(existingState?.quoteBuffers || {})
      quoteBuffers[key] = content
      updatedState = { quoteBuffers }
    } else {
      // Generic fallback
      updatedState = {}
    }
    
    await this.saveUIState(updatedState, `editor-${key}`)
  }
  
  /**
   * Clean up expired editor content (called periodically)
   */
  async cleanupExpiredEditorContent(): Promise<void> {
    try {
      const state = await this.loadUIState()
      if (!state) return
      
      const now = Date.now()
      const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000)
      
      // For editor content, we'll rely on the database's automatic expiration
      // But we can also clean up empty buffers to keep the state lean
      const cleanEmptyBuffers = (buffers: Record<string, string>) => {
        const cleaned: Record<string, string> = {}
        for (const [key, value] of Object.entries(buffers)) {
          if (value.trim() !== '') {
            cleaned[key] = value
          }
        }
        return cleaned
      }
      
      const hasChanges = Object.keys(state.replyBuffers).some(k => state.replyBuffers[k].trim() === '') ||
                        Object.keys(state.quoteBuffers).some(k => state.quoteBuffers[k].trim() === '')
      
      if (hasChanges) {
        await this.saveUIState({
          replyBuffers: cleanEmptyBuffers(state.replyBuffers),
          quoteBuffers: cleanEmptyBuffers(state.quoteBuffers)
        })
      }
    } catch (error) {
      console.warn('Failed to cleanup expired editor content:', error)
    }
  }
}

// Export singleton instance
export const uiStateManager = new UIStateManager()

// Set up periodic cleanup of editor content (every hour)
if (typeof window !== 'undefined') {
  setInterval(() => {
    uiStateManager.cleanupExpiredEditorContent().catch(console.warn)
  }, 60 * 60 * 1000)
}