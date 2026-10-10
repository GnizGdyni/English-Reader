import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
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
import type { ReaderNavHandle, ReaderNavSnapshot } from '../types'
import './pdf-text-layer.css'

function isRenderCancelled(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'RenderingCancelledException' || err.name === 'AbortException')
  )
}

export type LookupAnchor = {
  top: number
  left: number
  width: number
  height: number
}

export type SentenceLookupPayload = {
  sentence: string
  anchor: LookupAnchor
}

type Props = {
  url: string
  focusMode?: boolean
  swipeEnabled?: boolean
  initialPage?: number
  keepHighlight?: boolean
  onLookup: (term: string, context?: string, anchor?: LookupAnchor) => void
  onSentenceLookup?: (payload: SentenceLookupPayload) => void
  onNavLabel: (label: string) => void
  onPageChange?: (page: number, totalPages: number) => void
  onNavState?: (state: ReaderNavSnapshot) => void
  /** Fired when the user changes page (arrows, swipe, seek). */
  onNavigate?: () => void
}

function anchorFromLayer(layer: HTMLElement): LookupAnchor | undefined {
  const rect = getHighlightAnchorRect(layer)
  if (!rect) return undefined
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

export const PdfReader = forwardRef<ReaderNavHandle, Props>(function PdfReader(
  {
    url,
    focusMode = false,
    swipeEnabled = true,
    initialPage = 1,
    keepHighlight = false,
    onLookup,
    onSentenceLookup,
    onNavLabel,
    onPageChange,
    onNavState,
    onNavigate,
  },
  ref,
) {
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate
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
  const [pageTurn, setPageTurn] = useState<{
    src: string
    dir: 'forward' | 'back'
    width: number
    height: number
  } | null>(null)

  const initialPageRef = useRef(initialPage)
  initialPageRef.current = initialPage
  const pageRef = useRef(page)
  pageRef.current = page
  const turningRef = useRef(false)

  const finishPageTurn = useCallback(() => {
    setPageTurn(null)
    turningRef.current = false
  }, [])

  const turnToPage = useCallback(
    (nextPage: number, dir: 'forward' | 'back') => {
      if (turningRef.current) return
      const current = pageRef.current
      if (nextPage === current) return
      if (nextPage < 1) return
      if (pageCount > 0 && nextPage > pageCount) return

      onNavigateRef.current?.()

      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
      const canvas = canvasRef.current
      const pageEl = wrapRef.current?.querySelector(
        '.pdf-page',
      ) as HTMLElement | null

      if (!reduceMotion && canvas && canvas.width > 0) {
        try {
          const src = canvas.toDataURL('image/jpeg', 0.82)
          const width = pageEl?.offsetWidth || canvas.clientWidth || canvas.width
          const height =
            pageEl?.offsetHeight || canvas.clientHeight || canvas.height
          turningRef.current = true
          setPageTurn({ src, dir, width, height })
        } catch {
          /* ignore capture failures */
        }
      }

      setPage(nextPage)
    },
    [pageCount],
  )

  const goPrev = useCallback(() => {
    turnToPage(pageRef.current - 1, 'back')
  }, [turnToPage])

  const goNext = useCallback(() => {
    turnToPage(pageRef.current + 1, 'forward')
  }, [turnToPage])

  const seekPercent = useCallback(
    (percent: number) => {
      if (pageCount <= 0) return
      const clamped = Math.min(100, Math.max(0, percent))
      const next = Math.min(
        pageCount,
        Math.max(1, Math.round((clamped / 100) * pageCount) || 1),
      )
      // Jump without flip animation (scrubbing)
      if (next !== pageRef.current) onNavigateRef.current?.()
      turningRef.current = false
      setPageTurn(null)
      setPage(next)
    },
    [pageCount],
  )

  useImperativeHandle(
    ref,
    () => ({ goPrev, goNext, seekPercent }),
    [goPrev, goNext, seekPercent],
  )
  const cancelPageRender = useCallback(() => {
    activeTextLayerRef.current?.cancel()
    activeTextLayerRef.current = null
    activeRenderRef.current?.cancel()
    activeRenderRef.current = null
  }, [])

  usePageSwipe(wrapRef, {
    onPrev: goPrev,
    onNext: goNext,
    enabled: pageCount > 0 && swipeEnabled && !pageTurn,
  })

  useEffect(() => {
    if (!pageTurn) return
    const t = window.setTimeout(finishPageTurn, 700)
    return () => window.clearTimeout(t)
  }, [pageTurn, finishPageTurn])

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
    if (pageCount > 0) onPageChange?.(page, pageCount)
    const percent =
      pageCount > 0
        ? Math.min(100, Math.round((page / pageCount) * 100))
        : 0
    onNavState?.({
      page,
      totalPages: pageCount > 0 ? pageCount : null,
      percent,
      canPrev: page > 1,
      canNext: pageCount > 0 && page < pageCount,
    })
  }, [page, pageCount, onNavLabel, onPageChange, onNavState])

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
      const isMobile = window.matchMedia('(max-width: 899px)').matches
      const padX = isMobile ? 0 : focusMode ? 4 : 12
      const padY = isMobile ? 0 : focusMode ? 4 : 10

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
        const multi = /\s/.test(selected.term)
        highlightLookup(
          layer,
          selected,
          multi
            ? 'lookup-highlight lookup-highlight--sentence'
            : 'lookup-highlight',
        )
        const anchor = anchorFromLayer(layer)
        if (multi && onSentenceLookup && anchor) {
          onSentenceLookup({ sentence: selected.term, anchor })
          return
        }
        onLookup(selected.term, selected.context, anchor)
        return
      }

      const hit = lookupAtPoint(layer, clientX, clientY)
      if (hit) {
        highlightLookup(layer, hit)
        onLookup(hit.term, hit.context, anchorFromLayer(layer))
      }
    },
    [onLookup, onSentenceLookup, gripRange, clearGrips],
  )

  const translateGrips = useCallback(() => {
    const layer = textLayerRef.current
    if (!layer || !gripRange) return
    const payload = lookupFromOffsets(layer, gripRange.start, gripRange.end)
    if (!payload) {
      clearGrips()
      return
    }
    highlightLookup(
      layer,
      payload,
      'lookup-highlight lookup-highlight--sentence',
    )
    const anchor = anchorFromLayer(layer)
    setGripRange(null)
    if (onSentenceLookup && anchor) {
      onSentenceLookup({ sentence: payload.term, anchor })
      return
    }
    onLookup(payload.term, payload.context, anchor)
  }, [onLookup, onSentenceLookup, gripRange, clearGrips])

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
          <div
            className={`pdf-flip${pageTurn ? ` pdf-flip--${pageTurn.dir}` : ''}`}
          >
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
            {pageTurn && (
              <div
                className="pdf-flip__sheet"
                style={{
                  width: pageTurn.width,
                  height: pageTurn.height,
                }}
                onAnimationEnd={finishPageTurn}
                aria-hidden
              >
                <div
                  className="pdf-flip__face"
                  style={{ backgroundImage: `url(${pageTurn.src})` }}
                />
              </div>
            )}
          </div>
        </div>

        <nav className="reader-nav reader-nav--pdf" aria-label="Nawigacja stron">
          <button
            type="button"
            className="reader-nav__prev"
            disabled={page <= 1 || Boolean(pageTurn)}
            onClick={goPrev}
            aria-label="Poprzednia strona"
          >
            «
          </button>
          <button
            type="button"
            className="reader-nav__next"
            disabled={!pageCount || page >= pageCount || Boolean(pageTurn)}
            onClick={goNext}
            aria-label="Następna strona"
          >
            »
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
})
