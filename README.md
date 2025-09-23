# nostrly.app

A simple nostr client focused on performance and user configurability.

Built with:
- React 18 with TypeScript
- TanStack Router for routing
- TanStack Query (React Query) for state management
- NDK (Nostr Development Kit) for Nostr protocol integration
- Vite for fast development and building

## Prerequisites

- [Bun](https://bun.sh/) - Fast all-in-one JavaScript runtime & toolkit
  ```bash
  # Install bun (if not already installed)
  curl -fsSL https://bun.sh/install | bash
  ```

## Development

### Install Dependencies

```bash
bun install
```

### Start Development Server

Start the development server with hot reload:

```bash
bun run dev
```

This will start the Vite development server on `http://localhost:5173` (or the next available port) with:
- Hot module replacement (HMR) for instant updates
- TypeScript compilation
- React Fast Refresh

### Other Development Commands

```bash
# Type checking
bun run type-check

# Build for production
bun run build

# Preview production build
bun run preview
```

## Project Structure

```
src/
├── components/     # React components
├── lib/           # Utilities and configurations
│   ├── ndk.ts     # NDK (Nostr) configuration
│   └── query.ts   # React Query configuration
├── routes/        # TanStack Router routes
├── App.tsx        # Main application component
├── main.tsx       # Application entry point
└── index.css      # Global styles
```

## Development Features

- **Hot Reload**: Changes are reflected instantly in the browser
- **TypeScript**: Full type safety and IntelliSense
- **Router DevTools**: TanStack Router devtools available in development
- **React Query DevTools**: Query inspection and debugging
- **NDK Integration**: Ready-to-use Nostr protocol functionality
