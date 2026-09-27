import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import type { TranslationResult, TranslationState } from '../types'
import { speakEnglish } from '../lib/speech'

type Props = {
  state: TranslationState
  onClose: () => void
  isSaved?: boolean
  onAddToStudy?: (result: TranslationResult) => void
}

function getPdfPageRect(): DOMRect | null {
  const el = document.querySelector('.pdf-page')
  return el?.getBoundingClientRect() ?? null
}

/** Bold the looked-up term / headword inside an example sentence. */
function highlightTerm(text: string, ...needles: string[]): ReactNode {
  const parts = needles
    .map((n) => n.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (!parts.length) return text

  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(
      <strong key={`h-${i++}`} className="translation-panel__ex-hit">
        {m[0]}
      </strong>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length ? nodes : text
}

export function TranslationPanel({
  state,
  onClose,
  isSaved = false,
  onAddToStudy,
}: Props) {
  const [justAdded, setJustAdded] = useState(false)
  const [pageBox, setPageBox] = useState<{ left: number; width: number } | null>(
    null,
  )

  const termKey =
    state.status === 'ready'
      ? state.result.term
      : state.status === 'loading' || state.status === 'error'
        ? state.term
        : ''

  useEffect(() => {
    setJustAdded(false)
  }, [termKey, state])

  useLayoutEffect(() => {
    if (state.status === 'idle') return

    const sync = () => {
      const page = getPdfPageRect()
      if (page && page.width > 40) {
        setPageBox({ left: page.left, width: page.width })
      } else {
        setPageBox(null)
      }
    }

    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [state.status, termKey])

  if (state.status === 'idle') return null

  const englishTerm = termKey
  const saved = isSaved || justAdded

  return (
    <aside
      className="translation-panel"
      aria-live="polite"
      style={
        pageBox
          ? {
              left: pageBox.left,
              right: 'auto',
              width: pageBox.width,
              paddingLeft: 0,
              paddingRight: 0,
            }
          : undefined
      }
    >
      <div className="translation-panel__inner">
        <button
          type="button"
          className="translation-panel__close"
          onClick={onClose}
          aria-label="Zamknij panel tłumaczenia"
        >
          ×
        </button>

        {state.status === 'loading' && (
          <>
            <p className="translation-panel__headword">{state.term}</p>
            <p className="translation-panel__muted">Tłumaczę…</p>
          </>
        )}

        {state.status === 'error' && (
          <>
            <p className="translation-panel__headword">{state.term}</p>
            <p className="translation-panel__error">{state.message}</p>
          </>
        )}

        {state.status === 'ready' && (
          <>
            <div className="translation-panel__top">
              <p className="translation-panel__headword">
                {state.result.headword ?? state.result.term}
                {state.result.headword &&
                  state.result.headword.toLowerCase() !==
                    state.result.term.toLowerCase() && (
                    <span className="translation-panel__form-hint">
                      {' '}
                      ← {state.result.term}
                    </span>
                  )}
              </p>
              <div className="translation-panel__actions">
                <button
                  type="button"
                  className="translation-panel__icon-btn"
                  onClick={() => speakEnglish(englishTerm)}
                  title="Wymowa angielska"
                  aria-label={`Odtwórz wymowę: ${englishTerm}`}
                >
                  <span aria-hidden="true">▶</span>
                </button>
                {onAddToStudy && (
                  <button
                    type="button"
                    className={`translation-panel__icon-btn${saved ? ' translation-panel__icon-btn--saved' : ''}`}
                    disabled={saved}
                    title={saved ? 'Już w nauce' : 'Dodaj do nauki'}
                    aria-label={saved ? 'Już w nauce' : 'Dodaj do nauki'}
                    onClick={() => {
                      onAddToStudy(state.result)
                      setJustAdded(true)
                    }}
                  >
                    <span aria-hidden="true">{saved ? '✓' : '+'}</span>
                  </button>
                )}
              </div>
            </div>

            <p className="translation-panel__pl">{state.result.translation}</p>

            {state.result.explanation && (
              <p className="translation-panel__expl">
                {state.result.explanation}
              </p>
            )}

            {state.result.example && (
              <div className="translation-panel__example">
                <p className="translation-panel__example-en">
                  {highlightTerm(
                    state.result.example.en,
                    state.result.term,
                    state.result.headword ?? '',
                  )}
                  <button
                    type="button"
                    className="translation-panel__example-speak"
                    onClick={() => speakEnglish(state.result.example!.en)}
                    title="Wymowa przykładu"
                    aria-label="Odtwórz wymowę przykładu"
                  >
                    <span aria-hidden="true">▶</span>
                  </button>
                </p>
                {state.result.example.pl ? (
                  <p className="translation-panel__example-pl">
                    {state.result.example.pl}
                  </p>
                ) : (
                  <p className="translation-panel__muted">
                    Nie udało się przetłumaczyć przykładu.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
