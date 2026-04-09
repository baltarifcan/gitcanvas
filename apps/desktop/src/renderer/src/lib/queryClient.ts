import { QueryClient } from '@tanstack/react-query'

/**
 * Single QueryClient for the renderer. Defaults are tuned for an Electron app
 * talking to a local SQLite-backed main process:
 *
 *  - `staleTime` is generous because changes only happen via mutations from
 *    this same renderer (or future syncs we'll explicitly invalidate on).
 *  - `refetchOnWindowFocus` off — focus events fire constantly when devtools
 *    open and there's no upstream that can change the data behind our back.
 *  - `retry: 1` so a transient IPC hiccup doesn't bubble straight to the UI,
 *    but a real error fails fast.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})
