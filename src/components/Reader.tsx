import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
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
  addReadingTime,
} from '../lib/cloudApi'
import { useChromeSwipe } from '../hooks/useChromeSwipe'
import type { Theme } from '../lib/theme'
import type {
  LoadedBook,
  ReaderNavHandle,
  ReaderNavSnapshot,
  StudyCard,
  TranslationResult,
  TranslationState,
  LookupAnchor,
} from '../types'
import { TranslationPanel } from './TranslationPanel'
import { SentencePopup, type SentencePopupState } from './SentencePopup'
import { ZoomPane } from './ZoomPane'
import { Flashcards } from './Flashcards'
import { ReaderDock } from './ReaderDock'
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

const EMPTY_NAV: ReaderNavSnapshot = {
  page: 1,
  totalPages: null,
  percent: 0,
  canPrev: false,
  canNext: false,
}

export function Reader({ book, onClose, theme, onToggleTheme, userId }: Props) {
  const [translation, setTranslation] = useState<TranslationState>({
    status: 'idle',
  })
  const [navLabel, setNavLabel] = useState('')
  const [navState, setNavState] = useState<ReaderNavSnapshot>(EMPTY_NAV)
  const [dockExpanded, setDockExpanded] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 899px)').matches,
  )
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
  const navRef = useRef<ReaderNavHandle | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const cloudSync = Boolean(userId && book.cloudId)

  const swipeEnabled = !focusMode || zoomScale <= 1.02

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)')
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    setNavState(EMPTY_NAV)
    setDockExpanded(false)
    setChromeVisible(true)
    navRef.current = null
  }, [book.cloudId, book.url, book.name])

  const showChrome = useCallback(() => {
    setChromeVisible(true)
  }, [])

  const hideChrome = useCallback(() => {
    setChromeVisible(false)
    setDockExpanded(false)
  }, [])

  useChromeSwipe(bodyRef, {
    onShow: showChrome,
    onHide: hideChrome,
    enabled: isMobile && !studyOpen,
  })

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
    (
      page: number,
      cfi?: string,
      extras?: { totalPages?: number; progressPercent?: number },
    ) => {
      if (!cloudSync || !book.cloudId) return
      lastProgressRef.current = { page, cfi }
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
      progressTimerRef.current = setTimeout(() => {
        saveReadingProgress(book.cloudId!, page, cfi, extras)
      }, 1500)
    },
    [book.cloudId, cloudSync],
  )

  // Reading time — only cloud (own) books, while tab visible
  useEffect(() => {
    if (!cloudSync || !book.cloudId) return
    const cloudId = book.cloudId
    let pending = 0
    let last = Date.now()

    const flush = () => {
      if (pending <= 0) return
      const add = pending
      pending = 0
      void addReadingTime(cloudId, add)
    }

    const tick = () => {
      const now = Date.now()
      if (document.visibilityState === 'visible') {
        pending += Math.floor((now - last) / 1000)
      }
      last = now
      if (pending >= 20) flush()
    }

    const onVis = () => {
      last = Date.now()
    }

    const interval = window.setInterval(tick, 5000)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
      if (document.visibilityState === 'visible') {
        pending += Math.floor((Date.now() - last) / 1000)
      }
      flush()
    }
  }, [cloudSync, book.cloudId])

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
    setDockExpanded(false)
  }, [clearAllLookups])

  const handleNavState = useCallback((state: ReaderNavSnapshot) => {
    setNavState(state)
  }, [])

  const handleDockPrev = useCallback(() => {
    navRef.current?.goPrev()
  }, [])

  const handleDockNext = useCallback(() => {
    navRef.current?.goNext()
  }, [])

  const handleSeekPercent = useCallback((percent: number) => {
    navRef.current?.seekPercent(percent)
  }, [])

  const handlePdfPageChange = useCallback(
    (page: number, totalPages: number) => {
      const progressPercent =
        totalPages > 0
          ? Math.min(100, Math.round((page / totalPages) * 100))
          : undefined
      queueProgressSave(page, undefined, { totalPages, progressPercent })
    },
    [queueProgressSave],
  )

  const handleEpubProgress = useCallback(
    (progress: { page?: number; cfi?: string; percent?: number }) => {
      const page = progress.page ?? lastProgressRef.current.page
      queueProgressSave(page, progress.cfi, {
        progressPercent: progress.percent,
      })
    },
    [queueProgressSave],
  )

  const handleTxtProgress = useCallback(
    (percent: number) => {
      queueProgressSave(1, undefined, { progressPercent: percent })
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

  const sidebarSliderId = useId()
  const [sidebarSeek, setSidebarSeek] = useState(0)

  useEffect(() => {
    setSidebarSeek(navState.percent)
  }, [navState.percent])

  const navStatusLabel =
    navState.totalPages != null && navState.totalPages > 0
      ? `${navState.page}/${navState.totalPages} · ${navState.percent}%`
      : `${navState.percent}%`

  return (
    <div
      className={`reader-shell${focusMode ? ' reader-shell--focus' : ''}${dockExpanded ? ' reader-shell--dock-open' : ''}${!chromeVisible ? ' reader-shell--chrome-hidden' : ''}`}
    >
      <header className="reader-top">
        <button type="button" className="reader-top__back" onClick={onClose}>
          <svg
            className="reader-top__icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M6 4.5A2.5 2.5 0 0 1 8.5 2H20v18H8.5A2.5 2.5 0 0 0 6 22.5V4.5Zm2 0V20h10V4H8.5c-.17 0-.33.02-.5.05V4.5Z"
            />
            <path
              fill="currentColor"
              d="M4 5.5A1.5 1.5 0 0 1 5.5 4H6v16h-.5A1.5 1.5 0 0 1 4 18.5v-13Z"
              opacity=".55"
            />
          </svg>
          Biblioteka
        </button>
        <button
          type="button"
          className="reader-top__theme"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Tryb jasny' : 'Tryb ciemny'}
          aria-label={theme === 'dark' ? 'Włącz tryb jasny' : 'Włącz tryb ciemny'}
        >
          {theme === 'dark' ? (
            <svg
              className="reader-top__icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4" fill="currentColor" />
              <path
                fill="currentColor"
                d="M12 2.5a1 1 0 0 1 1 1V5a1 1 0 1 1-2 0V3.5a1 1 0 0 1 1-1Zm0 14a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V17.5a1 1 0 0 1 1-1ZM3.5 11a1 1 0 0 0 0 2H5a1 1 0 1 0 0-2H3.5Zm14 0a1 1 0 1 0 0 2H19a1 1 0 1 0 0-2h-1.5ZM5.99 5.99a1 1 0 0 1 1.41 0l1.06 1.06a1 1 0 0 1-1.41 1.41L5.99 7.4a1 1 0 0 1 0-1.41Zm9.55 9.55a1 1 0 0 1 1.41 0l1.06 1.06a1 1 0 1 1-1.41 1.41l-1.06-1.06a1 1 0 0 1 0-1.41ZM18.01 5.99a1 1 0 0 1 0 1.41l-1.06 1.06a1 1 0 1 1-1.41-1.41l1.06-1.06a1 1 0 0 1 1.41 0ZM8.46 15.54a1 1 0 0 1 0 1.41L7.4 18.01a1 1 0 1 1-1.41-1.41l1.06-1.06a1 1 0 0 1 1.41 0Z"
              />
            </svg>
          ) : (
            <svg
              className="reader-top__icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M14.3 2.1a1 1 0 0 1 1.2 1.25 8 8 0 1 0 5.15 5.15 1 1 0 0 1 1.25 1.2A10 10 0 1 1 14.3 2.1Z"
              />
            </svg>
          )}
          {theme === 'dark' ? 'Jasny' : 'Ciemny'}
        </button>
      </header>

      <aside
        className={`reader-bar reader-bar--desktop${focusMode ? ' reader-bar--collapsed' : ''}`}
      >
        <div className="reader-bar__panel">
          <div className="reader-bar__top">
            <button type="button" className="reader-bar__pill" onClick={onClose}>
              <svg
                className="reader-bar__pill-icon"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Biblioteka
            </button>
            <button
              type="button"
              className="reader-bar__pill"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Tryb jasny' : 'Tryb ciemny'}
              aria-label={
                theme === 'dark' ? 'Włącz tryb jasny' : 'Włącz tryb ciemny'
              }
            >
              {theme === 'dark' ? (
                <svg
                  className="reader-bar__pill-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="4"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg
                  className="reader-bar__pill-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {theme === 'dark' ? 'Jasny' : 'Ciemny'}
            </button>
          </div>

          <div className="reader-bar__meta">
            <span className="reader-bar__eyebrow">Teraz czytasz</span>
            <span className="reader-bar__title" title={book.name}>
              {book.name}
            </span>
            {navLabel && <span className="reader-bar__nav">{navLabel}</span>}
          </div>

          <div className="reader-bar__progress">
            <div className="reader-bar__progress-head">
              <span className="reader-bar__progress-pct">
                {navState.percent}%
              </span>
              <span className="reader-bar__progress-pages">
                {navState.totalPages != null && navState.totalPages > 0
                  ? `${navState.page} / ${navState.totalPages}`
                  : navStatusLabel}
              </span>
            </div>
            <label className="visually-hidden" htmlFor={sidebarSliderId}>
              Postęp czytania
            </label>
            <input
              id={sidebarSliderId}
              className="reader-bar__slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={sidebarSeek}
              onChange={(e) => setSidebarSeek(Number(e.target.value))}
              onPointerUp={() => handleSeekPercent(sidebarSeek)}
              onKeyUp={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleSeekPercent(sidebarSeek)
                }
              }}
              onBlur={() => handleSeekPercent(sidebarSeek)}
              style={
                {
                  '--seek': `${sidebarSeek}%`,
                } as CSSProperties
              }
            />
          </div>

          <div className="reader-bar__actions">
            <button
              type="button"
              className={`reader-bar__tool${autoSpeak ? ' reader-bar__tool--on' : ''}`}
              onClick={toggleAutoSpeak}
              aria-pressed={autoSpeak}
              title="Czytaj kliknięte słowo"
            >
              <svg
                className="reader-bar__pill-icon"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M11 5 6 9H2v6h4l5 4V5z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M15.54 8.46a5 5 0 0 1 0 7.07"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M19.07 4.93a10 10 0 0 1 0 14.14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Czytaj
            </button>
            <button
              type="button"
              className="reader-bar__tool"
              onClick={openStudy}
              title="Słownik — zapisane słówka"
            >
              <svg
                className="reader-bar__pill-icon"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Słownik
              {studyDeck.length > 0 && (
                <span className="reader-bar__study-count">{studyDeck.length}</span>
              )}
            </button>
          </div>

          <span className="reader-bar__format">{book.format.toUpperCase()}</span>
        </div>

        <button
          type="button"
          className="reader-bar__toggle"
          onClick={toggleReadingMode}
          aria-expanded={!focusMode}
          aria-label={focusMode ? 'Pokaż panel' : 'Zwiń panel'}
          title={focusMode ? 'Pokaż panel' : 'Zwiń panel'}
        >
          <svg
            className="reader-bar__toggle-chevron"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 5 8 12l7 7"
            />
          </svg>
        </button>
      </aside>

      <div className="reader-body" ref={bodyRef}>
        <ZoomPane enabled={focusMode && !studyOpen} onScaleChange={setZoomScale}>
          <div className="reader-main">
            {book.format === 'epub' && (
              <EpubReader
                ref={navRef}
                url={book.url}
                theme={theme}
                focusMode={focusMode}
                swipeEnabled={swipeEnabled && !studyOpen}
                chromeSwipeEnabled={isMobile && !studyOpen}
                onChromeShow={showChrome}
                onChromeHide={hideChrome}
                initialCfi={book.initialCfi}
                keepHighlight={keepHighlight}
                onLookup={lookup}
                onSentenceLookup={lookupSentence}
                onNavLabel={setNavLabel}
                onProgress={cloudSync ? handleEpubProgress : undefined}
                onNavState={handleNavState}
              />
            )}
            {book.format === 'pdf' && (
              <PdfReader
                ref={navRef}
                url={book.url}
                focusMode={focusMode}
                swipeEnabled={swipeEnabled && !studyOpen}
                initialPage={book.initialPage ?? 1}
                keepHighlight={keepHighlight}
                onLookup={lookup}
                onSentenceLookup={lookupSentence}
                onNavLabel={setNavLabel}
                onPageChange={cloudSync ? handlePdfPageChange : undefined}
                onNavState={handleNavState}
              />
            )}
            {book.format === 'txt' && (
              <TxtReader
                ref={navRef}
                file={book.file}
                focusMode={focusMode}
                keepHighlight={keepHighlight}
                onLookup={lookup}
                onSentenceLookup={lookupSentence}
                onNavLabel={setNavLabel}
                onProgress={cloudSync ? handleTxtProgress : undefined}
                onNavState={handleNavState}
              />
            )}
          </div>
        </ZoomPane>
      </div>

      {!studyOpen && (
        <ReaderDock
          expanded={dockExpanded}
          onToggle={() => setDockExpanded((v) => !v)}
          nav={navState}
          onPrev={handleDockPrev}
          onNext={handleDockNext}
          onSeekPercent={handleSeekPercent}
          autoSpeak={autoSpeak}
          onToggleAutoSpeak={toggleAutoSpeak}
          studyCount={studyDeck.length}
          onOpenStudy={openStudy}
        />
      )}

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
