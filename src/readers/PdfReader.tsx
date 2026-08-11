import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  setLayerDimensions,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import {
  lookupAtPoint,
  selectionLookup,
} from '../lib/selection'
import { usePageSwipe } from '../hooks/usePageSwipe'
import './pdf-text-layer.css'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Props = {
  url: string
  onLookup: (term: string, context?: string) => void
  onNavLabel: (label: string) => void
}

export function PdfReader({ url, onLookup, onNavLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const pointerStart = useRef({ x: 0, y: 0 })
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const goPrev = useCallback(() => {
    setPage((p) => Math.max(1, p - 1))
  }, [])

  const goNext = useCallback(() => {
    setPage((p) => Math.min(pageCount || p, p + 1))
  }, [pageCount])

  usePageSwipe(wrapRef, {
    onPrev: goPrev,
    onNext: goNext,
    enabled: pageCount > 0,
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
        setPage(1)
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
      void pdfRef.current?.cleanup()
      pdfRef.current = null
      void loadingTask?.destroy()
    }
  }, [url])

  useEffect(() => {
    onNavLabel(pageCount ? `Strona ${page} / ${pageCount}` : '')
  }, [page, pageCount, onNavLabel])

  useEffect(() => {
    const pdf = pdfRef.current
    const canvas = canvasRef.current
    const textLayerDiv = textLayerRef.current
    if (!pdf || !canvas || !textLayerDiv || page < 1) return

    let cancelled = false

    ;(async () => {
      const pdfPage = await pdf.getPage(page)
      if (cancelled) return

      const base = pdfPage.getViewport({ scale: 1 })
      const containerWidth = wrapRef.current?.clientWidth ?? 720
      const isNarrow = containerWidth < 500
      const maxScale = isNarrow ? 1.1 : 1.6
      const scale = Math.min(
        maxScale,
        Math.max(0.85, (containerWidth - 24) / base.width),
      )
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

      await pdfPage.render({ canvasContext: ctx, viewport }).promise

      if (cancelled) return

      const textContent = await pdfPage.getTextContent()
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      })
      await textLayer.render()

      wrapRef.current?.scrollTo({ top: 0 })
    })().catch((err: unknown) => {
      if (cancelled) return
      setError(
        err instanceof Error ? err.message : 'Błąd renderowania strony PDF.',
      )
    })

    return () => {
      cancelled = true
    }
  }, [page, pageCount, loading])

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
    <div className="pdf-reader">
      <div className="reader-nav reader-nav--sticky">
        <button type="button" disabled={page <= 1} onClick={goPrev}>
          ← Poprzednia
        </button>
        <span className="reader-nav__page">
          {pageCount ? `${page} / ${pageCount}` : '—'}
        </span>
        <button
          type="button"
          disabled={!pageCount || page >= pageCount}
          onClick={goNext}
        >
          Następna →
        </button>
      </div>

      {loading && <p className="reader-status">Ładowanie PDF…</p>}
      {error && <p className="error-banner">{error}</p>}

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
      <p className="reader-hint">
        Dotknij słowo · przeciągnij w bok, by zmienić stronę
      </p>
    </div>
  )
}
