import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check } from 'lucide-react'

const PRESETS = [
  '#7c3aed', // violet
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#22d3ee', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#a78bfa', // light violet
  '#64748b', // slate
  '#fbbf24', // yellow
]

const HEX_RE = /^#[0-9a-f]{6}$/i

type Props = {
  value: string
  onChange: (hex: string) => void
  /** Render prop for the trigger so callers control its appearance. */
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}

/**
 * Compact color picker — Radix Popover with a preset palette + custom hex
 * input. Used for both "Add group" (initial color choice) and "Change color"
 * (mutating an existing group). Validates hex on change so the parent only
 * ever sees a `#rrggbb` string.
 */
export function ColorPicker({ value, onChange, children, side = 'bottom', align = 'end' }: Props) {
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)

  const handleHexChange = (next: string) => {
    setDraft(next)
    if (HEX_RE.test(next)) onChange(next)
  }

  const handlePick = (hex: string) => {
    setDraft(hex)
    onChange(hex)
    setOpen(false)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
    >
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={6}
          className="z-[60] w-[200px] rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-xl"
        >
          <div className="grid grid-cols-6 gap-1.5">
            {PRESETS.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => handlePick(hex)}
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
