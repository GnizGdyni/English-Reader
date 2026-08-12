import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StudyCard } from '../types'
import { speakEnglish } from '../lib/speech'
import { removeStudyCard, shuffleCards } from '../lib/studyDeck'

type Props = {
  cards: StudyCard[]
  onChange: (cards: StudyCard[]) => void
  onClose: () => void
}

export function Flashcards({ cards, onChange, onClose }: Props) {
  const [queue, setQueue] = useState<StudyCard[]>(() => shuffleCards(cards))
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [known, setKnown] = useState(0)
  const [again, setAgain] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setQueue(shuffleCards(cards))
    setIndex(0)
    setFlipped(false)
    setKnown(0)
    setAgain(0)
    setDone(cards.length === 0)
  }, [cards])

  const current = queue[index] ?? null
  const progressLabel = useMemo(() => {
    if (!queue.length) return '0 / 0'
    return `${Math.min(index + 1, queue.length)} / ${queue.length}`
  }, [index, queue.length])

  const goNext = useCallback(
    (remembered: boolean) => {
      if (!current) return
      if (remembered) setKnown((n) => n + 1)
      else setAgain((n) => n + 1)

      setFlipped(false)
      if (index + 1 >= queue.length) {
        setDone(true)
        return
      }
      setIndex((i) => i + 1)
    },
    [current, index, queue.length],
  )

  const removeCurrent = useCallback(() => {
    if (!current) return
    const next = removeStudyCard(cards, current.id)
    onChange(next)
  }, [cards, current, onChange])

  const restart = useCallback(() => {
    setQueue(shuffleCards(cards))
    setIndex(0)
    setFlipped(false)
    setKnown(0)
    setAgain(0)
    setDone(cards.length === 0)
  }, [cards])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (done || !current) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setFlipped((f) => !f)
      }
      if (flipped && (e.key === 'ArrowRight' || e.key === '1')) goNext(true)
      if (flipped && (e.key === 'ArrowLeft' || e.key === '2')) goNext(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, done, flipped, goNext, onClose])

  return (
    <div className="flashcards" role="dialog" aria-label="Ćwiczenie fiszek">
      <header className="flashcards__bar">
        <button type="button" className="flashcards__back" onClick={onClose}>
          ← Czytanie
        </button>
        <span className="flashcards__progress">{progressLabel}</span>
        <button
          type="button"
          className="flashcards__clear"
          disabled={!cards.length}
          onClick={() => {
            if (window.confirm('Usunąć wszystkie słówka z nauki?')) {
              onChange([])
            }
          }}
        >
          Wyczyść
        </button>
      </header>

      {!cards.length && (
        <div className="flashcards__empty">
          <p>Brak słówek do nauki.</p>
          <p className="flashcards__hint">
            Kliknij słowo w książce, a potem „Do nauki”.
          </p>
          <button type="button" onClick={onClose}>
            Wróć
          </button>
        </div>
      )}

      {cards.length > 0 && done && (
        <div className="flashcards__done">
          <h2>Sesja skończona</h2>
          <p>
            Zapamiętane: <strong>{known}</strong> · Jeszcze raz:{' '}
            <strong>{again}</strong>
          </p>
          <div className="flashcards__done-actions">
            <button type="button" onClick={restart}>
              Ćwicz ponownie
            </button>
            <button type="button" className="flashcards__secondary" onClick={onClose}>
              Wróć do książki
            </button>
          </div>
        </div>
      )}

      {cards.length > 0 && !done && current && (
        <div className="flashcards__stage">
          <button
            type="button"
            className={`flashcard${flipped ? ' flashcard--flipped' : ''}`}
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? 'Pokaż angielski' : 'Pokaż tłumaczenie'}
          >
            <div className="flashcard__face flashcard__face--front">
              <span className="flashcard__label">EN</span>
              <span className="flashcard__term">{current.term}</span>
              {current.context && (
                <span className="flashcard__context">{current.context}</span>
              )}
              <span className="flashcard__tap">Kliknij, aby odwrócić</span>
            </div>
            <div className="flashcard__face flashcard__face--back">
              <span className="flashcard__label">PL</span>
              <span className="flashcard__term">{current.translation}</span>
              {current.explanation && (
                <span className="flashcard__expl">{current.explanation}</span>
              )}
              <span className="flashcard__tap">Kliknij, aby odwrócić</span>
            </div>
          </button>

          <div className="flashcards__actions">
            <button
              type="button"
              className="flashcards__speak"
              onClick={() => speakEnglish(current.term)}
            >
              ▶ Wymowa
            </button>
            <button
              type="button"
              className="flashcards__remove"
              onClick={removeCurrent}
              title="Usuń z nauki"
            >
              Usuń
            </button>
          </div>

          {flipped && (
            <div className="flashcards__grade">
              <button
                type="button"
                className="flashcards__again"
                onClick={() => goNext(false)}
              >
                Jeszcze raz
              </button>
              <button
                type="button"
                className="flashcards__known"
                onClick={() => goNext(true)}
              >
                Umiem
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
