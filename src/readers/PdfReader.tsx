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
} from '../lib/selection'
import { usePageSwipe } from '../hooks/usePageSwipe'
import './pdf-text-layer.css'

function isRenderCancelled(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'RenderingCancelledException' || err.name === 'AbortException')
  )
}

type Props = {
  url: string
  focusMode?: boolean
  swipeEnabled?: boolean
  initialPage?: number
  onLookup: (term: string, context?: string) => void
  onNavLabel: (label: string) => void
  onPageChange?: (page: number) => void
}

export function PdfReader({
  url,
  focusMode = false,
  swipeEnabled = true,
  initialPage = 1,
  onLookup,
  onNavLabel,
  onPageChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const pointerStart = useRef({ x: 0, y: 0 })
  const activeRenderRef = useRef<{ cancel: () => void } | null>(null)
  const activeTextLayerRef = useRef<{ cancel: () => void } | null>(null)
  const [page, setPage] = useState(() => Math.max(1, initialPage))
  const [pageCount, setPageCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [layoutKey, setLayoutKey] = useState(0)

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

    loadingTask = getDocument({ url, useSystemFonts: true })
    loadingTask.promise
      .then((pdf) => {
        if (cancelled) {
          void pdf.cleanup()
          return
        }
        pdfRef.current = pdf
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
      loadingTask = null
      // Destroy in order: document first, then the loading task.
      // Both calls are async but cleanup can't be awaited in useEffect cleanup.
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

      const base = pdfPage.getViewport({ scale: 1 })
      const wrap = wrapRef.current
      const containerWidth = wrap?.clientWidth ?? 720
      const containerHeight = wrap?.clientHeight ?? 900
      const padX = focusMode ? 4 : 16
      const padY = focusMode ? 4 : 12

      // Fit entire page in the viewport — no scrolling a single PDF page.
      const scaleByWidth = (containerWidth - padX * 2) / base.width
      const scaleByHeight = (containerHeight - padY * 2) / base.height
      const scale = Math.max(0.2, Math.min(scaleByWidth, scaleByHeight))
      const viewport = pdfPage.getViewport({ scale })

      const pageEl = wrapRef.current?.querySelector(
        '.pdf-page',
      ) as HTMLElement | null
      if (pageEl) {
        pageEl.style.setProperty('--scale-factor', String(scale))
      }

      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return

      const w = Math.floor(viewport.width)
      const h = Math.floor(viewport.height)
      if (w * h > 16_000_000) {
        throw new Error('Strona PDF jest za duża na ten telefon.')
      }

      canvas.width = w
      canvas.height = h
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      textLayerDiv.innerHTML = ''
      textLayerDiv.className = 'textLayer'
      setLayerDimensions(textLayerDiv, viewport)

      const renderTask = pdfPage.render({ canvasContext: ctx, viewport })
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

  const runLookup = useCallback(
    (clientX: number, clientY: number) => {
      const layer = textLayerRef.current
      if (!layer) return

      const selected = selectionLookup(layer)
      if (selected) {
        onLookup(selected.term, selected.context)
        return
      }

      const hit = lookupAtPoint(layer, clientX, clientY)
      if (hit) onLookup(hit.term, hit.context)
    },
    [onLookup],
  )

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY }
    textLayerRef.current?.classList.add('selecting')
  }, [])

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      textLayerRef.current?.classList.remove('selecting')

      const dx = Math.abs(e.clientX - pointerStart.current.x)
      const dy = Math.abs(e.clientY - pointerStart.current.y)
      if (dx > 24 || dy > 24) return

      window.setTimeout(() => {
        runLookup(e.clientX, e.clientY)
      }, 50)
    },
    [runLookup],
  )

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
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
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
    </div>
  )
}
