import { get, set } from 'idb-keyval'
import { useEffect, useState, useCallback } from 'react'

const APP_DB_KEY = 'nostrly-app-state'

type AppState = {
  theme: 'light' | 'dark'
  counter: number
}

const defaultState: AppState = {
  theme: 'light',
  counter: 0,
}

export async function readAppState(): Promise<AppState> {
  const state = await get<AppState>(APP_DB_KEY)
  return state ?? defaultState
}

export async function writeAppState(state: AppState) {
  await set(APP_DB_KEY, state)
}

export function useAppState() {
  const [state, setState] = useState<AppState>(defaultState)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    readAppState().then((s) => {
      if (mounted) {
        setState(s)
        setLoading(false)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!loading) writeAppState(state)
  }, [state, loading])

  const toggleTheme = useCallback(() => {
    setState((s) => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' }))
  }, [])

  const increment = useCallback(() => {
    setState((s) => ({ ...s, counter: s.counter + 1 }))
  }, [])

  const decrement = useCallback(() => {
    setState((s) => ({ ...s, counter: Math.max(0, s.counter - 1) }))
  }, [])

  return { state, setState, loading, toggleTheme, increment, decrement }
}
