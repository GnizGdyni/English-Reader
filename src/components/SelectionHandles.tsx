import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  absoluteIndexAtPoint,
  getOffsetsEdgeRects,
} from '../lib/selection'

export type GripRange = { start: number; end: number }

type Props = {
  root: HTMLElement | null
  range: GripRange | null
  /** Extra offset when root lives in an iframe (EPUB). */
  frameOffset?: { top: number; left: number }
  onRangeChange: (range: GripRange) => void
  onTranslate: () => void
  onDismiss: () => void
}

type Layout = {
  start: { x: number; y: number }
  end: { x: number; y: number }
  barTop: number
  barLeft: number
  bands: Array<{ top: number; left: number; width: number; height: number }>
}

/**
 * Custom selection grips — no native Selection API.
 * Highlight is painted as overlay bands; offsets live in React state.
 * Avoids mobile browsers clearing selection / blocking the page.
 */
export function SelectionHandles({
  root,
  range,
  frameOffset,
  onRangeChange,
  onTranslate,
  onDismiss,
}: Props) {
  const ox = frameOffset?.left ?? 0
  const oy = frameOffset?.top ?? 0
  const [layout, setLayout] = useState<Layout | null>(null)
  const dragRef = useRef<'start' | 'end' | null>(null)
  const rootRef = useRef(root)
  rootRef.current = root
  const rangeRef = useRef(range)
  rangeRef.current = range
  const rafRef = useRef(0)

  const syncLayout = useCallback(() => {
    const el = rootRef.current
    const r = rangeRef.current
    if (!el || !r) {
      setLayout(null)
      return
    }
    const edges = getOffsetsEdgeRects(el, r.start, r.end)
    if (!edges) {
      setLayout(null)
      return
    }

    const startX = edges.start.left + ox
    const startY = edges.start.bottom + oy
    const endX = edges.end.right + ox
    const endY = edges.end.bottom + oy

    setLayout({
      start: { x: startX, y: startY },
      end: { x: endX, y: endY },
      barTop: startY - 8,
      barLeft: startX,
      bands: edges.bands.map((b) => ({
        top: b.top + oy,
        left: b.left + ox,
        width: b.width,
        height: b.height,
      })),
    })
  }, [ox, oy])

  const syncLayoutRaf = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      syncLayout()
    })
  }, [syncLayout])

  useEffect(() => {
    if (!range) {
      setLayout(null)
      return
    }
    const t = window.setTimeout(() => syncLayout(), 0)
    return () => clearTimeout(t)
  }, [range, root, syncLayout])

  useEffect(() => {
    if (!range) return
    const onScroll = () => syncLayoutRaf()
    const onResize = () => syncLayoutRaf()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [range, syncLayoutRaf])

  useEffect(() => {
    if (!range) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [range, onDismiss])

  const onHandleDown = (
    which: 'start' | 'end',
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = which
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return
    e.preventDefault()
    const el = rootRef.current
    const r = rangeRef.current
    if (!el || !r) return

    const idx = absoluteIndexAtPoint(el, e.clientX - ox, e.clientY - oy)
    if (idx == null) return

    let start = r.start
    let end = r.end
    if (dragRef.current === 'start') {
      start = Math.min(idx, end - 1)
    } else {
      end = Math.max(idx, start + 1)
    }
    if (start === r.start && end === r.end) return
    onRangeChange({ start, end })
  }

  const onHandleUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    syncLayout()
  }

  if (!range || !layout) return null

  const barLeft = Math.max(8, Math.min(layout.barLeft, window.innerWidth - 120))

  return createPortal(
    <div className="sel-handles">
      {layout.bands.map((b, i) => (
        <div
          key={i}
          className="sel-handles__band"
          style={{
            top: b.top,
            left: b.left,
            width: b.width,
            height: b.height,
          }}
        />
      ))}

      <button
        type="button"
        className="sel-handles__bar"
        style={{
          top: Math.max(8, layout.barTop),
          left: barLeft,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onTranslate()
        }}
      >
        Tłumacz
      </button>

      <button
        type="button"
        className="sel-handles__grip sel-handles__grip--start"
        style={{ left: layout.start.x, top: layout.start.y }}
        aria-label="Początek zaznaczenia"
        onPointerDown={(e) => onHandleDown('start', e)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      />
      <button
        type="button"
        className="sel-handles__grip sel-handles__grip--end"
        style={{ left: layout.end.x, top: layout.end.y }}
        aria-label="Koniec zaznaczenia"
        onPointerDown={(e) => onHandleDown('end', e)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      />
    </div>,
    document.body,
  )
}
