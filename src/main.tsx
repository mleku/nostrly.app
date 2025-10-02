import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { persistQueryClient, type Persister } from '@tanstack/react-query-persist-client'
import { get, set, del } from 'idb-keyval'
import { router } from './router'
import './index.css'

// Create a QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      retry: 1,
    },
  },
})

// Set up IndexedDB persister for React Query cache using idb-keyval
const REACT_QUERY_IDB_KEY = 'react-query-cache'
const persister: Persister = {
  persistClient: async (client) => {
    await set(REACT_QUERY_IDB_KEY, client)
  },
  restoreClient: async () => {
    return (await get(REACT_QUERY_IDB_KEY)) ?? undefined
  },
  removeClient: async () => {
    await del(REACT_QUERY_IDB_KEY)
  },
}

persistQueryClient({
  queryClient,
  persister,
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
})

const rootEl = document.getElementById('root')!
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
)
