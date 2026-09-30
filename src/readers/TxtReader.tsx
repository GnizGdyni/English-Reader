import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
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
import type { SentenceLookupPayload, LookupAnchor } from './PdfReader'
import type { ReaderNavHandle, ReaderNavSnapshot } from '../types'

type Props = {
  file: File
  focusMode?: boolean
  keepHighlight?: boolean
  onLookup: (term: string, context?: string, anchor?: LookupAnchor) => void
  onSentenceLookup?: (payload: SentenceLookupPayload) => void
  onNavLabel: (label: string) => void
  onProgress?: (percent: number) => void
  onNavState?: (state: ReaderNavSnapshot) => void
}

function anchorFromRoot(root: HTMLElement): LookupAnchor | undefined {
  const rect = getHighlightAnchorRect(root)
  if (!rect) return undefined
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

export const TxtReader = forwardRef<ReaderNavHandle, Props>(function TxtReader(
  {
    file,
    focusMode = false,
    keepHighlight = false,
    onLookup,
    onSentenceLookup,
    onNavLabel,
    onProgress,
    onNavState,
  },
  ref,
) {
  const articleRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const onNavStateRef = useRef(onNavState)
  onNavStateRef.current = onNavState
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [gripRange, setGripRange] = useState<GripRange | null>(null)

  const reportScroll = useCallback(() => {
    const root = scrollRef.current
    if (!root) return
    const max = root.scrollHeight - root.clientHeight
    const percent =
      max <= 0 ? 100 : Math.min(100, Math.round((root.scrollTop / max) * 100))
    onProgressRef.current?.(percent)
    onNavStateRef.current?.({
      page: 1,
      totalPages: null,
      percent,
      canPrev: root.scrollTop > 0,
      canNext: max > 0 && root.scrollTop < max - 1,
    })
  }, [])

  const goPrev = useCallback(() => {
    const root = scrollRef.current
    if (!root) return
    root.scrollBy({ top: -Math.max(120, root.clientHeight * 0.85), behavior: 'smooth' })
  }, [])

  const goNext = useCallback(() => {
    const root = scrollRef.current
    if (!root) return
    root.scrollBy({ top: Math.max(120, root.clientHeight * 0.85), behavior: 'smooth' })
  }, [])

  const seekPercent = useCallback((percent: number) => {
    const root = scrollRef.current
    if (!root) return
    const max = root.scrollHeight - root.clientHeight
    if (max <= 0) return
    root.scrollTop = (Math.min(100, Math.max(0, percent)) / 100) * max
    reportScroll()
  }, [reportScroll])

  useImperativeHandle(
    ref,
    () => ({ goPrev, goNext, seekPercent }),
    [goPrev, goNext, seekPercent],
  )

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
    if (!ready) return
    const root = scrollRef.current
    if (!root) return
    reportScroll()
    root.addEventListener('scroll', reportScroll, { passive: true })
    return () => root.removeEventListener('scroll', reportScroll)
  }, [ready, reportScroll, file])

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
        const multi = /\s/.test(selected.term)
        highlightLookup(
          el,
          selected,
          multi
            ? 'lookup-highlight lookup-highlight--sentence'
            : 'lookup-highlight',
        )
        const anchor = anchorFromRoot(el)
        if (multi && onSentenceLookup && anchor) {
          onSentenceLookup({ sentence: selected.term, anchor })
          return
        }
        onLookup(selected.term, selected.context, anchor)
        return
      }

      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim()) return

      const hit = lookupAtPoint(el, clientX, clientY)
      if (hit) {
        highlightLookup(el, hit)
        onLookup(hit.term, hit.context, anchorFromRoot(el))
      }
    },
    [onLookup, onSentenceLookup, gripRange, clearGrips],
  )

  const translateGrips = useCallback(() => {
    const el = articleRef.current
    if (!el || !gripRange) return
    const payload = lookupFromOffsets(el, gripRange.start, gripRange.end)
    if (!payload) {
      clearGrips()
      return
    }
    highlightLookup(
      el,
      payload,
      'lookup-highlight lookup-highlight--sentence',
    )
    const anchor = anchorFromRoot(el)
    setGripRange(null)
    if (onSentenceLookup && anchor) {
      onSentenceLookup({ sentence: payload.term, anchor })
      return
    }
    onLookup(payload.term, payload.context, anchor)
  }, [onLookup, onSentenceLookup, gripRange, clearGrips])

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
    <div
      ref={scrollRef}
      className={`txt-reader${focusMode ? ' txt-reader--focus' : ''}`}
    >      {loading && <p className="reader-status">Ładowanie tekstu…</p>}
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
})
