import { useCallback, useEffect, useRef, useState } from 'react'
import { translate, translateSentence } from '../lib/translate'
import {
  loadAutoSpeak,
  saveAutoSpeak,
  speakEnglish,
  stopSpeaking,
} from '../lib/speech'
import { loadFocusMode, saveFocusMode } from '../lib/focusMode'
import {
  addStudyCard,
  hasStudyCard,
  loadStudyDeck,
  saveStudyDeck,
} from '../lib/studyDeck'
import {
  fetchStudyCardsFromCloud,
  saveReadingProgress,
  syncStudyCardsToCloud,
} from '../lib/cloudApi'
import type { Theme } from '../lib/theme'
import type { LoadedBook, StudyCard, TranslationResult, TranslationState, LookupAnchor } from '../types'
import { TranslationPanel } from './TranslationPanel'
import { SentencePopup, type SentencePopupState } from './SentencePopup'
import { ThemeToggle } from './ThemeToggle'
import { ZoomPane } from './ZoomPane'
import { Flashcards } from './Flashcards'
import { EpubReader } from '../readers/EpubReader'
import { PdfReader, type SentenceLookupPayload } from '../readers/PdfReader'
import { TxtReader } from '../readers/TxtReader'

type Props = {
  book: LoadedBook
  onClose: () => void
  theme: Theme
  onToggleTheme: () => void
  userId?: string
}

