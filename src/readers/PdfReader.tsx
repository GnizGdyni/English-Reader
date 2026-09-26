import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDocument,
  TextLayer,
  setLayerDimensions,
  type PDFDocumentProxy,
} from '../lib/pdfjs'
import {
  lookupAtPoint,
  selectionLookup,
  highlightLookup,
  clearLookupHighlight,
  sentenceAtPoint,
  getHighlightAnchorRect,
  lookupFromOffsets,
  invalidateTextIndex,
} from '../lib/selection'
import {
  contentBoxFromInsets,
  estimatePdfCropInsets,
  type PdfCropInsets,
} from '../lib/pdfContentBox'
import { usePageSwipe } from '../hooks/usePageSwipe'
import { usePressLookup } from '../hooks/usePressLookup'
import {
  SelectionHandles,
  type GripRange,
} from '../components/SelectionHandles'
import './pdf-text-layer.css'

function isRenderCancelled(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'RenderingCancelledException' || err.name === 'AbortException')
  )
}

export type SentenceLookupPayload = {
  sentence: string
  anchor: { top: number; left: number; width: number; height: number }
}

type Props = {
  url: string
  focusMode?: boolean
  swipeEnabled?: boolean
  initialPage?: number
  keepHighlight?: boolean
  onLookup: (term: string, context?: string) => void
  onSentenceLookup?: (payload: SentenceLookupPayload) => void
  onNavLabel: (label: string) => void
  onPageChange?: (page: number) => void
}

