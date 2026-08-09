import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '../lib/translate'
import {
  loadAutoSpeak,
  saveAutoSpeak,
  speakEnglish,
  stopSpeaking,
} from '../lib/speech'
import type { Theme } from '../lib/theme'
import type { LoadedBook, TranslationState } from '../types'
import { TranslationPanel } from './TranslationPanel'
import { ThemeToggle } from './ThemeToggle'
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
  const requestId = useRef(0)
  const autoSpeakRef = useRef(autoSpeak)
  autoSpeakRef.current = autoSpeak

  const lookup = useCallback(async (term: string, context?: string) => {
    if (!term || term.length > 120) return
    const id = ++requestId.current
    setTranslation({ status: 'loading', term })

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearTranslation()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stopSpeaking()
    }
  }, [clearTranslation])

  return (
    <div className="reader-shell">
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
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <span className="reader-bar__format">{book.format.toUpperCase()}</span>
      </header>

      <div className="reader-main">
        {book.format === 'epub' && (
          <EpubReader
            url={book.url}
            theme={theme}
            onLookup={lookup}
            onNavLabel={setNavLabel}
          />
        )}
        {book.format === 'pdf' && (
          <PdfReader
            url={book.url}
            onLookup={lookup}
            onNavLabel={setNavLabel}
          />
        )}
        {book.format === 'txt' && (
          <TxtReader
            file={book.file}
            onLookup={lookup}
            onNavLabel={setNavLabel}
          />
        )}
      </div>

      <TranslationPanel state={translation} onClose={clearTranslation} />
    </div>
  )
}
