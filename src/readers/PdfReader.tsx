import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  setLayerDimensions,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import {
  lookupAtPoint,
  normalizeTerm,
  selectionLookup,
} from '../lib/selection'
import { usePageSwipe } from '../hooks/usePageSwipe'
import './pdf-text-layer.css'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

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

    loadingTask = getDocument({ url })
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
        setError(
          err instanceof Error
            ? err.message
            : 'Nie udało się wczytać pliku PDF.',
        )
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
      const scale = Math.min(1.6, Math.max(1, (containerWidth - 32) / base.width))
      const viewport = pdfPage.getViewport({ scale })

      const pageEl = wrapRef.current?.querySelector('.pdf-page') as HTMLElement | null
      if (pageEl) {
        pageEl.style.setProperty('--scale-factor', String(scale))
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`

      textLayerDiv.innerHTML = ''
      textLayerDiv.className = 'textLayer'
      setLayerDimensions(textLayerDiv, viewport)

      await pdfPage.render({
        canvasContext: ctx,
        viewport,
        canvas,
      }).promise

      if (cancelled) return

      const textContent = await pdfPage.getTextContent()
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      })
      await textLayer.render()

      // Keep page top visible after flip
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

  const onMouseUp = useCallback(() => {
    const layer = textLayerRef.current
    layer?.classList.remove('selecting')
    window.setTimeout(() => {
      const selected = selectionLookup(layer ?? undefined)
      if (selected) onLookup(selected.term, selected.context)
    }, 0)
  }, [onLookup])

  const onMouseDown = useCallback(() => {
    textLayerRef.current?.classList.add('selecting')
  }, [])

  const onClick = useCallback(
    (e: MouseEvent) => {
      const layer = textLayerRef.current
      if (!layer) return
      const sel = window.getSelection()?.toString()
      if (sel && normalizeTerm(sel)) return

      const hit = lookupAtPoint(layer, e.clientX, e.clientY)
      if (hit) onLookup(hit.term, hit.context)
    },
    [onLookup],
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
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onClick={onClick}
          />
        </div>
      </div>
      <p className="reader-hint">
        Zaznacz tekst · przeciągnij w bok, by zmienić stronę
      </p>
    </div>
  )
}
