import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  enabled: boolean
  onScaleChange?: (scale: number) => void
  children: ReactNode
}

function touchDistance(touches: TouchList): number {
  const dx = touches[0]!.clientX - touches[1]!.clientX
  const dy = touches[0]!.clientY - touches[1]!.clientY
  return Math.hypot(dx, dy)
}

/** Pinch-to-zoom + drag when zoomed in (focus reading mode). */
export function ZoomPane({ enabled, onScaleChange, children }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })

  const transformRef = useRef(transform)
  transformRef.current = transform

  const pinchRef = useRef({
    mode: 'none' as 'none' | 'pinch' | 'pan',
    startDistance: 0,
    startScale: 1,
    panOriginX: 0,
    panOriginY: 0,
    panStartX: 0,
    panStartY: 0,
  })

  const apply = useCallback(
    (next: { scale: number; x: number; y: number }) => {
      const scale = Math.min(3, Math.max(1, next.scale))
      const x = scale <= 1.01 ? 0 : next.x
      const y = scale <= 1.01 ? 0 : next.y
      const t = { scale, x, y }
      setTransform(t)
      onScaleChange?.(scale)
    },
    [onScaleChange],
  )

  useEffect(() => {
    if (!enabled) {
      setTransform({ scale: 1, x: 0, y: 0 })
      onScaleChange?.(1)
    }
  }, [enabled, onScaleChange])

  useEffect(() => {
    const el = viewportRef.current
    if (!el || !enabled) return

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const g = pinchRef.current
        g.mode = 'pinch'
        g.startDistance = touchDistance(e.touches)
        g.startScale = transformRef.current.scale
        e.preventDefault()
      } else if (e.touches.length === 1 && transformRef.current.scale > 1.02) {
        const g = pinchRef.current
        g.mode = 'pan'
        g.panOriginX = e.touches[0]!.clientX
        g.panOriginY = e.touches[0]!.clientY
        g.panStartX = transformRef.current.x
        g.panStartY = transformRef.current.y
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      const g = pinchRef.current
      if (g.mode === 'pinch' && e.touches.length >= 2) {
        e.preventDefault()
        const dist = touchDistance(e.touches)
        if (g.startDistance > 0) {
          apply({
            scale: g.startScale * (dist / g.startDistance),
            x: transformRef.current.x,
            y: transformRef.current.y,
          })
        }
      } else if (g.mode === 'pan' && e.touches.length === 1) {
        e.preventDefault()
        const dx = e.touches[0]!.clientX - g.panOriginX
        const dy = e.touches[0]!.clientY - g.panOriginY
        apply({
          scale: transformRef.current.scale,
          x: g.panStartX + dx,
          y: g.panStartY + dy,
        })
      }
    }

    const onTouchEnd = () => {
      pinchRef.current.mode = 'none'
    }

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.92 : 1.08
      apply({
        scale: transformRef.current.scale * delta,
        x: transformRef.current.x,
        y: transformRef.current.y,
      })
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [enabled, apply])

  const resetZoom = () => apply({ scale: 1, x: 0, y: 0 })

  // Keep the same wrapper DOM so reader components don't remount on toggle.
  return (
    <div
      className={`zoom-pane${enabled ? '' : ' zoom-pane--disabled'}`}
      ref={viewportRef}
    >
      <div
        className="zoom-pane__content"
        style={
          enabled
            ? {
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              }
            : undefined
        }
      >
        {children}
      </div>
      {enabled && transform.scale > 1.05 && (
        <button
          type="button"
          className="zoom-pane__reset"
          onClick={resetZoom}
          aria-label="Resetuj powiększenie"
        >
          1×
        </button>
      )}
    </div>
  )
}
