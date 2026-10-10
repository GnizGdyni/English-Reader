import { useEffect, type RefObject } from 'react'
import { createSwipeGesture } from '../lib/swipeGesture'

type Options = {
  onShow: () => void
  onHide: () => void
  /** Current chrome visibility — vertical swipe toggles show/hide. */
  visible?: boolean
  enabled?: boolean
}

/**
 * Vertical chrome toggle (touch/pen only).
 */
export function useChromeSwipe(
  targetRef: RefObject<HTMLElement | null>,
  { onShow, onHide, visible = true, enabled = true }: Options,
) {
  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return

    const gesture = createSwipeGesture({
      axis: 'y',
      distance: 72,
      velocity: 0.4,
      axisRatio: 1.6,
      shouldIgnore: (e) => {
        const t = e.target
        return (
          t instanceof Element &&
          Boolean(
            t.closest('.reader-top') ||
              t.closest('.reader-dock') ||
              t.closest('.word-popup') ||
              t.closest('.sentence-popup') ||
              t.closest('.translation-panel'),
          )
        )
      },
      onSwipe: () => {
        const sel = window.getSelection()?.toString().trim()
        if (sel) return
        if (visible) onHide()
        else onShow()
      },
    })

    return gesture.attach(el)
  }, [targetRef, onShow, onHide, visible, enabled])
}
