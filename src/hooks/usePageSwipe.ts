import { useEffect, type RefObject } from 'react'

type Options = {
  onPrev: () => void
  onNext: () => void
  enabled?: boolean
  /** Min horizontal distance (px) to count as a page swipe. */
  threshold?: number
}

/**
 * Horizontal swipe / drag on an element to flip pages.
 * Ignores mostly-vertical scrolls and small movements (text selection).
 */
export function usePageSwipe(
  targetRef: RefObject<HTMLElement | null>,
  { onPrev, onNext, enabled = true, threshold = 56 }: Options,
) {
  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return

    let startX = 0
    let startY = 0
    let tracking = false
    let pointerId: number | null = null

    const onPointerDown = (e: PointerEvent) => {
      // Only primary touch / left mouse; ignore multi-touch pinch
      if (e.pointerType === 'mouse' && e.button !== 0) return
      tracking = true
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!tracking || (pointerId != null && e.pointerId !== pointerId)) return
      tracking = false
      pointerId = null

      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) < threshold) return
      // Need clearly horizontal gesture
      if (Math.abs(dx) < Math.abs(dy) * 1.2) return

      // Don't flip if user selected text
      const sel = window.getSelection()?.toString().trim()
      if (sel) return

      if (dx < 0) onNext()
      else onPrev()
    }

    const onPointerCancel = () => {
      tracking = false
      pointerId = null
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [targetRef, onPrev, onNext, enabled, threshold])
}
