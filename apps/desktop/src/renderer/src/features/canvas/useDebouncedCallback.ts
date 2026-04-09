import { useCallback, useEffect, useRef } from 'react'

/**
 * Trailing-edge debounce. Calls `fn` `delay` ms after the last invocation.
 * The returned function has a `flush()` to fire any pending call immediately
 * (useful on unmount or board switch). Cancels pending calls automatically
 * when the component unmounts.
 */
export function useDebouncedCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay: number,
) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastArgsRef = useRef<TArgs | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    lastArgsRef.current = null
  }, [])

  const flush = useCallback(() => {
    if (timerRef.current !== null && lastArgsRef.current) {
      clearTimeout(timerRef.current)
      const args = lastArgsRef.current
      timerRef.current = null
      lastArgsRef.current = null
      fnRef.current(...args)
    }
  }, [])

  const debounced = useCallback(
    (...args: TArgs) => {
      lastArgsRef.current = args
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const a = lastArgsRef.current
        lastArgsRef.current = null
        if (a) fnRef.current(...a)
      }, delay)
    },
    [delay],
  )

  useEffect(() => cancel, [cancel])

  return Object.assign(debounced, { flush, cancel })
}
