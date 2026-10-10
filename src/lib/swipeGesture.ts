/**
 * Swipe detection with axis-lock + distance/velocity
 * (same idea as Hammer.js / Swiper / react-swipeable).
 *
 * - Mouse ignored by default (desktop uses buttons; drag selects text)
 * - After a small slop, lock to H or V so diagonals don't misfire
 * - Count as swipe if enough distance OR a fast flick
 */

export type SwipeAxis = 'x' | 'y' | 'both'
export type SwipeDirection = 'left' | 'right' | 'up' | 'down'

export type SwipeGestureOptions = {
  axis?: SwipeAxis
  /** Min movement before axis lock (px). */
  slop?: number
  /** Min primary-axis travel (px). */
  distance?: number
  /** Min |velocity| on primary axis (px/ms) for a short flick. */
  velocity?: number
  /** Primary must be ≥ this × cross-axis. */
  axisRatio?: number
  pointerTypes?: ReadonlyArray<PointerEvent['pointerType']>
  onSwipe: (direction: SwipeDirection) => void
  shouldIgnore?: (event: PointerEvent) => boolean
}

type TrackState = {
  pointerId: number
  startX: number
  startY: number
  startT: number
  locked: 'x' | 'y' | null
  done: boolean
  captureEl: Element | null
}

const DEFAULT_POINTER_TYPES: ReadonlyArray<PointerEvent['pointerType']> = [
  'touch',
  'pen',
]

export function createSwipeGesture(opts: SwipeGestureOptions) {
  const axis = opts.axis ?? 'both'
  const slop = opts.slop ?? 12
  const distance = opts.distance ?? 64
  const velocity = opts.velocity ?? 0.45
  const axisRatio = opts.axisRatio ?? 1.6
  const pointerTypes = opts.pointerTypes ?? DEFAULT_POINTER_TYPES

  let track: TrackState | null = null

  const releaseCapture = () => {
    if (!track?.captureEl) return
    try {
      track.captureEl.releasePointerCapture(track.pointerId)
    } catch {
      /* already released */
    }
  }

  const reset = () => {
    releaseCapture()
    track = null
  }

  const decide = (
    dx: number,
    dy: number,
    dt: number,
    locked: 'x' | 'y',
  ): SwipeDirection | null => {
    if (axis !== 'both' && axis !== locked) return null

    const primary = locked === 'x' ? dx : dy
    const cross = locked === 'x' ? dy : dx
    if (Math.abs(primary) < Math.abs(cross) * axisRatio) return null

    const absPrimary = Math.abs(primary)
    const v = dt > 0 ? absPrimary / dt : 0
    if (absPrimary < distance && v < velocity) return null

    if (locked === 'x') return primary < 0 ? 'left' : 'right'
    return primary < 0 ? 'up' : 'down'
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!pointerTypes.includes(e.pointerType)) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.isPrimary === false) return
    if (opts.shouldIgnore?.(e)) return

    const target = e.currentTarget instanceof Element ? e.currentTarget : null
    track = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startT: e.timeStamp,
      locked: null,
      done: false,
      captureEl: target,
    }

    try {
      target?.setPointerCapture(e.pointerId)
    } catch {
      /* unsupported */
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!track || track.done || e.pointerId !== track.pointerId) return

    const dx = e.clientX - track.startX
    const dy = e.clientY - track.startY
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)

    if (!track.locked) {
      if (absX < slop && absY < slop) return
      if (absX > absY * 1.15) track.locked = 'x'
      else if (absY > absX * 1.15) track.locked = 'y'
      else if (absX >= slop * 2 || absY >= slop * 2) {
        track.locked = absX >= absY ? 'x' : 'y'
      }
    }
  }

  const finish = (e: PointerEvent) => {
    if (!track || e.pointerId !== track.pointerId) return
    if (track.done) {
      reset()
      return
    }

    const dx = e.clientX - track.startX
    const dy = e.clientY - track.startY
    const dt = Math.max(16, e.timeStamp - track.startT)
    const locked = track.locked
    track.done = true
    reset()

    if (!locked) return
    const dir = decide(dx, dy, dt, locked)
    if (dir) opts.onSwipe(dir)
  }

  const onPointerUp = (e: PointerEvent) => finish(e)

  const onPointerCancel = (e: PointerEvent) => {
    if (!track || e.pointerId !== track.pointerId) return
    reset()
  }

  const attach = (el: EventTarget) => {
    el.addEventListener('pointerdown', onPointerDown as EventListener)
    el.addEventListener('pointermove', onPointerMove as EventListener)
    el.addEventListener('pointerup', onPointerUp as EventListener)
    el.addEventListener('pointercancel', onPointerCancel as EventListener)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown as EventListener)
      el.removeEventListener('pointermove', onPointerMove as EventListener)
      el.removeEventListener('pointerup', onPointerUp as EventListener)
      el.removeEventListener('pointercancel', onPointerCancel as EventListener)
      reset()
    }
  }

  /** Movement past slop — cancel long-press / tap. */
  const movedPastSlop = () => {
    if (!track) return false
    // locked means we already passed slop
    return track.locked != null
  }

  return { attach, reset, movedPastSlop }
}

export type SwipeGesture = ReturnType<typeof createSwipeGesture>
