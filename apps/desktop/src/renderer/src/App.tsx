import { useEffect, useState } from 'react'
import { PanelLeft, PanelLeftClose, Settings } from 'lucide-react'
import clsx from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import { BoardSidebar } from './features/boards/BoardSidebar'
import { BoardView } from './features/boards/BoardView'
import { SettingsDialog } from './features/chains/SettingsDialog'

export default function App() {
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Refresh local git statuses + branches whenever the window regains focus.
  // Cheap on local repos and stops the canvas from showing stale dirty flags.
  useFocusRefreshRepos()

  // ⌘B / Ctrl+B toggles the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarVisible((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100">
      <header
        className="flex h-11 shrink-0 items-center border-b border-zinc-800 bg-zinc-900/70 text-xs font-medium tracking-wide text-zinc-400 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={() => setSidebarVisible((v) => !v)}
          className="ml-[78px] flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          title={sidebarVisible ? 'Hide sidebar (⌘B)' : 'Show sidebar (⌘B)'}
        >
          {sidebarVisible ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
        </button>
        <div className="flex-1 text-center">GitCanvas</div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="mr-3 flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </header>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <div className="flex min-h-0 flex-1">
        <div
          className={clsx(
            'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
            sidebarVisible ? 'w-64' : 'w-0',
          )}
        >
          <BoardSidebar
            selectedBoardId={selectedBoardId}
            onSelectBoard={setSelectedBoardId}
          />
        </div>

        <main className="min-w-0 flex-1">
          {selectedBoardId ? (
            <BoardView boardId={selectedBoardId} />
          ) : (
            <EmptyState onShowSidebar={() => setSidebarVisible(true)} sidebarVisible={sidebarVisible} />
          )}
        </main>
      </div>
    </div>
  )
}

/** Hook: invalidates per-repo git status caches when the window regains focus. */
function useFocusRefreshRepos() {
  const qc = useQueryClient()

  useEffect(() => {
    const onFocus = () => {
      // Invalidate all per-repo status + branches caches; React Query refetches
      // those that have active observers (i.e. visible repo nodes / details panel).
      qc.invalidateQueries({
        queryKey: ['repos'],
        predicate: (q) => {
          const k = q.queryKey
          return Array.isArray(k) && k.length >= 3 && (k[2] === 'localStatus' || k[2] === 'branches')
        },
      })
    }
    // electron 'focus' fires on window focus
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [qc])
}

function EmptyState({
  onShowSidebar,
  sidebarVisible,
}: {
  onShowSidebar: () => void
  sidebarVisible: boolean
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-zinc-200">No board selected</h2>
        <p className="mt-2 text-sm text-zinc-500">
          {sidebarVisible ? (
            <>
              Pick a board from the sidebar, or create a new one with the
              <span className="mx-1 rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">+</span>
              button next to <span className="text-zinc-400">Boards</span>.
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onShowSidebar}
                className="rounded bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700"
              >
                Show sidebar
              </button>{' '}
              to pick or create a board.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
