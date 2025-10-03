import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppState } from '../lib/idbState'

async function fetchJoke() {
  const res = await fetch('https://icanhazdadjoke.com/', {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error('Failed to fetch')
  return (await res.json()) as { joke: string }
}

export function Home() {
  const { state, toggleTheme, increment, decrement, loading } = useAppState()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['joke'],
    queryFn: fetchJoke,
  })

  const themeStyles: React.CSSProperties =
    state.theme === 'dark'
      ? { background: '#111', color: '#eee' }
      : { background: '#fff', color: '#111' }

  return (
    <div className="" style={themeStyles}>
      ORLY ...
    </div>
  )
}
