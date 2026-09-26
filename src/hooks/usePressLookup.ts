import { useCallback, useRef } from 'react'

type Handlers = {
  onPointerDown: (e: React.PointerEvent | PointerEvent) => void
  onPointerMove: (e: React.PointerEvent | PointerEvent) => void
  onPointerUp: (e: React.PointerEvent | PointerEvent) => void
  onPointerCancel: () => void
  onDoubleClick: (e: React.MouseEvent | MouseEvent) => void
}

type Options = {
  /** Single tap / click → word lookup. */
  onTap: (clientX: number, clientY: number) => void
  /** Double-click / double-tap → sentence lookup. */
  onDoubleTap: (clientX: number, clientY: number) => void
  /** Long-press → open grip selection on the word under the finger. */
  onLongPress: (clientX: number, clientY: number) => void
  longMs?: number
  doubleMs?: number
  /** Cancel pending long-press if finger moves more than this before it fires. */
  moveCancel?: number
}

/**
 * Tap = word; double-tap = sentence; long-press = word + selection grips.
 */
export function usePressLookup({
  onTap,
  onDoubleTap,
  onLongPress,
  longMs = 450,
  doubleMs = 320,
  moveCancel = 28,
}: Options): Handlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef({ x: 0, y: 0 })
  const longFiredRef = useRef(false)
  const cancelledRef = useRef(false)
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)

  const onTapRef = useRef(onTap)
  const onDoubleTapRef = useRef(onDoubleTap)
  const onLongPressRef = useRef(onLongPress)
  onTapRef.current = onTap
  onDoubleTapRef.current = onDoubleTap
  onLongPressRef.current = onLongPress

  const clearLongTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearTapTimer = useCallback(() => {
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current)
      tapTimerRef.current = null
    }
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      if ('button' in e && e.button !== 0) return
      longFiredRef.current = false
      cancelledRef.current = false
      pointerIdRef.current = e.pointerId
      startRef.current = { x: e.clientX, y: e.clientY }
      clearLongTimer()
      timerRef.current = setTimeout(() => {
        longFiredRef.current = true
        clearTapTimer()
        lastTapRef.current = null
        onLongPressRef.current(startRef.current.x, startRef.current.y)
      }, longMs)
    },
    [clearLongTimer, clearTapTimer, longMs],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      if (longFiredRef.current) {
        // Stop page scroll while grips are being seeded.
        e.preventDefault?.()
        return
      }
      if (!timerRef.current) return
      const dx = e.clientX - startRef.current.x
      const dy = e.clientY - startRef.current.y
      if (Math.hypot(dx, dy) > moveCancel) {
        clearLongTimer()
        cancelledRef.current = true
      }
    },
    [clearLongTimer, moveCancel],
  )

  const fireTapOrDouble = useCallback(
    (x: number, y: number) => {
      const now = Date.now()
      const prev = lastTapRef.current
      if (
        prev &&
        now - prev.t <= doubleMs &&
        Math.hypot(x - prev.x, y - prev.y) < 28
      ) {
        clearTapTimer()
        lastTapRef.current = null
        suppressClickRef.current = true
        onDoubleTapRef.current(x, y)
        return
      }

      lastTapRef.current = { t: now, x, y }
      clearTapTimer()
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null
        lastTapRef.current = null
        if (longFiredRef.current) return
        onTapRef.current(x, y)
      }, doubleMs)
    },
    [clearTapTimer, doubleMs],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      clearLongTimer()
      if (longFiredRef.current) {
        e.preventDefault?.()
        // Keep longFired true briefly so a synthetic click cannot clear grips.
        window.setTimeout(() => {
          longFiredRef.current = false
        }, 50)
        return
      }
      if (cancelledRef.current) return
      const dx = Math.abs(e.clientX - startRef.current.x)
      const dy = Math.abs(e.clientY - startRef.current.y)
      if (dx > moveCancel || dy > moveCancel) return

      fireTapOrDouble(e.clientX, e.clientY)
    },
    [clearLongTimer, fireTapOrDouble, moveCancel],
  )

  const onPointerCancel = useCallback(() => {
    clearLongTimer()
    clearTapTimer()
    cancelledRef.current = true
    longFiredRef.current = false
  }, [clearLongTimer, clearTapTimer])

  const onDoubleClick = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        e.preventDefault?.()
        return
      }
      clearTapTimer()
      lastTapRef.current = null
      onDoubleTapRef.current(e.clientX, e.clientY)
    },
    [clearTapTimer],
  )

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
  }
}
