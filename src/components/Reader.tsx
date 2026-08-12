import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '../lib/translate'
import {
  loadAutoSpeak,
  saveAutoSpeak,
  speakEnglish,
  stopSpeaking,
} from '../lib/speech'
import { loadFocusMode, saveFocusMode } from '../lib/focusMode'
import type { Theme } from '../lib/theme'
import type { LoadedBook, TranslationState } from '../types'
import { TranslationPanel } from './TranslationPanel'
import { ThemeToggle } from './ThemeToggle'
import { ZoomPane } from './ZoomPane'
import { EpubReader } from '../readers/EpubReader'
import { PdfReader } from '../readers/PdfReader'
import { TxtReader } from '../readers/TxtReader'

type Props = {
  book: LoadedBook
  onClose: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function Reader({ book, onClose, theme, onToggleTheme }: Props) {
  const [translation, setTranslation] = useState<TranslationState>({
    status: 'idle',
  })
  const [navLabel, setNavLabel] = useState('')
  const [autoSpeak, setAutoSpeak] = useState(loadAutoSpeak)
  const [focusMode, setFocusMode] = useState(loadFocusMode)
  const [zoomScale, setZoomScale] = useState(1)
  const requestId = useRef(0)
  const lastLookupRef = useRef({ key: '', at: 0 })
  const autoSpeakRef = useRef(autoSpeak)
  autoSpeakRef.current = autoSpeak

  const swipeEnabled = !focusMode || zoomScale <= 1.02

  const lookup = useCallback(async (term: string, context?: string) => {
    if (!term || term.length > 120) return

    const key = term.toLowerCase()
    const now = Date.now()
    if (
      key === lastLookupRef.current.key &&
      now - lastLookupRef.current.at < 600
    ) {
      return
    }
    lastLookupRef.current = { key, at: now }

    const id = ++requestId.current
    setTranslation((prev) => {
      if (prev.status === 'loading' && prev.term === term) return prev
      return { status: 'loading', term }
    })

    if (autoSpeakRef.current) {
      speakEnglish(term)
    }

    try {
      const result = await translate(term, context)
      if (id !== requestId.current) return
      setTranslation({ status: 'ready', result })
    } catch (err) {
      if (id !== requestId.current) return
      setTranslation({
        status: 'error',
        term,
        message:
          err instanceof Error ? err.message : 'Błąd tłumaczenia.',
      })
    }
  }, [])

  const clearTranslation = useCallback(() => {
    requestId.current += 1
    stopSpeaking()
    setTranslation({ status: 'idle' })
  }, [])

  const toggleAutoSpeak = useCallback(() => {
    setAutoSpeak((prev) => {
      const next = !prev
      saveAutoSpeak(next)
      return next
    })
  }, [])

  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev
      saveFocusMode(next)
      if (next) clearTranslation()
      return next
    })
  }, [clearTranslation])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (focusMode) {
          setFocusMode(false)
          saveFocusMode(false)
          clearTranslation()
        } else {
          clearTranslation()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stopSpeaking()
    }
  }, [clearTranslation, focusMode])

  return (
    <div
      className={`reader-shell${focusMode ? ' reader-shell--focus' : ''}`}
    >
      {!focusMode && (
        <header className="reader-bar">
          <button type="button" className="reader-bar__back" onClick={onClose}>
            ← Biblioteka
          </button>
          <div className="reader-bar__meta">
            <span className="reader-bar__title" title={book.name}>
              {book.name}
            </span>
            {navLabel && <span className="reader-bar__nav">{navLabel}</span>}
          </div>
          <label className="reader-bar__auto-speak">
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={toggleAutoSpeak}
            />
            <span>Czytaj kliknięte</span>
          </label>
          <button
            type="button"
            className="reader-bar__focus"
            onClick={toggleFocusMode}
            title="Tryb czytania — pełny ekran"
          >
            Czytanie
          </button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <span className="reader-bar__format">{book.format.toUpperCase()}</span>
        </header>
      )}


      <ZoomPane enabled={focusMode} onScaleChange={setZoomScale}>
        <div className="reader-main">
          {book.format === 'epub' && (
            <EpubReader
              url={book.url}
              theme={theme}
              focusMode={focusMode}
              swipeEnabled={swipeEnabled}
              onExitFocus={focusMode ? toggleFocusMode : undefined}
              onLookup={lookup}
              onNavLabel={setNavLabel}
            />
          )}
          {book.format === 'pdf' && (
            <PdfReader
              url={book.url}
              focusMode={focusMode}
              swipeEnabled={swipeEnabled}
              onExitFocus={focusMode ? toggleFocusMode : undefined}
              onLookup={lookup}
              onNavLabel={setNavLabel}
            />
          )}
          {book.format === 'txt' && (
            <TxtReader
              file={book.file}
              focusMode={focusMode}
              onExitFocus={focusMode ? toggleFocusMode : undefined}
              onLookup={lookup}
              onNavLabel={setNavLabel}
            />
          )}
        </div>
      </ZoomPane>

      <TranslationPanel state={translation} onClose={clearTranslation} />
    </div>
  )
}
