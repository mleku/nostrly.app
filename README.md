# Nostrly App Starter

A minimal React app bootstrapped with Vite + TypeScript using:

- React 18
- TanStack Router (programmatic routes)
- TanStack React Query
- IndexedDB for:
  - Persisting React Query cache (via `@tanstack/query-persist-client-idb`)
  - Storing simple app state (via `idb-keyval`)

## Getting Started

1. Install dependencies

```bash
npm install
```

2. Start the dev server

```bash
npm run dev
```

3. Build for production

```bash
npm run build
```

4. Preview the production build

```bash
npm run preview
```

## Project Structure

- `src/main.tsx` – wires up React Query, Router, and IndexedDB persistence
- `src/router.tsx` – defines routes (Home and About)
- `src/lib/idbState.ts` – tiny helper + hook to persist app state to IndexedDB
- `src/routes/Home.tsx` – demo of persisted app state and cached network data
- `src/routes/About.tsx` – about page

## Notes

- React Query cache is persisted to IndexedDB under database `nostrly-app-db` store `react-query-cache`.
- App state is stored under key `nostrly-app-state` using `idb-keyval`.

Feel free to extend this starter to your app's needs.

## Tailwind CSS

This project is configured with Tailwind CSS via PostCSS.

- Config: `tailwind.config.js`
- PostCSS: `postcss.config.js`
- Entry CSS: `src/index.css` (contains `@tailwind base; @tailwind components; @tailwind utilities;`)

Usage:
- Apply utility classes directly in components, e.g. `<div className="p-3">`.
- Dark mode uses the system preference by default (media). You can switch to class strategy by setting `darkMode: 'class'` in `tailwind.config.js`.

No extra build steps needed: Vite processes Tailwind automatically during `dev` and `build`.
