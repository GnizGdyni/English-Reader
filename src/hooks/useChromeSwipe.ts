import { useEffect, type RefObject } from 'react'

type Options = {
  onShow: () => void
  onHide: () => void
  enabled?: boolean
  /** Min vertical distance (px) to count as a chrome swipe. */
  threshold?: number
}

/**
 * Vertical swipe to show / hide mobile reader chrome (top + bottom).
 * Swipe up → show, swipe down → hide.
 * Ignores mostly-horizontal gestures (page flips) and text selection.
 */
export function useChromeSwipe(
  targetRef: RefObject<HTMLElement | null>,
  { onShow, onHide, enabled = true, threshold = 48 }: Options,
) {
  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return

    let startX = 0
    let startY = 0
    let tracking = false
    let pointerId: number | null = null

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      // Ignore UI chrome itself
      const t = e.target
      if (
        t instanceof Element &&
        (t.closest('.reader-top') ||
          t.closest('.reader-dock') ||
          t.closest('.word-popup') ||
          t.closest('.sentence-popup') ||
          t.closest('.translation-panel'))
      ) {
        return
      }
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
      if (Math.abs(dy) < threshold) return
      // Need clearly vertical gesture
      if (Math.abs(dy) < Math.abs(dx) * 1.25) return

      const sel = window.getSelection()?.toString().trim()
      if (sel) return

      if (dy < 0) onShow()
      else onHide()
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
  }, [targetRef, onShow, onHide, enabled, threshold])
}
