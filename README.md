# GitCanvas

Desktop app to visually organize your **local git repositories** on freeform canvases. Group them by purpose, annotate branches with the domains and smart contracts they ship, and export the result as PNG or SVG.

Built with Electron + React + React Flow + SQLite. pnpm monorepo. macOS-first.

## Features

- **Boards** — multiple canvases, each containing repos, sticky notes, and colored group containers
- **Local git only** — discover individual folders or recursively scan a parent directory; no cloud, no accounts
- **Live status** — current branch, dirty flag, ahead/behind, last commit relative time per repo; refreshed on window focus
- **Per-repo branches** — the details panel lists every local branch with its tracking info, and lets you scope annotations to a specific branch
- **Repo lists** — org-level groupings of repos in the sidebar; link a board to a list to keep its repo nodes in sync
- **Annotations** — attach **domains** (`example.com`, with environment label) and **smart contracts** (chain + address + name) to a repo, optionally scoped to a specific branch — designed for tracking deployments across web2 and web3 stacks
- **Configurable chains** — manage the EVM chain list (name, address pattern, explorer URL template) from Settings
- **Drag-into-group** — visual drop targets when nesting repos/notes into groups
- **Export** — render the entire board as a PNG or SVG image
- **SQLite backups** — create, restore, and delete database snapshots from the Settings dialog

## Requirements

- Node.js ≥ 20.10 (`.nvmrc` pinned to 20.18.0)
- pnpm ≥ 10
- macOS (v1 target — Windows/Linux later)
- `git` available on `PATH`

## Workspace layout

```
apps/
  desktop/       Electron app (main + preload + renderer)
packages/
  shared/        Renderer-safe types + IPC contract (single source of truth)
  tsconfig/      Shared TypeScript presets
```

## Getting started

```bash
pnpm install
pnpm dev          # launch the Electron app with HMR
pnpm typecheck    # run TS across all workspaces
pnpm lint
pnpm build        # build all workspaces
```

## Packaging

```bash
pnpm --filter @gitcanvas/desktop dist:dir   # produces an unpacked .app under release/
pnpm --filter @gitcanvas/desktop dist       # produces a signed-able DMG
```

## Keyboard shortcuts

- **⌘B** — Toggle sidebar
- **Backspace / Delete** — Delete selected node(s) on the canvas

## Database

Local SQLite at `~/Library/Application Support/GitCanvas/gitcanvas.db`. Schema is managed via Drizzle migrations in `apps/desktop/src/main/db/migrations`. Migrations run on startup with FK enforcement temporarily disabled — see `client.ts` for details.

Backups are written to `~/Documents/GitCanvas/backups/` and managed via the Settings dialog.
