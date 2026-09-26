import { useCallback, useEffect, useRef, useState } from 'react'
import {
  lookupAtPoint,
  selectionLookup,
  highlightLookup,
  clearLookupHighlight,
  sentenceAtPoint,
  getHighlightAnchorRect,
  lookupFromOffsets,
} from '../lib/selection'
import { usePressLookup } from '../hooks/usePressLookup'
import {
  SelectionHandles,
  type GripRange,
} from '../components/SelectionHandles'
import type { SentenceLookupPayload } from './PdfReader'

type Props = {
  file: File
  focusMode?: boolean
  keepHighlight?: boolean
  onLookup: (term: string, context?: string) => void
  onSentenceLookup?: (payload: SentenceLookupPayload) => void
  onNavLabel: (label: string) => void
}

export function TxtReader({
  file,
  focusMode = false,
  keepHighlight = false,
  onLookup,
  onSentenceLookup,
  onNavLabel,
}: Props) {
  const articleRef = useRef<HTMLElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [gripRange, setGripRange] = useState<GripRange | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReady(false)
    setError(null)
    onNavLabel('Tekst')

    file
      .text()
      .then((content) => {
        if (cancelled) return
        const el = articleRef.current
        if (el) el.textContent = content
        setLoading(false)
        setReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : 'Nie udało się wczytać pliku tekstowego.',
        )
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [file, onNavLabel])

  useEffect(() => {
    if (!keepHighlight) {
      clearLookupHighlight(articleRef.current)
    }
  }, [keepHighlight])

  const clearGrips = useCallback(() => {
    setGripRange(null)
  }, [])

  const runWordLookup = useCallback(
    (clientX: number, clientY: number) => {
      const el = articleRef.current
      if (!el) return

      if (gripRange) {
        clearGrips()
        return
      }

      const selected = selectionLookup(el)
      if (selected) {
        highlightLookup(el, selected)
        onLookup(selected.term, selected.context)
        return
      }

      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim()) return

      const hit = lookupAtPoint(el, clientX, clientY)
      if (hit) {
        highlightLookup(el, hit)
        onLookup(hit.term, hit.context)
      }
    },
    [onLookup, gripRange, clearGrips],
  )

  const translateGrips = useCallback(() => {
    const el = articleRef.current
    if (!el || !gripRange) return
    const payload = lookupFromOffsets(el, gripRange.start, gripRange.end)
    if (!payload) {
      clearGrips()
      return
    }
    highlightLookup(el, payload)
    onLookup(payload.term, payload.context)
    setGripRange(null)
  }, [onLookup, gripRange, clearGrips])

  const openGripsAt = useCallback((clientX: number, clientY: number) => {
    const el = articleRef.current
    if (!el) return
    const hit = lookupAtPoint(el, clientX, clientY)
    if (!hit?.highlight) return
    el.ownerDocument.getSelection()?.removeAllRanges()
    setGripRange({ start: hit.highlight.start, end: hit.highlight.end })
  }, [])

  const runSentenceLookup = useCallback(
    (clientX: number, clientY: number) => {
      const el = articleRef.current
      if (!el || !onSentenceLookup) return
      clearGrips()

      const hit = sentenceAtPoint(el, clientX, clientY)
      if (!hit?.highlight) return

      highlightLookup(
        el,
        hit,
        'lookup-highlight lookup-highlight--sentence',
      )
      const rect = getHighlightAnchorRect(el)
      if (!rect) return

      onSentenceLookup({
        sentence: hit.term,
        anchor: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
      })
    },
    [onSentenceLookup, clearGrips],
  )

  const press = usePressLookup({
    onTap: runWordLookup,
    onDoubleTap: runSentenceLookup,
    onLongPress: openGripsAt,
  })

  return (
    <div className={`txt-reader${focusMode ? ' txt-reader--focus' : ''}`}>
      {loading && <p className="reader-status">Ładowanie tekstu…</p>}
      {error && <p className="error-banner">{error}</p>}
      <article
        ref={articleRef}
        className="txt-article"
        hidden={loading || Boolean(error) || !ready}
        onPointerDown={press.onPointerDown}
        onPointerMove={press.onPointerMove}
        onPointerUp={press.onPointerUp}
        onPointerCancel={press.onPointerCancel}
        onDoubleClick={press.onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      <SelectionHandles
        root={articleRef.current}
        range={gripRange}
        onRangeChange={setGripRange}
        onTranslate={translateGrips}
        onDismiss={clearGrips}
      />
    </div>
  )
}