export function PdfReader({
  url,
  focusMode = false,
  swipeEnabled = true,
  initialPage = 1,
  keepHighlight = false,
  onLookup,
  onSentenceLookup,
  onNavLabel,
  onPageChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const cropInsetsRef = useRef<PdfCropInsets | null>(null)
  const activeRenderRef = useRef<{ cancel: () => void } | null>(null)
  const activeTextLayerRef = useRef<{ cancel: () => void } | null>(null)
  const [page, setPage] = useState(() => Math.max(1, initialPage))
  const [pageCount, setPageCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [layoutKey, setLayoutKey] = useState(0)
  const [gripRange, setGripRange] = useState<GripRange | null>(null)

  const initialPageRef = useRef(initialPage)
  initialPageRef.current = initialPage

  const goPrev = useCallback(() => {
    setPage((p) => Math.max(1, p - 1))
  }, [])

  const goNext = useCallback(() => {
    setPage((p) => Math.min(pageCount || p, p + 1))
  }, [pageCount])

  const cancelPageRender = useCallback(() => {
    activeTextLayerRef.current?.cancel()
    activeTextLayerRef.current = null
    activeRenderRef.current?.cancel()
    activeRenderRef.current = null
  }, [])

  usePageSwipe(wrapRef, {
    onPrev: goPrev,
    onNext: goNext,
    enabled: pageCount > 0 && swipeEnabled,
  })

  useEffect(() => {
    let cancelled = false
    let loadingTask: ReturnType<typeof getDocument> | null = null
    setLoading(true)
    setError(null)

    cropInsetsRef.current = null
    loadingTask = getDocument({ url, useSystemFonts: true })
    loadingTask.promise
      .then(async (pdf) => {
        if (cancelled) {
          void pdf.cleanup()
          return
        }
        const insets = await estimatePdfCropInsets(pdf)
        if (cancelled) {
          void pdf.cleanup()
          return
        }
        pdfRef.current = pdf
        cropInsetsRef.current = insets
        setPageCount(pdf.numPages)
        const start = Math.min(
          Math.max(1, initialPageRef.current),
          pdf.numPages,
        )
        setPage(start)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg =
          err instanceof Error ? err.message : 'Nie udało się wczytać pliku PDF.'
        setError(msg)
        setLoading(false)
      })

    return () => {
      cancelled = true
      cancelPageRender()
      const task = loadingTask
      const doc = pdfRef.current
      pdfRef.current = null
      cropInsetsRef.current = null
      loadingTask = null
      void doc?.cleanup().then(() => task?.destroy())
    }
  }, [url, cancelPageRender])

  useEffect(() => {
    onNavLabel(pageCount ? `Strona ${page} / ${pageCount}` : '')
    onPageChange?.(page)
  }, [page, pageCount, onNavLabel, onPageChange])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let timer: ReturnType<typeof setTimeout>
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setLayoutKey((k) => k + 1), 150)
    })
    ro.observe(wrap)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    const pdf = pdfRef.current
    const canvas = canvasRef.current
    const textLayerDiv = textLayerRef.current
    if (!pdf || !canvas || !textLayerDiv || page < 1) return

    let cancelled = false
    cancelPageRender()

    ;(async () => {
      if (focusMode) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
      }
      if (cancelled) return

      const pdfPage = await pdf.getPage(page)
      if (cancelled) return

      const insets = cropInsetsRef.current
      const contentBox = insets
        ? contentBoxFromInsets(pdfPage.view, insets)
        : null

      const base = pdfPage.getViewport({ scale: 1 })
      const wrap = wrapRef.current
      const containerWidth = wrap?.clientWidth ?? 720
      const containerHeight = wrap?.clientHeight ?? 900
      const padX = focusMode ? 4 : 12
      const padY = focusMode ? 4 : 10

      const contentW = contentBox
        ? contentBox.maxX - contentBox.minX
        : base.width
      const contentH = contentBox
        ? contentBox.maxY - contentBox.minY
        : base.height

      const scaleByWidth = (containerWidth - padX * 2) / contentW
      const scaleByHeight = (containerHeight - padY * 2) / contentH
      const scale = Math.max(0.2, Math.min(scaleByWidth, scaleByHeight))
      const viewport = pdfPage.getViewport({ scale })

      let cropLeft = 0
      let cropTop = 0
      let cropW = viewport.width
      let cropH = viewport.height

      if (contentBox) {
        const [vx0, vy0] = viewport.convertToViewportPoint(
          contentBox.minX,
          contentBox.maxY,
        )
        const [vx1, vy1] = viewport.convertToViewportPoint(
          contentBox.maxX,
          contentBox.minY,
        )
        cropLeft = Math.min(vx0, vx1)
        cropTop = Math.min(vy0, vy1)
        cropW = Math.abs(vx1 - vx0)
        cropH = Math.abs(vy1 - vy0)
      }

      const pageEl = wrapRef.current?.querySelector(
        '.pdf-page',
      ) as HTMLElement | null
      if (pageEl) {
        pageEl.style.setProperty('--scale-factor', String(scale))
        pageEl.style.width = `${Math.ceil(cropW)}px`
        pageEl.style.height = `${Math.ceil(cropH)}px`
      }

      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return

      const outW = Math.floor(cropW)
      const outH = Math.floor(cropH)
      if (outW * outH > 16_000_000) {
        throw new Error('Strona PDF jest za duża na ten telefon.')
      }

      canvas.width = outW
      canvas.height = outH
      canvas.style.width = `${outW}px`
      canvas.style.height = `${outH}px`

      textLayerDiv.innerHTML = ''
      textLayerDiv.className = 'textLayer'
      setLayerDimensions(textLayerDiv, viewport)
      textLayerDiv.style.width = `${Math.floor(viewport.width)}px`
      textLayerDiv.style.height = `${Math.floor(viewport.height)}px`
      textLayerDiv.style.left = `${-cropLeft}px`
      textLayerDiv.style.top = `${-cropTop}px`

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, outW, outH)

      const renderTask = pdfPage.render({
        canvasContext: ctx,
        viewport,
        transform:
          contentBox && (cropLeft !== 0 || cropTop !== 0)
            ? [1, 0, 0, 1, -cropLeft, -cropTop]
            : undefined,
      })
      activeRenderRef.current = renderTask
      try {
        await renderTask.promise
      } catch (err) {
        if (cancelled || isRenderCancelled(err)) return
        throw err
      }
      if (cancelled) return
      activeRenderRef.current = null

      const textContent = await pdfPage.getTextContent()
      if (cancelled) return

      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      })
      activeTextLayerRef.current = textLayer
      try {
        await textLayer.render()
      } catch (err) {
        if (cancelled || isRenderCancelled(err)) return
        throw err
      }
      if (cancelled) return
      activeTextLayerRef.current = null

      wrapRef.current?.scrollTo({ top: 0 })
    })().catch((err: unknown) => {
      if (cancelled || isRenderCancelled(err)) return
      setError(
        err instanceof Error ? err.message : 'Błąd renderowania strony PDF.',
      )
    })

    return () => {
      cancelled = true
      cancelPageRender()
    }
  }, [page, pageCount, loading, focusMode, layoutKey, cancelPageRender])

  const clearGrips = useCallback(() => {
    setGripRange(null)
  }, [])

  const runWordLookup = useCallback(
    (clientX: number, clientY: number) => {
      const layer = textLayerRef.current
      if (!layer) return

      if (gripRange) {
        clearGrips()
        return
      }

      const selected = selectionLookup(layer)
      if (selected) {
        highlightLookup(layer, selected)
        onLookup(selected.term, selected.context)
        return
      }

      const hit = lookupAtPoint(layer, clientX, clientY)
      if (hit) {
        highlightLookup(layer, hit)
        onLookup(hit.term, hit.context)
      }
    },
    [onLookup, gripRange, clearGrips],
  )

  const translateGrips = useCallback(() => {
    const layer = textLayerRef.current
    if (!layer || !gripRange) return
    const payload = lookupFromOffsets(layer, gripRange.start, gripRange.end)
    if (!payload) {
      clearGrips()
      return
    }
    highlightLookup(layer, payload)
    onLookup(payload.term, payload.context)
    setGripRange(null)
  }, [onLookup, gripRange, clearGrips])

  const openGripsAt = useCallback((clientX: number, clientY: number) => {
    const layer = textLayerRef.current
    if (!layer) return
    // Own offsets + overlay — never toggle .selecting (that covers the page
    // with .endOfContent and freezes taps on mobile).
    const hit = lookupAtPoint(layer, clientX, clientY)
    if (!hit?.highlight) return
    layer.ownerDocument.getSelection()?.removeAllRanges()
    setGripRange({ start: hit.highlight.start, end: hit.highlight.end })
  }, [])

  const runSentenceLookup = useCallback(
    (clientX: number, clientY: number) => {
      const layer = textLayerRef.current
      if (!layer || !onSentenceLookup) return
      clearGrips()

      const hit = sentenceAtPoint(layer, clientX, clientY)
      if (!hit?.highlight) return

      highlightLookup(
        layer,
        hit,
        'lookup-highlight lookup-highlight--sentence',
      )
      const rect = getHighlightAnchorRect(layer)
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

  useEffect(() => {
    if (!keepHighlight) {
      clearLookupHighlight(textLayerRef.current)
    }
  }, [keepHighlight])

  useEffect(() => {
    clearGrips()
    invalidateTextIndex(textLayerRef.current)
  }, [page, clearGrips])

  const press = usePressLookup({
    onTap: runWordLookup,
    onDoubleTap: runSentenceLookup,
    onLongPress: openGripsAt,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goNext()
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') goPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev])

  return (
    <div className={`pdf-reader${focusMode ? ' pdf-reader--focus' : ''}`}>
      {loading && <p className="reader-status">Ładowanie PDF…</p>}
      {error && <p className="error-banner">{error}</p>}

      <div className="pdf-stage">
        <div className="pdf-wrap" ref={wrapRef}>
          <div className="pdf-page">
            <canvas ref={canvasRef} />
            <div
              ref={textLayerRef}
              className="textLayer"
              onPointerDown={press.onPointerDown}
              onPointerMove={press.onPointerMove}
              onPointerUp={press.onPointerUp}
              onPointerCancel={press.onPointerCancel}
              onDoubleClick={press.onDoubleClick}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
        </div>

        <nav className="reader-nav reader-nav--pdf" aria-label="Nawigacja stron">
          <button
            type="button"
            className="reader-nav__prev"
            disabled={page <= 1}
            onClick={goPrev}
            aria-label="Poprzednia strona"
          >
            ←
          </button>
          <span className="reader-nav__page">
            {pageCount ? `${page} / ${pageCount}` : '—'}
          </span>
          <button
            type="button"
            className="reader-nav__next"
            disabled={!pageCount || page >= pageCount}
            onClick={goNext}
            aria-label="Następna strona"
          >
            →
          </button>
        </nav>
      </div>

      <SelectionHandles
        root={textLayerRef.current}
        range={gripRange}
        onRangeChange={setGripRange}
        onTranslate={translateGrips}
        onDismiss={clearGrips}
      />
    </div>
  )
}
