import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import ePub from 'epubjs'
import type { Book, Contents, Rendition } from 'epubjs'
import {
  lookupInDocument,
  highlightLookup,
  clearLookupHighlight,
  sentenceAtPoint,
  getHighlightAnchorRect,
  lookupAtPoint,
  lookupFromOffsets,
} from '../lib/selection'
import { usePageSwipe } from '../hooks/usePageSwipe'
import { useChromeSwipe } from '../hooks/useChromeSwipe'
import type { LookupPayload } from '../lib/selection'
import type { SentenceLookupPayload, LookupAnchor } from './PdfReader'
import {
  SelectionHandles,
  type GripRange,
} from '../components/SelectionHandles'
import type { ReaderNavHandle, ReaderNavSnapshot } from '../types'

type Props = {
  url: string
  theme?: 'light' | 'dark'
  focusMode?: boolean
  swipeEnabled?: boolean
  chromeSwipeEnabled?: boolean
  onChromeShow?: () => void
  onChromeHide?: () => void
  initialCfi?: string
  keepHighlight?: boolean
  onLookup: (term: string, context?: string, anchor?: LookupAnchor) => void
  onSentenceLookup?: (payload: SentenceLookupPayload) => void
  onNavLabel: (label: string) => void
  onProgress?: (progress: {
    page?: number
    cfi?: string
    percent?: number
  }) => void
  onNavState?: (state: ReaderNavSnapshot) => void
}

const EPUB_HIGHLIGHT_CSS = `
mark.lookup-highlight {
  background: rgba(13, 110, 110, 0.4) !important;
  color: inherit !important;
  border-radius: 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
mark.lookup-highlight--sentence {
  background: rgba(13, 110, 110, 0.28) !important;
  box-shadow: inset 0 -2px 0 rgba(13, 110, 110, 0.55);
}
`

function applyEpubTheme(
  rendition: Rendition,
  theme: 'light' | 'dark',
  focusMode = false,
) {
  const dark = theme === 'dark'
  rendition.themes.override('color', dark ? '#e4eaf2' : '#1a2332')
  rendition.themes.override('background', dark ? '#1a222d' : '#ffffff')
  rendition.themes.default({
    body: {
      'font-family': '"Literata", Georgia, serif !important',
      'font-size': focusMode ? '1.35em !important' : '1.15em !important',
      'line-height': '1.7 !important',
      color: dark ? '#e4eaf2 !important' : '#1a2332 !important',
      'background-color': dark ? '#1a222d !important' : '#ffffff !important',
      padding: '0.5em 1.25em !important',
    },
    a: { color: dark ? '#5ec8c8 !important' : '#0d6e6e !important' },
  })
}

function iframeOffset(doc: Document): { top: number; left: number } {
  const win = doc.defaultView
  const frame = win?.frameElement as HTMLElement | null
  if (!frame) return { top: 0, left: 0 }
  const r = frame.getBoundingClientRect()
  return { top: r.top, left: r.left }
}

function emitLookup(
  onLookup: (term: string, context?: string, anchor?: LookupAnchor) => void,
  doc: Document,
  payload: LookupPayload | null,
) {
  if (!payload?.term) return
  highlightLookup(doc, payload)
  const rect = getHighlightAnchorRect(doc)
  const off = iframeOffset(doc)
  const anchor = rect
    ? {
        top: rect.top + off.top,
        left: rect.left + off.left,
        width: rect.width,
        height: rect.height,
      }
    : undefined
  onLookup(payload.term, payload.context, anchor)
}

