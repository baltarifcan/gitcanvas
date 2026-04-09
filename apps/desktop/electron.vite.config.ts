import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {
    // Bundle the workspace `@gitcanvas/shared` package — sandboxed Electron
    // contexts (and main, for consistency) can't resolve workspace packages
    // at runtime, so they need to be inlined at build time. Everything else
    // (electron, better-sqlite3, drizzle-orm, etc.) stays external because
    // those resolve from node_modules normally.
    plugins: [externalizeDepsPlugin({ exclude: ['@gitcanvas/shared'] })],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@gitcanvas/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
  },
  preload: {
    // TWO load-bearing constraints, both required for `window.gitcanvas` to
    // actually exist in the renderer:
    //
    //  1. Bundle `@gitcanvas/shared` (don't externalize it). Sandboxed preload
    //     scripts can't resolve workspace packages at runtime, so the channel
    //     allowlist has to be inlined at build time.
    //
    //  2. Output CommonJS, not ESM. Electron's sandboxed preload (sandbox: true
    //     in window.ts) does NOT support ESM preload scripts — the only
    //     environment where ESM preload works is sandbox: false. Because the
    //     desktop package.json has `"type": "module"`, a plain `.js` file would
    //     also be interpreted as ESM by Node, so we explicitly emit `.cjs`.
    //     The preload path in window.ts must match this extension.
    plugins: [externalizeDepsPlugin({ exclude: ['@gitcanvas/shared'] })],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
    resolve: {
      alias: {
        '@gitcanvas/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@gitcanvas/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
