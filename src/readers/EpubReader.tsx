import { useCallback, useEffect, useRef, useState } from 'react'
import ePub from 'epubjs'
import type { Book, Contents, Rendition } from 'epubjs'
import { lookupInDocument } from '../lib/selection'
import { usePageSwipe } from '../hooks/usePageSwipe'

type Props = {
  url: string
  theme?: 'light' | 'dark'
  focusMode?: boolean
  swipeEnabled?: boolean
  initialCfi?: string
  onLookup: (term: string, context?: string) => void
  onNavLabel: (label: string) => void
  onProgress?: (progress: { page?: number; cfi?: string }) => void
}

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

function emitLookup(
  onLookup: (term: string, context?: string) => void,
  payload: { term: string; context?: string } | null,
) {
  if (!payload?.term) return
  onLookup(payload.term, payload.context)
}

export function EpubReader({
  url,
  theme = 'light',
  focusMode = false,
  swipeEnabled = true,
  initialCfi,
  onLookup,
  onNavLabel,
  onProgress,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const onLookupRef = useRef(onLookup)
  onLookupRef.current = onLookup
  const themeRef = useRef(theme)
  themeRef.current = theme

  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const initialCfiRef = useRef(initialCfi)
  initialCfiRef.current = initialCfi

  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const goPrev = useCallback(() => {
    void renditionRef.current?.prev()
  }, [])

  const goNext = useCallback(() => {
    void renditionRef.current?.next()
  }, [])

  usePageSwipe(swipeRef, {
    onPrev: goPrev,
    onNext: goNext,
    enabled: ready && swipeEnabled,
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

    applyEpubTheme(rendition, themeRef.current, false)

    const handleSelected = (_cfiRange: string, contents: Contents) => {
      emitLookup(onLookupRef.current, lookupInDocument(contents.document))
    }

    const handleClick = (e: MouseEvent, contents: Contents) => {
      emitLookup(
        onLookupRef.current,
        lookupInDocument(contents.document, e.clientX, e.clientY),
      )
    }

    rendition.on('selected', handleSelected)
    rendition.on('click', handleClick)

    rendition.on('relocated', (location: { start?: { cfi?: string; displayed?: { page?: number } } }) => {
      const cfi = location?.start?.cfi
      const pageNum = location?.start?.displayed?.page
      onProgressRef.current?.({
        cfi,
        page: pageNum && pageNum > 0 ? pageNum : undefined,
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
      rendition.destroy()
      void book.destroy()
      renditionRef.current = null
    }
  }, [url, onNavLabel])

  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition || !ready) return
    applyEpubTheme(rendition, theme, focusMode)
  }, [theme, ready, focusMode])

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
          ←
        </button>
        <button
          type="button"
          className="reader-nav__next"
          onClick={goNext}
          disabled={!ready}
          aria-label="Następna strona"
        >
          →
        </button>
      </nav>
      {error && <p className="error-banner">{error}</p>}
      <div ref={hostRef} className="epub-host" />
    </div>
  )
}
