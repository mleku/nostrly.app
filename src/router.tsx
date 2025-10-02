import React from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from '@tanstack/react-router'
import { Home } from './routes/Home'

const RootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen">
      <nav className="flex gap-3 p-3 border-b border-neutral-200 dark:border-neutral-800">
        <Link to="/" activeProps={{ className: 'font-bold' }}>Home</Link>
      </nav>
      <div className="p-3">
        <Outlet />
      </div>
    </div>
  ),
})

const IndexRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  component: Home,
})

const routeTree = RootRoute.addChildren([IndexRoute])

export const router = createRouter({
  routeTree,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