export function Reader({ book, onClose, theme, onToggleTheme, userId }: Props) {
  const [translation, setTranslation] = useState<TranslationState>({
    status: 'idle',
  })
  const [navLabel, setNavLabel] = useState('')
  const [autoSpeak, setAutoSpeak] = useState(loadAutoSpeak)
  const [focusMode, setFocusMode] = useState(loadFocusMode)
  const [zoomScale, setZoomScale] = useState(1)
  const [studyDeck, setStudyDeck] = useState<StudyCard[]>(loadStudyDeck)
  const [studyOpen, setStudyOpen] = useState(false)
  const [sentencePopup, setSentencePopup] = useState<SentencePopupState | null>(
    null,
  )
  const requestId = useRef(0)
  const sentenceRequestId = useRef(0)
  const lastLookupRef = useRef({ key: '', at: 0 })
  const autoSpeakRef = useRef(autoSpeak)
  autoSpeakRef.current = autoSpeak
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProgressRef = useRef({ page: book.initialPage ?? 1, cfi: book.initialCfi })

  const cloudSync = Boolean(userId && book.cloudId)

  const swipeEnabled = !focusMode || zoomScale <= 1.02

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetchStudyCardsFromCloud()
      .then((cards) => {
        if (cancelled) return
        setStudyDeck(cards)
        saveStudyDeck(cards)
      })
      .catch(() => {
        /* keep local deck */
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const updateStudyDeck = useCallback(
    (cards: StudyCard[]) => {
      setStudyDeck(cards)
      saveStudyDeck(cards)
      if (userId) {
        syncStudyCardsToCloud(cards).catch(() => {
          /* offline — local copy remains */
        })
      }
    },
    [userId],
  )

  const queueProgressSave = useCallback(
    (page: number, cfi?: string) => {
      if (!cloudSync || !book.cloudId) return
      lastProgressRef.current = { page, cfi }
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
      progressTimerRef.current = setTimeout(() => {
        saveReadingProgress(book.cloudId!, page, cfi)
      }, 1500)
    },
    [book.cloudId, cloudSync],
  )

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
      if (cloudSync && book.cloudId) {
        const { page, cfi } = lastProgressRef.current
        saveReadingProgress(book.cloudId, page, cfi)
      }
    }
  }, [book.cloudId, cloudSync])

  const addToStudy = useCallback(
    (result: TranslationResult) => {
      updateStudyDeck(
        addStudyCard(studyDeck, {
          term: result.term,
          translation: result.translation,
          context: result.context,
          explanation: result.explanation,
        }),
      )
    },
    [studyDeck, updateStudyDeck],
  )

  const lookup = useCallback(
    async (term: string, context?: string, anchor?: LookupAnchor) => {
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

      setSentencePopup(null)
      sentenceRequestId.current += 1

      const id = ++requestId.current
      setTranslation((prev) => {
        if (prev.status === 'loading' && prev.term === term) {
          return { ...prev, anchor: anchor ?? prev.anchor }
        }
        return { status: 'loading', term, anchor }
      })

      if (autoSpeakRef.current) {
        speakEnglish(term)
      }

      try {
        const result = await translate(term, context)
        if (id !== requestId.current) return
        setTranslation({ status: 'ready', result, anchor })
      } catch (err) {
        if (id !== requestId.current) return
        setTranslation({
          status: 'error',
          term,
          message:
            err instanceof Error ? err.message : 'Błąd tłumaczenia.',
          anchor,
        })
      }
    },
    [],
  )

  const lookupSentence = useCallback(async (payload: SentenceLookupPayload) => {
    const sentence = payload.sentence.trim()
    if (!sentence) return

    requestId.current += 1
    setTranslation({ status: 'idle' })

    const id = ++sentenceRequestId.current
    setSentencePopup({
      sentence,
      translation: null,
      loading: true,
      anchor: payload.anchor,
    })

    try {
      const pl = await translateSentence(sentence)
      if (id !== sentenceRequestId.current) return
      if (!pl) {
        setSentencePopup({
          sentence,
          translation: null,
          loading: false,
          error: 'Nie udało się przetłumaczyć zdania.',
          anchor: payload.anchor,
        })
        return
      }
      setSentencePopup({
        sentence,
        translation: pl,
        loading: false,
        anchor: payload.anchor,
      })
    } catch (err) {
      if (id !== sentenceRequestId.current) return
      setSentencePopup({
        sentence,
        translation: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Błąd tłumaczenia zdania.',
        anchor: payload.anchor,
      })
    }
  }, [])

  const clearTranslation = useCallback(() => {
    requestId.current += 1
    stopSpeaking()
    setTranslation({ status: 'idle' })
  }, [])

  const clearSentencePopup = useCallback(() => {
    sentenceRequestId.current += 1
    setSentencePopup(null)
  }, [])

  const clearAllLookups = useCallback(() => {
    clearTranslation()
    clearSentencePopup()
  }, [clearTranslation, clearSentencePopup])

  const toggleAutoSpeak = useCallback(() => {
    setAutoSpeak((prev) => {
      const next = !prev
      saveAutoSpeak(next)
      return next
    })
  }, [])

  const setReadingMode = useCallback(
    (on: boolean) => {
      setFocusMode(on)
      saveFocusMode(on)
      if (on) clearAllLookups()
    },
    [clearAllLookups],
  )

  const toggleReadingMode = useCallback(() => {
    setReadingMode(!focusMode)
  }, [focusMode, setReadingMode])

  const openStudy = useCallback(() => {
    clearAllLookups()
    setStudyOpen(true)
  }, [clearAllLookups])

  const handlePdfPageChange = useCallback(
    (page: number) => {
      queueProgressSave(page)
    },
    [queueProgressSave],
  )

  const handleEpubProgress = useCallback(
    (progress: { page?: number; cfi?: string }) => {
      const page = progress.page ?? lastProgressRef.current.page
      queueProgressSave(page, progress.cfi)
    },
    [queueProgressSave],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (studyOpen) {
          setStudyOpen(false)
          return
        }
        if (sentencePopup) {
          clearSentencePopup()
          return
        }
        if (focusMode) {
          setReadingMode(false)
        } else {
          clearAllLookups()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stopSpeaking()
    }
  }, [
    clearAllLookups,
    clearSentencePopup,
    focusMode,
    sentencePopup,
    setReadingMode,
    studyOpen,
  ])

  const currentSaved =
    translation.status === 'ready' &&
    hasStudyCard(studyDeck, translation.result.term)

  const keepHighlight =
    translation.status !== 'idle' || sentencePopup != null

  return (
    <div
      className={`reader-shell${focusMode ? ' reader-shell--focus' : ''}`}
    >
      <aside
        className={`reader-bar${focusMode ? ' reader-bar--collapsed' : ''}`}
      >
        <button
          type="button"
          className="reader-bar__toggle"
          onClick={toggleReadingMode}
          aria-expanded={!focusMode}
          aria-label={focusMode ? 'Pokaż menu' : 'Tryb czytania — schowaj menu'}
          title={focusMode ? 'Pokaż menu' : 'Tryb czytania — schowaj menu'}
        >
          <span className="reader-bar__toggle-icon" aria-hidden />
        </button>
        <div className="reader-bar__panel">
          <button type="button" className="reader-bar__back" onClick={onClose}>
            ← Biblioteka
          </button>
          <div className="reader-bar__meta">
            <span className="reader-bar__title" title={book.name}>
              {book.name}
            </span>
            {navLabel && <span className="reader-bar__nav">{navLabel}</span>}
          </div>
          <div className="reader-bar__actions">
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
              className="reader-bar__study"
              onClick={openStudy}
              title="Ćwicz zapisane słówka"
            >
              Ćwicz
              {studyDeck.length > 0 && (
                <span className="reader-bar__study-count">{studyDeck.length}</span>
              )}
            </button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
          <span className="reader-bar__format">{book.format.toUpperCase()}</span>
        </div>
      </aside>

      <div className="reader-body">
        <ZoomPane enabled={focusMode && !studyOpen} onScaleChange={setZoomScale}>
          <div className="reader-main">
            {book.format === 'epub' && (
              <EpubReader
                url={book.url}
                theme={theme}
                focusMode={focusMode}
                swipeEnabled={swipeEnabled && !studyOpen}
                initialCfi={book.initialCfi}
                keepHighlight={keepHighlight}
                onLookup={lookup}
                onSentenceLookup={lookupSentence}
                onNavLabel={setNavLabel}
                onProgress={cloudSync ? handleEpubProgress : undefined}
              />
            )}
            {book.format === 'pdf' && (
              <PdfReader
                url={book.url}
                focusMode={focusMode}
                swipeEnabled={swipeEnabled && !studyOpen}
                initialPage={book.initialPage ?? 1}
                keepHighlight={keepHighlight}
                onLookup={lookup}
                onSentenceLookup={lookupSentence}
                onNavLabel={setNavLabel}
                onPageChange={cloudSync ? handlePdfPageChange : undefined}
              />
            )}
            {book.format === 'txt' && (
              <TxtReader
                file={book.file}
                focusMode={focusMode}
                keepHighlight={keepHighlight}
                onLookup={lookup}
                onSentenceLookup={lookupSentence}
                onNavLabel={setNavLabel}
              />
            )}
          </div>
        </ZoomPane>
      </div>

      {!studyOpen && !sentencePopup && (
        <TranslationPanel
          state={translation}
          onClose={clearTranslation}
          isSaved={currentSaved}
          onAddToStudy={addToStudy}
        />
      )}

      {sentencePopup && (
        <SentencePopup state={sentencePopup} onClose={clearSentencePopup} />
      )}

      {studyOpen && (
        <Flashcards
          cards={studyDeck}
          onChange={updateStudyDeck}
          onClose={() => setStudyOpen(false)}
        />
      )}
    </div>
  )
}
