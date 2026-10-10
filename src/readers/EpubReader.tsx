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
  selectionLookup,
  highlightLookup,
  clearLookupHighlight,
  sentenceAtPoint,
  getHighlightAnchorRect,
  lookupAtPoint,
  lookupFromOffsets,
  invalidateTextIndex,
} from '../lib/selection'
import { usePageSwipe } from '../hooks/usePageSwipe'
import { useChromeSwipe } from '../hooks/useChromeSwipe'
import { createSwipeGesture } from '../lib/swipeGesture'
import type { SentenceLookupPayload, LookupAnchor } from './PdfReader'
import {
  SelectionHandles,
  type GripRange,
} from '../components/SelectionHandles'
import type { ReaderNavHandle, ReaderNavSnapshot } from '../types'
import { viewportRectFromDoc } from '../lib/popupAnchor'
import {
  EPUB_TYPOGRAPHY_DEFAULTS,
  type EpubTypography,
} from '../lib/epubTypography'
import {
  ensureEpubLocations,
  epubProgressFromCfi,
} from '../lib/epubLocations'

type Props = {
  url: string
  theme?: 'light' | 'dark'
  focusMode?: boolean
  typography?: EpubTypography
  swipeEnabled?: boolean
  chromeSwipeEnabled?: boolean
  /** When true, vertical swipe hides chrome; when false, shows it. */
  chromeVisible?: boolean
  onChromeShow?: () => void
  onChromeHide?: () => void
  initialCfi?: string
  keepHighlight?: boolean
  onLookup: (term: string, context?: string, anchor?: LookupAnchor) => void
  onSentenceLookup?: (payload: SentenceLookupPayload) => void
  onNavLabel: (label: string) => void
  onProgress?: (progress: {
    page?: number
    totalPages?: number
    cfi?: string
    percent?: number
  }) => void
  onNavState?: (state: ReaderNavSnapshot) => void
  /** Fired when the user changes page (arrows, swipe, seek). */
  onNavigate?: () => void
}

const EPUB_HIGHLIGHT_CSS = `
html, body {
  touch-action: manipulation !important;
  -webkit-user-select: text;
  user-select: text;
}
mark.lookup-highlight {
  background: rgba(13, 110, 110, 0.45) !important;
  color: inherit !important;
  border-radius: 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  padding: 0.05em 0;
}
mark.lookup-highlight--sentence {
  background: rgba(13, 110, 110, 0.32) !important;
  box-shadow: inset 0 -2px 0 rgba(13, 110, 110, 0.6);
}
`

function applyEpubTheme(
  rendition: Rendition,
  theme: 'light' | 'dark',
  typography: EpubTypography = EPUB_TYPOGRAPHY_DEFAULTS,
) {
  const dark = theme === 'dark'
  const baseEm = 1.15
  const fontEm = Math.round(baseEm * typography.fontScale * 100) / 100
  const padY = typography.marginY
  const padX = typography.marginX
  rendition.themes.override('color', dark ? '#e4eaf2' : '#1a2332')
  rendition.themes.override('background', dark ? '#1a222d' : '#ffffff')
  rendition.themes.default({
    body: {
      'font-family': '"Literata", Georgia, serif !important',
      'font-size': `${fontEm}em !important`,
      'line-height': '1.7 !important',
      color: dark ? '#e4eaf2 !important' : '#1a2332 !important',
      'background-color': dark ? '#1a222d !important' : '#ffffff !important',
      padding: `${padY}em ${padX}em !important`,
    },
    a: { color: dark ? '#5ec8c8 !important' : '#0d6e6e !important' },
  })
}

function selectionRect(doc: Document): DOMRect | null {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const r = sel.getRangeAt(0).getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return r
}

function anchorFromBody(body: HTMLElement): LookupAnchor | undefined {
  const doc = body.ownerDocument
  const rect = getHighlightAnchorRect(body) ?? selectionRect(doc)
  return rect ? viewportRectFromDoc(doc, rect) : undefined
}

