import { useEffect, type RefObject } from 'react'
import { createSwipeGesture } from '../lib/swipeGesture'

type Options = {
  onPrev: () => void
  onNext: () => void
  enabled?: boolean
}

/**
 * Horizontal page swipe (touch/pen only).
 * Mouse is ignored — desktop uses nav buttons; drag selects text.
 */
export function usePageSwipe(
  targetRef: RefObject<HTMLElement | null>,
  { onPrev, onNext, enabled = true }: Options,
) {
  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return

    const gesture = createSwipeGesture({
      axis: 'x',
      distance: 64,
      velocity: 0.45,
      axisRatio: 1.6,
      onSwipe: (dir) => {
        const sel = window.getSelection()?.toString().trim()
        if (sel) return
        if (dir === 'left') onNext()
        else if (dir === 'right') onPrev()
      },
    })

    return gesture.attach(el)
  }, [targetRef, onPrev, onNext, enabled])
}
