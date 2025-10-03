import React from 'react'

export type FilterMode = 'notes' | 'replies' | 'reposts'

interface NotesFilterPanelProps {
  activeMode: FilterMode
  onModeChange: (mode: FilterMode) => void
}

const NotesFilterPanel: React.FC<NotesFilterPanelProps> = ({ activeMode, onModeChange }) => {
  return (
    <div className="sticky top-0 z-10 bg-[#263238] border-b border-gray-600 px-4 py-2 flex gap-2">
      <button
        onClick={() => onModeChange('notes')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          activeMode === 'notes'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
        }`}
      >
        Notes
      </button>
      <button
        onClick={() => onModeChange('replies')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          activeMode === 'replies'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
        }`}
      >
        Replies
      </button>
      <button
        onClick={() => onModeChange('reposts')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          activeMode === 'reposts'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
        }`}
      >
        Reposts
      </button>
    </div>
  )
}

export default NotesFilterPanel