import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Download } from 'lucide-react'
import { toPng, toSvg } from 'html-to-image'
import { getViewportForBounds } from '@xyflow/react'
import type { BoardNode, BoardWithNodes } from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'

type Props = {
  board: BoardWithNodes
}

const MAX_EXPORT_DIMENSION = 2400
const EXPORT_PADDING = 0.06

/** Wait for two animation frames so React commits + paints before capture. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** Toggle the canvas's export mode (NoteNode swaps textarea → div). */
function setExportMode(active: boolean): void {
  window.dispatchEvent(new CustomEvent('gitcanvas:export-mode', { detail: { active } }))
}

/**
 * Computes a bounding rect that contains every node on the board, accounting
 * for parent-relative children. We can't use React Flow's `getNodesBounds`
 * here because it relies on `internals.positionAbsolute`, which is only
 * populated for nodes that have actually been rendered through the React
 * Flow store — and BoardExportMenu lives outside the ReactFlowProvider so
 * we don't have access to those internals.
 *
 * Walking parent chains ourselves is fast (boards have at most a few hundred
 * nodes) and gives correct absolute coordinates regardless of nesting.
 */
function computeAbsoluteBounds(nodes: BoardNode[]): {
  x: number
  y: number
  width: number
  height: number
} {
  const byId = new Map<string, BoardNode>()
  for (const n of nodes) byId.set(n.id, n)

  const absoluteOf = (n: BoardNode): { x: number; y: number } => {
    if (!n.parentId) return n.position
    const parent = byId.get(n.parentId)
    if (!parent) return n.position
    const pa = absoluteOf(parent)
    return { x: pa.x + n.position.x, y: pa.y + n.position.y }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    const abs = absoluteOf(n)
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxX = Math.max(maxX, abs.x + n.size.width)
    maxY = Math.max(maxY, abs.y + n.size.height)
  }

  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Export the current board as PNG or SVG.
 *
 * Rather than capture the user's current viewport (which only includes
 * what's visible on screen), we compute the bounding box of every node on
 * the board, decide a target image size, and use React Flow's
 * `getViewportForBounds` helper to derive the (x, y, zoom) transform that
 * would fit everything inside the target frame. We pass that transform to
 * `html-to-image` via its `style` override, so the captured image renders
 * the entire board centered, regardless of where the user is panned/zoomed.
 *
 * Notes are temporarily switched to a static div via the canvas exportMode
 * flag so the captured SVG doesn't contain a live `<textarea>`.
 */
export function BoardExportMenu({ board }: Props) {
  const [busy, setBusy] = useState<'png' | 'svg' | null>(null)
  const slug =
    board.name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'board'

  const captureFullBoard = async (
    fmt: 'png' | 'svg',
  ): Promise<{ data: string; ext: string; mime: string }> => {
    if (board.nodes.length === 0) {
      throw new Error('Board is empty — nothing to export.')
    }

    // 1. Bounding box of every node in flow coordinates, computed manually
    //    so nested children are positioned correctly.
    const bounds = computeAbsoluteBounds(board.nodes)
    if (bounds.width === 0 || bounds.height === 0) {
      throw new Error('Board has zero-size content — nothing to export.')
    }

    // 2. Pick a target image size that respects the bounds' aspect ratio
    //    while honoring MAX_EXPORT_DIMENSION on the longest side.
    const aspect = bounds.width / Math.max(bounds.height, 1)
    let imageWidth: number
    let imageHeight: number
    if (aspect >= 1) {
      imageWidth = Math.min(MAX_EXPORT_DIMENSION, Math.max(800, Math.round(bounds.width)))
      imageHeight = Math.round(imageWidth / aspect)
    } else {
      imageHeight = Math.min(MAX_EXPORT_DIMENSION, Math.max(600, Math.round(bounds.height)))
      imageWidth = Math.round(imageHeight * aspect)
    }

    // 3. Compute the transform that fits the bounds inside (imageWidth × imageHeight).
    const transform = getViewportForBounds(
      bounds,
      imageWidth,
      imageHeight,
      0.05,
      4,
      EXPORT_PADDING,
    )

    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!viewport) throw new Error('React Flow viewport not found in the DOM')

    // 4. Flip notes to static-render mode and let React commit before capturing.
    setExportMode(true)
    await nextPaint()

    try {
      const styleOverride: Record<string, string> = {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
        transformOrigin: '0 0',
      }

      if (fmt === 'png') {
        const dataUrl = await toPng(viewport, {
          backgroundColor: '#0b0b0f',
          width: imageWidth,
          height: imageHeight,
          pixelRatio: 2,
          cacheBust: true,
          style: styleOverride,
        })
        const base64 = dataUrl.split(',', 2)[1] ?? ''
        return { data: `base64:${base64}`, ext: 'png', mime: 'image/png' }
      }

      const svg = await toSvg(viewport, {
        backgroundColor: '#0b0b0f',
        width: imageWidth,
        height: imageHeight,
        cacheBust: true,
        style: styleOverride,
      })
      // toSvg returns `data:image/svg+xml;charset=utf-8,<urlencoded>`
      const decoded = decodeURIComponent(svg.split(',', 2)[1] ?? '')
      return { data: decoded, ext: 'svg', mime: 'image/svg+xml' }
    } finally {
      setExportMode(false)
    }
  }

  const handleExport = async (fmt: 'png' | 'svg') => {
    if (busy) return
    setBusy(fmt)
    try {
      const payload = await captureFullBoard(fmt)
      const filters =
        fmt === 'png'
          ? [{ name: 'PNG image', extensions: ['png'] }]
          : [{ name: 'SVG image', extensions: ['svg'] }]

      await api.system.saveFile({
        defaultPath: `${slug}.${payload.ext}`,
        filters,
        data: payload.data,
      })
    } catch (err) {
       
      console.error('Export failed', err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={busy !== null}
          className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          <Download size={12} />
          {busy ? 'Exporting…' : 'Export'}
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[180px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 p-1 text-sm text-zinc-200 shadow-xl"
        >
          <ExportItem label="PNG image" hint=".png" onSelect={() => handleExport('png')} />
          <ExportItem label="SVG vector" hint=".svg" onSelect={() => handleExport('svg')} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ExportItem({
  label,
  hint,
  onSelect,
}: {
  label: string
  hint: string
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item
      onSelect={(e) => {
        e.preventDefault()
        onSelect()
      }}
      className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 outline-none data-[highlighted]:bg-zinc-800"
    >
      <span>{label}</span>
      <span className="text-[10px] text-zinc-500">{hint}</span>
    </DropdownMenu.Item>
  )
}
