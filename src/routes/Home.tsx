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
    <div style={{ ...themeStyles, padding: 16, borderRadius: 8 }}>
      <h1>Welcome to Nostrly</h1>
      <p>This app uses React, TanStack Router, React Query, and IndexedDB.</p>

      <section>
        <h2>App State (IndexedDB)</h2>
        {loading ? (
          <p>Loading state…</p>
        ) : (
          <div>
            <p>Theme: {state.theme}</p>
            <button onClick={toggleTheme}>Toggle Theme</button>
            <div style={{ marginTop: 8 }}>
              <button onClick={decrement}>-</button>
              <span style={{ padding: '0 8px' }}>{state.counter}</span>
              <button onClick={increment}>+</button>
            </div>
          </div>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Cached Content (React Query + IndexedDB)</h2>
        {isPending && <p>Loading a joke…</p>}
        {error && <p style={{ color: 'crimson' }}>Error loading joke</p>}
        {data && <blockquote style={{ fontStyle: 'italic' }}>{data.joke}</blockquote>}
        <button onClick={() => refetch()} style={{ marginTop: 8 }}>
          New Joke
        </button>
      </section>
    </div>
  )
}
