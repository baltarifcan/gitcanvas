import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'

const PRESETS = [
  '#7c3aed',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#22d3ee',
  '#84cc16',
  '#f97316',
  '#a78bfa',
  '#64748b',
  '#fbbf24',
]

const HEX_RE = /^#[0-9a-f]{6}$/i

type Props = {
  /** Current color (so we can highlight it in the palette). */
  value: string
  /** Anchor coordinates in screen space (event.clientX/Y). */
  x: number
  y: number
  /** Called whenever a valid hex is chosen. */
  onChange: (hex: string) => void
  /** Closed via outside click / Escape / picking a preset. */
  onClose: () => void
}

/**
 * Floating color picker positioned at arbitrary screen coordinates. Used by
 * the canvas right-click context menu (which can't host a Radix Popover
 * because it has no real trigger element). Auto-clamps to viewport bounds.
 */
export function ColorPickerPopover({ value, x, y, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const POPOVER_WIDTH = 220
  const POPOVER_HEIGHT = 140
  const left = Math.min(x, window.innerWidth - POPOVER_WIDTH - 8)
  const top = Math.min(y, window.innerHeight - POPOVER_HEIGHT - 8)

  const handleHexChange = (next: string) => {
    setDraft(next)
    if (HEX_RE.test(next)) onChange(next)
  }

  return (
    <div
      ref={ref}
      className="fixed z-[60] w-[220px] rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-xl"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-6 gap-1.5">
        {PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => {
              onChange(hex)
              onClose()
            }}
            className="relative h-6 w-6 rounded-md border border-black/30 transition hover:scale-110"
            style={{ background: hex }}
            aria-label={`Color ${hex}`}
          >
            {value.toLowerCase() === hex.toLowerCase() && (
              <Check size={12} className="absolute inset-0 m-auto text-white drop-shadow" />
            )}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Custom hex
        </label>
        <input
          type="text"
          value={draft}
          onChange={(e) => handleHexChange(e.target.value)}
          placeholder="#7c3aed"
          maxLength={7}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-600"
        />
      </div>
    </div>
  )
}