export const EpubReader = forwardRef<ReaderNavHandle, Props>(function EpubReader(
  {
    url,
    theme = 'light',
    focusMode = false,
    swipeEnabled = true,
    chromeSwipeEnabled = false,
    onChromeShow,
    onChromeHide,
    initialCfi,
    keepHighlight = false,
    onLookup,
    onSentenceLookup,
    onNavLabel,
    onProgress,
    onNavState,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const bookRef = useRef<Book | null>(null)
  const contentsRef = useRef<Contents | null>(null)
  const onLookupRef = useRef(onLookup)
  onLookupRef.current = onLookup
  const onSentenceLookupRef = useRef(onSentenceLookup)
  onSentenceLookupRef.current = onSentenceLookup
  const themeRef = useRef(theme)
  themeRef.current = theme

  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const onNavStateRef = useRef(onNavState)
  onNavStateRef.current = onNavState
  const onChromeShowRef = useRef(onChromeShow)
  onChromeShowRef.current = onChromeShow
  const onChromeHideRef = useRef(onChromeHide)
  onChromeHideRef.current = onChromeHide
  const initialCfiRef = useRef(initialCfi)
  initialCfiRef.current = initialCfi

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [gripRange, setGripRange] = useState<GripRange | null>(null)
  const [frameOffset, setFrameOffset] = useState({ top: 0, left: 0 })
  const [pageSlide, setPageSlide] = useState<'idle' | 'forward' | 'back'>(
    'idle',
  )
  const gripRootRef = useRef<HTMLElement | null>(null)
  const slidingRef = useRef(false)

  const openGripsRef = useRef<(range: GripRange, body: HTMLElement) => void>(
    () => {},
  )
  openGripsRef.current = (range, body) => {
    gripRootRef.current = body
    setFrameOffset(iframeOffset(body.ownerDocument))
    body.ownerDocument.getSelection()?.removeAllRanges()
    setGripRange(range)
  }

  const clearGrips = useCallback(() => {
    setGripRange(null)
  }, [])
  const clearGripsRef = useRef(clearGrips)
  clearGripsRef.current = clearGrips
  const gripActiveRef = useRef(false)
  gripActiveRef.current = gripRange != null

  const goPrev = useCallback(() => {
    clearGrips()
    const rendition = renditionRef.current
    if (!rendition || slidingRef.current) return
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (reduceMotion) {
      void rendition.prev()
      return
    }
    slidingRef.current = true
    setPageSlide('back')
    window.setTimeout(() => {
      void rendition.prev().finally(() => {
        window.setTimeout(() => {
          setPageSlide('idle')
          slidingRef.current = false
        }, 220)
      })
    }, 160)
  }, [clearGrips])

  const goNext = useCallback(() => {
    clearGrips()
    const rendition = renditionRef.current
    if (!rendition || slidingRef.current) return
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (reduceMotion) {
      void rendition.next()
      return
    }
    slidingRef.current = true
    setPageSlide('forward')
    window.setTimeout(() => {
      void rendition.next().finally(() => {
        window.setTimeout(() => {
          setPageSlide('idle')
          slidingRef.current = false
        }, 220)
      })
    }, 160)
  }, [clearGrips])

  const seekPercent = useCallback((percent: number) => {
    const book = bookRef.current
    const rendition = renditionRef.current
    if (!book || !rendition) return
    const clamped = Math.min(100, Math.max(0, percent)) / 100
    try {
      const cfi = book.locations.cfiFromPercentage(clamped)
      if (cfi) void rendition.display(cfi)
    } catch {
      /* locations not ready yet */
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({ goPrev, goNext, seekPercent }),
    [goPrev, goNext, seekPercent],
  )

  usePageSwipe(swipeRef, {
    onPrev: goPrev,
    onNext: goNext,
    enabled: ready && swipeEnabled,
  })

  useChromeSwipe(swipeRef, {
    onShow: onChromeShow ?? (() => {}),
    onHide: onChromeHide ?? (() => {}),
    enabled: ready && chromeSwipeEnabled && Boolean(onChromeShow && onChromeHide),
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    setError(null)
    setReady(false)

    const book: Book = ePub(url)
    const rendition = book.renderTo(host, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      allowScriptedContent: true,
    })
    renditionRef.current = rendition
    bookRef.current = book

    applyEpubTheme(rendition, themeRef.current, false)

    const cleanups: Array<() => void> = []

    rendition.hooks.content.register((contents: Contents) => {
      contentsRef.current = contents
      const doc = contents.document
      if (!doc.head.querySelector('style[data-lookup-hl]')) {
        const style = doc.createElement('style')
        style.setAttribute('data-lookup-hl', '1')
        style.textContent = EPUB_HIGHLIGHT_CSS
        doc.head.appendChild(style)
      }

      let timer: ReturnType<typeof setTimeout> | null = null
      let tapTimer: ReturnType<typeof setTimeout> | null = null
      let start = { x: 0, y: 0 }
      let longFired = false
      let cancelledPress = false
      let lastTap: { t: number; x: number; y: number } | null = null
      const LONG_MS = 480
      const DOUBLE_MS = 320
      const MOVE = 14

      const clearTimer = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
      }

      const clearTapTimer = () => {
        if (tapTimer) {
          clearTimeout(tapTimer)
          tapTimer = null
        }
      }

      const runWord = (x: number, y: number) => {
        if (gripActiveRef.current) {
          clearGripsRef.current()
          return
        }
        emitLookup(
          onLookupRef.current,
          doc,
          lookupInDocument(doc, x, y),
        )
      }

      const runSentence = (x: number, y: number) => {
        const body = doc.body
        const cb = onSentenceLookupRef.current
        if (!body || !cb) return
        clearGripsRef.current()
        const hit = sentenceAtPoint(body, x, y)
        if (!hit?.highlight) return
        highlightLookup(
          doc,
          hit,
          'lookup-highlight lookup-highlight--sentence',
        )
        const rect = getHighlightAnchorRect(doc)
        if (!rect) return
        const off = iframeOffset(doc)
        cb({
          sentence: hit.term,
          anchor: {
            top: rect.top + off.top,
            left: rect.left + off.left,
            width: rect.width,
            height: rect.height,
          },
        })
      }

      const fireTapOrDouble = (x: number, y: number) => {
        const now = Date.now()
        if (
          lastTap &&
          now - lastTap.t <= DOUBLE_MS &&
          Math.hypot(x - lastTap.x, y - lastTap.y) < 28
        ) {
          clearTapTimer()
          lastTap = null
          runSentence(x, y)
          return
        }
        lastTap = { t: now, x, y }
        clearTapTimer()
        tapTimer = setTimeout(() => {
          tapTimer = null
          lastTap = null
          if (longFired) return
          runWord(x, y)
        }, DOUBLE_MS)
      }

      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return
        longFired = false
        cancelledPress = false
        start = { x: e.clientX, y: e.clientY }
        clearTimer()
        timer = setTimeout(() => {
          longFired = true
          clearTapTimer()
          lastTap = null
          const body = doc.body
          if (!body) return
          const hit = lookupAtPoint(body, start.x, start.y)
          if (!hit?.highlight) return
          openGripsRef.current(
            { start: hit.highlight.start, end: hit.highlight.end },
            body,
          )
        }, LONG_MS)
      }

      const onMove = (e: PointerEvent) => {
        if (longFired) return
        if (!timer) return
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE) {
          clearTimer()
          cancelledPress = true
        }
      }

      const onUp = (e: PointerEvent) => {
        clearTimer()
        if (longFired) {
          e.preventDefault()
          e.stopPropagation()
          longFired = false
          return
        }
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (Math.abs(dy) >= 48 && Math.abs(dy) > Math.abs(dx) * 1.25) {
          if (dy < 0) onChromeShowRef.current?.()
          else onChromeHideRef.current?.()
          cancelledPress = true
          return
        }
        if (cancelledPress) return
        if (Math.abs(dx) > MOVE || Math.abs(dy) > MOVE) {
          return
        }
        fireTapOrDouble(e.clientX, e.clientY)
      }

      const onCancel = () => {
        clearTimer()
        clearTapTimer()
        cancelledPress = true
        longFired = false
      }

      const onDblClick = (e: MouseEvent) => {
        clearTapTimer()
        lastTap = null
        runSentence(e.clientX, e.clientY)
      }

      const onContextMenu = (e: Event) => {
        e.preventDefault()
      }

      doc.addEventListener('pointerdown', onDown)
      doc.addEventListener('pointermove', onMove)
      doc.addEventListener('pointerup', onUp)
      doc.addEventListener('pointercancel', onCancel)
      doc.addEventListener('dblclick', onDblClick)
      doc.addEventListener('contextmenu', onContextMenu)

      cleanups.push(() => {
        clearTimer()
        clearTapTimer()
        doc.removeEventListener('pointerdown', onDown)
        doc.removeEventListener('pointermove', onMove)
        doc.removeEventListener('pointerup', onUp)
        doc.removeEventListener('pointercancel', onCancel)
        doc.removeEventListener('dblclick', onDblClick)
        doc.removeEventListener('contextmenu', onContextMenu)
      })
    })

    const handleSelected = (_cfiRange: string, contents: Contents) => {
      contentsRef.current = contents
      emitLookup(
        onLookupRef.current,
        contents.document,
        lookupInDocument(contents.document),
      )
    }

    rendition.on('selected', handleSelected)

    rendition.on('relocated', (location: {
      atStart?: boolean
      atEnd?: boolean
      start?: {
        cfi?: string
        displayed?: { page?: number; total?: number }
        percentage?: number
      }
      percentage?: number
    }) => {
      const cfi = location?.start?.cfi
      const pageNum = location?.start?.displayed?.page
      const totalPages = location?.start?.displayed?.total
      let percent: number | undefined
      if (cfi && book.locations?.length?.()) {
        try {
          const p = book.locations.percentageFromCfi(cfi)
          if (typeof p === 'number' && Number.isFinite(p)) {
            percent = Math.min(100, Math.max(0, Math.round(p * 100)))
          }
        } catch {
          /* ignore */
        }
      }
      if (percent == null) {
        const rawPct =
          location?.start?.percentage ?? location?.percentage ?? undefined
        if (typeof rawPct === 'number' && Number.isFinite(rawPct)) {
          percent = Math.min(100, Math.max(0, Math.round(rawPct * 100)))
        }
      }
      const page = pageNum && pageNum > 0 ? pageNum : 1
      const pct = percent ?? 0
      onProgressRef.current?.({
        cfi,
        page,
        percent: pct,
      })
      onNavStateRef.current?.({
        page,
        totalPages: totalPages && totalPages > 0 ? totalPages : null,
        percent: pct,
        canPrev: !location.atStart,
        canNext: !location.atEnd,
      })
    })

    book.ready
      .then(() => {
        if (cancelled) return
        const cfi = initialCfiRef.current
        if (cfi) return rendition.display(cfi)
        return rendition.display()
      })
      .then(() => {
        if (cancelled) return
        setReady(true)
        const meta = book.packaging?.metadata as
          | { title?: string }
          | undefined
        onNavLabel(meta?.title || 'EPUB')
        // Background location index for slider seek + accurate %
        void book.locations
          .generate(1600)
          .then(() => {
            if (cancelled) return
            const loc = rendition.currentLocation() as
              | { start?: { cfi?: string } }
              | undefined
            const cfi = loc?.start?.cfi
            if (!cfi) return
            try {
              const p = book.locations.percentageFromCfi(cfi)
              if (typeof p === 'number' && Number.isFinite(p)) {
                const pct = Math.min(100, Math.max(0, Math.round(p * 100)))
                onProgressRef.current?.({ cfi, percent: pct })
                onNavStateRef.current?.({
                  page: 1,
                  totalPages: null,
                  percent: pct,
                  canPrev: true,
                  canNext: true,
                })
              }
            } catch {
              /* ignore */
            }
          })
          .catch(() => {
            /* optional */
          })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : 'Nie udało się wczytać pliku EPUB.',
        )
      })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') void rendition.next()
      if (e.key === 'ArrowLeft') void rendition.prev()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKey)
      cleanups.forEach((fn) => fn())
      rendition.destroy()
      void book.destroy()
      renditionRef.current = null
      bookRef.current = null
      contentsRef.current = null
    }
  }, [url, onNavLabel])

  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition || !ready) return
    applyEpubTheme(rendition, theme, focusMode)
  }, [theme, ready, focusMode])

  useEffect(() => {
    if (!keepHighlight) {
      clearLookupHighlight(contentsRef.current?.document ?? null)
    }
  }, [keepHighlight])

  return (
    <div
      className={`epub-reader${focusMode ? ' epub-reader--focus' : ''}`}
      ref={swipeRef}
    >
      <nav className="reader-nav reader-nav--epub" aria-label="Nawigacja stron">
        <button
          type="button"
          className="reader-nav__prev"
          onClick={goPrev}
          disabled={!ready}
          aria-label="Poprzednia strona"
        >
          «
        </button>
        <button
          type="button"
          className="reader-nav__next"
          onClick={goNext}
          disabled={!ready}
          aria-label="Następna strona"
        >
          »
        </button>
      </nav>
      {error && <p className="error-banner">{error}</p>}
      <div
        ref={hostRef}
        className={`epub-host${pageSlide !== 'idle' ? ` epub-host--slide-${pageSlide}` : ''}`}
      />
      <SelectionHandles
        root={gripRootRef.current}
        range={gripRange}
        frameOffset={frameOffset}
        onRangeChange={setGripRange}
        onTranslate={() => {
          const body = gripRootRef.current
          if (!body || !gripRange) return
          const payload = lookupFromOffsets(
            body,
            gripRange.start,
            gripRange.end,
          )
          if (!payload) {
            clearGrips()
            return
          }
          highlightLookup(
            body.ownerDocument,
            payload,
            'lookup-highlight lookup-highlight--sentence',
          )
          const rect = getHighlightAnchorRect(body.ownerDocument)
          const off = iframeOffset(body.ownerDocument)
          setGripRange(null)
          if (onSentenceLookup && rect) {
            onSentenceLookup({
              sentence: payload.term,
              anchor: {
                top: rect.top + off.top,
                left: rect.left + off.left,
                width: rect.width,
                height: rect.height,
              },
            })
            return
          }
          emitLookup(onLookup, body.ownerDocument, payload)
        }}
        onDismiss={clearGrips}
      />
    </div>
  )
})