/** Same lookup UX as PdfReader.runWordLookup, scoped to EPUB iframe body. */
function runEpubWordLookup(
  body: HTMLElement,
  clientX: number,
  clientY: number,
  opts: {
    onLookup: (term: string, context?: string, anchor?: LookupAnchor) => void
    onSentenceLookup?: (payload: SentenceLookupPayload) => void
    gripsActive: boolean
    clearGrips: () => void
  },
) {
  if (opts.gripsActive) {
    opts.clearGrips()
    return
  }

  const selected = selectionLookup(body)
  if (selected) {
    const multi = /\s/.test(selected.term)
    highlightLookup(
      body,
      selected,
      multi
        ? 'lookup-highlight lookup-highlight--sentence'
        : 'lookup-highlight',
    )
    const anchor = anchorFromBody(body)
    if (multi && opts.onSentenceLookup && anchor) {
      opts.onSentenceLookup({ sentence: selected.term, anchor })
      return
    }
    opts.onLookup(selected.term, selected.context, anchor)
    return
  }

  const hit = lookupAtPoint(body, clientX, clientY)
  if (!hit) return
  highlightLookup(body, hit)
  opts.onLookup(hit.term, hit.context, anchorFromBody(body))
}

export const EpubReader = forwardRef<ReaderNavHandle, Props>(function EpubReader(
  {
    url,
    theme = 'light',
    focusMode = false,
    typography = EPUB_TYPOGRAPHY_DEFAULTS,
    swipeEnabled = true,
    chromeSwipeEnabled = false,
    chromeVisible = true,
    onChromeShow,
    onChromeHide,
    initialCfi,
    keepHighlight = false,
    onLookup,
    onSentenceLookup,
    onNavLabel,
    onProgress,
    onNavState,
    onNavigate,
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
  const typographyRef = useRef(typography)
  typographyRef.current = typography

  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const onNavStateRef = useRef(onNavState)
  onNavStateRef.current = onNavState
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate
  const onChromeShowRef = useRef(onChromeShow)
  onChromeShowRef.current = onChromeShow
  const onChromeHideRef = useRef(onChromeHide)
  onChromeHideRef.current = onChromeHide
  const goPrevRef = useRef<() => void>(() => {})
  const goNextRef = useRef<() => void>(() => {})
  const swipeEnabledRef = useRef(swipeEnabled)
  swipeEnabledRef.current = swipeEnabled
  const chromeSwipeEnabledRef = useRef(chromeSwipeEnabled)
  chromeSwipeEnabledRef.current = chromeSwipeEnabled
  const chromeVisibleRef = useRef(chromeVisible)
  chromeVisibleRef.current = chromeVisible
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
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openGripsRef = useRef<(range: GripRange, body: HTMLElement) => void>(
    () => {},
  )
  openGripsRef.current = (range, body) => {
    gripRootRef.current = body
    const mapped = viewportRectFromDoc(body.ownerDocument, {
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    })
    setFrameOffset({ top: mapped.top, left: mapped.left })
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

  const playPageSlide = useCallback((dir: 'forward' | 'back') => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (slideTimerRef.current) clearTimeout(slideTimerRef.current)
    setPageSlide(dir)
    slideTimerRef.current = window.setTimeout(() => {
      setPageSlide('idle')
      slideTimerRef.current = null
    }, 380)
  }, [])

  const goPrev = useCallback(() => {
    clearGrips()
    const rendition = renditionRef.current
    if (!rendition) return
    onNavigateRef.current?.()
    playPageSlide('back')
    void Promise.resolve(rendition.prev()).catch(() => {})
  }, [clearGrips, playPageSlide])

  const goNext = useCallback(() => {
    clearGrips()
    const rendition = renditionRef.current
    if (!rendition) return
    onNavigateRef.current?.()
    playPageSlide('forward')
    void Promise.resolve(rendition.next()).catch(() => {})
  }, [clearGrips, playPageSlide])

  goPrevRef.current = goPrev
  goNextRef.current = goNext

  const seekPercent = useCallback((percent: number) => {
    const book = bookRef.current
    const rendition = renditionRef.current
    if (!book || !rendition) return
    if (!book.locations.length()) return
    const clamped = Math.min(100, Math.max(0, percent)) / 100
    try {
      const cfi = book.locations.cfiFromPercentage(clamped)
      if (cfi) {
        onNavigateRef.current?.()
        void rendition.display(cfi)
      }
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
    visible: chromeVisible,
    enabled:
      ready &&
      chromeSwipeEnabled &&
      Boolean(onChromeShow && onChromeHide),
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    setError(null)
    setReady(false)
    host.replaceChildren()

    const book: Book = ePub(url, { openAs: 'epub' })
    const rendition = book.renderTo(host, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'none',
      manager: 'default',
      allowScriptedContent: true,
    })
    renditionRef.current = rendition
    bookRef.current = book

    applyEpubTheme(rendition, themeRef.current, typographyRef.current)

    const syncSize = () => {
      if (cancelled || !host.isConnected) return
      const w = Math.floor(host.clientWidth)
      const h = Math.floor(host.clientHeight)
      if (w < 32 || h < 32) return
      try {
        rendition.resize(w, h)
      } catch {
        /* ignore mid-destroy */
      }
    }

    const ro = new ResizeObserver(() => {
      window.requestAnimationFrame(syncSize)
    })
    ro.observe(host)

    const cleanups: Array<() => void> = []

    rendition.hooks.content.register((contents: Contents) => {
      contentsRef.current = contents
      const doc = contents.document
      const body = doc.body
      if (body) invalidateTextIndex(body)
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
      let swipeDone = false
      let lastTap: { t: number; x: number; y: number } | null = null
      const LONG_MS = 450
      const DOUBLE_MS = 320
      const MOVE = 28

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

      const swipeTarget = doc.body ?? doc.documentElement
      const pageChromeSwipe = createSwipeGesture({
        axis: 'both',
        distance: 64,
        velocity: 0.45,
        axisRatio: 1.6,
        onSwipe: (dir) => {
          if (longFired) return
          swipeDone = true
          clearTimer()
          clearTapTimer()
          lastTap = null
          cancelledPress = true
          if (dir === 'left' || dir === 'right') {
            if (!swipeEnabledRef.current) return
            if (dir === 'left') goNextRef.current()
            else goPrevRef.current()
            return
          }
          if (!chromeSwipeEnabledRef.current) return
          if (chromeVisibleRef.current) onChromeHideRef.current?.()
          else onChromeShowRef.current?.()
        },
      })
      const detachSwipe = pageChromeSwipe.attach(swipeTarget)

      const runWord = (x: number, y: number) => {
        const el = doc.body
        if (!el) return
        runEpubWordLookup(el, x, y, {
          onLookup: onLookupRef.current,
          onSentenceLookup: onSentenceLookupRef.current,
          gripsActive: gripActiveRef.current,
          clearGrips: clearGripsRef.current,
        })
      }

      const runSentence = (x: number, y: number) => {
        const el = doc.body
        const cb = onSentenceLookupRef.current
        if (!el || !cb) return
        clearGripsRef.current()
        const hit = sentenceAtPoint(el, x, y)
        if (!hit?.highlight) return
        highlightLookup(
          el,
          hit,
          'lookup-highlight lookup-highlight--sentence',
        )
        const anchor = anchorFromBody(el)
        if (!anchor) return
        cb({
          sentence: hit.term,
          anchor,
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
        // Swipe is touch/pen-only; mouse still gets tap / long-press
        longFired = false
        cancelledPress = false
        swipeDone = false
        start = { x: e.clientX, y: e.clientY }
        clearTimer()
        timer = setTimeout(() => {
          if (swipeDone || pageChromeSwipe.movedPastSlop()) return
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
        if (longFired || swipeDone) return
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (Math.hypot(dx, dy) > MOVE || pageChromeSwipe.movedPastSlop()) {
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
        if (swipeDone || cancelledPress) return
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
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
        swipeDone = true
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
        detachSwipe()
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
      const el = contents.document.body
      if (!el) return
      // Drag-select in EPUB → same path as PDF selectionLookup
      runEpubWordLookup(el, 0, 0, {
        onLookup: onLookupRef.current,
        onSentenceLookup: onSentenceLookupRef.current,
        gripsActive: false,
        clearGrips: clearGripsRef.current,
      })
    }

    rendition.on('selected', handleSelected)

    const publishProgress = (location: {
      atStart?: boolean
      atEnd?: boolean
      start?: { cfi?: string }
    }) => {
      const cfi = location?.start?.cfi
      const progress = epubProgressFromCfi(book, cfi)
      const page = progress?.page ?? 1
      const totalPages = progress?.totalPages ?? null
      const pct = progress?.percent ?? 0
      onProgressRef.current?.({
        cfi,
        page,
        totalPages: totalPages ?? undefined,
        percent: pct,
      })
      onNavStateRef.current?.({
        page,
        totalPages,
        percent: pct,
        canPrev: !location.atStart,
        canNext: !location.atEnd,
      })
    }

    rendition.on('relocated', (location: {
      atStart?: boolean
      atEnd?: boolean
      start?: { cfi?: string }
    }) => {
      clearGripsRef.current()
      const liveBody = contentsRef.current?.document?.body
      if (liveBody) {
        invalidateTextIndex(liveBody)
        clearLookupHighlight(liveBody)
      }
      publishProgress(location)
    })

    book.ready
      .then(() => {
        if (cancelled) return
        syncSize()
        const cfi = initialCfiRef.current
        if (cfi) return rendition.display(cfi)
        return rendition.display()
      })
      .then(async () => {
        if (cancelled) return
        syncSize()
        setReady(true)
        const meta = book.packaging?.metadata as
          | { title?: string }
          | undefined
        onNavLabel(meta?.title || 'EPUB')
        try {
          await ensureEpubLocations(book)
        } catch {
          return
        }
        if (cancelled) return
        const loc = rendition.currentLocation() as
          | { atStart?: boolean; atEnd?: boolean; start?: { cfi?: string } }
          | undefined
        if (loc) publishProgress(loc)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('EPUB load failed:', err)
        setError(
          err instanceof Error
            ? err.message
            : 'Nie udało się wczytać pliku EPUB.',
        )
      })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        onNavigateRef.current?.()
        void rendition.next()
      }
      if (e.key === 'ArrowLeft') {
        onNavigateRef.current?.()
        void rendition.prev()
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKey)
      if (slideTimerRef.current) {
        clearTimeout(slideTimerRef.current)
        slideTimerRef.current = null
      }
      ro.disconnect()
      cleanups.forEach((fn) => fn())
      try {
        rendition.destroy()
      } catch {
        /* ignore */
      }
      void book.destroy()
      host.replaceChildren()
      renditionRef.current = null
      bookRef.current = null
      contentsRef.current = null
    }
  }, [url, onNavLabel])

  useEffect(() => {
    const rendition = renditionRef.current
    const host = hostRef.current
    if (!rendition || !ready) return
    applyEpubTheme(rendition, theme, typography)
    // Re-paginate after font/margin change
    const w = host ? Math.floor(host.clientWidth) : 0
    const h = host ? Math.floor(host.clientHeight) : 0
    if (w >= 32 && h >= 32) {
      try {
        rendition.resize(w, h)
      } catch {
        /* ignore */
      }
    }
  }, [theme, ready, typography])

  useEffect(() => {
    if (!keepHighlight) {
      clearLookupHighlight(contentsRef.current?.document?.body ?? null)
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
            body,
            payload,
            'lookup-highlight lookup-highlight--sentence',
          )
          const anchor = anchorFromBody(body)
          setGripRange(null)
          if (onSentenceLookup && anchor) {
            onSentenceLookup({
              sentence: payload.term,
              anchor,
            })
            return
          }
          onLookup(payload.term, payload.context, anchor)
        }}
        onDismiss={clearGrips}
      />
    </div>
  )
})
