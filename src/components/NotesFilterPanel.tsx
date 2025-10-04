import React from 'react'
import { NostrEvent } from '../lib/nostr'

export type FilterMode = 'notes' | 'replies' | 'reposts'

interface NotesFilterPanelProps {
  activeMode: FilterMode
  onModeChange: (mode: FilterMode) => void
  selectedNote?: NostrEvent | null
  onThreadClick?: () => void
  isThreadOpen?: boolean
}

const NotesFilterPanel: React.FC<NotesFilterPanelProps> = ({ activeMode, onModeChange, selectedNote, onThreadClick, isThreadOpen }) => {
  return (
    <div className="sticky top-0 z-10 bg-[#263238] pr-4 pl-2 py-2 flex gap-2">
        <button
            onClick={() => onModeChange('replies')}
            className={`px-2 py-1 rounded-md text-sm font-medium transition-colors ${
                activeMode === 'replies'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
            }`}
        >
            All
        </button>
      <button
        onClick={() => onModeChange('notes')}
        className={`px-2 py-1 rounded-md text-sm font-medium transition-colors ${
          activeMode === 'notes'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
        }`}
      >
        Notes
      </button>
      <button
        onClick={() => onModeChange('reposts')}
        className={`px-2 py-1 rounded-md text-sm font-medium transition-colors ${
          activeMode === 'reposts'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
        }`}
      >
        Reposts
      </button>
      {selectedNote && (
        <button
          onClick={onThreadClick}
          className={`px-2 py-1 rounded-md text-sm font-medium transition-colors ${
            isThreadOpen
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
          }`}
        >
          Thread
        </button>
      )}
    </div>
  )
}

export default NotesFilterPanel