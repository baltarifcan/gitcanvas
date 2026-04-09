/// <reference types="vite/client" />

import type { GitcanvasBridge } from '../../preload/index.ts'

declare global {
  interface Window {
    gitcanvas: GitcanvasBridge
  }
}

export {}
