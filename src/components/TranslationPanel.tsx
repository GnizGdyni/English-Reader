import { useEffect, useState } from 'react'
import type { TranslationResult, TranslationState } from '../types'
import { speakEnglish } from '../lib/speech'

type Props = {
  state: TranslationState
  onClose: () => void
  isSaved?: boolean
  onAddToStudy?: (result: TranslationResult) => void
}

export function TranslationPanel({
  state,
  onClose,
  isSaved = false,
  onAddToStudy,
}: Props) {
  const [contextOpen, setContextOpen] = useState(false)
  const [justAdded, setJustAdded] = useState(false)

  const termKey =
    state.status === 'ready'
      ? state.result.term
      : state.status === 'loading' || state.status === 'error'
        ? state.term
        : ''

  useEffect(() => {
    setContextOpen(false)
    setJustAdded(false)
  }, [termKey])

  if (state.status === 'idle') return null

  const englishTerm = termKey
  const saved = isSaved || justAdded

  return (
    <aside className="translation-panel" aria-live="polite">
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
            <p className="translation-panel__term">{state.term}</p>
            <p className="translation-panel__muted">Tłumaczę w kontekście…</p>
          </>
        )}

        {state.status === 'error' && (
          <>
            <p className="translation-panel__term">{state.term}</p>
            <p className="translation-panel__error">{state.message}</p>
          </>
        )}

        {state.status === 'ready' && (
          <>
            <p className="translation-panel__term">{state.result.term}</p>
            <div className="translation-panel__pl-row">
              <p className="translation-panel__pl">{state.result.translation}</p>
              <button
                type="button"
                className="translation-panel__speak"
                onClick={() => speakEnglish(englishTerm)}
                title="Wymowa angielska"
                aria-label={`Odtwórz wymowę: ${englishTerm}`}
              >
                <span aria-hidden="true">▶</span> Wymowa
              </button>
            </div>

            {onAddToStudy && (
              <button
                type="button"
                className={`translation-panel__study${saved ? ' translation-panel__study--saved' : ''}`}
                disabled={saved}
                onClick={() => {
                  onAddToStudy(state.result)
                  setJustAdded(true)
                }}
              >
                {saved ? '✓ W nauce' : '+ Do nauki'}
              </button>
            )}

            {(state.result.context || state.result.contextTranslation) && (
              <div className="translation-panel__context">
                <button
                  type="button"
                  className="translation-panel__context-toggle"
                  aria-expanded={contextOpen}
                  onClick={() => setContextOpen((o) => !o)}
                >
                  <span>W kontekście</span>
                  <span className="translation-panel__chevron" aria-hidden="true">
                    {contextOpen ? '▾' : '▸'}
                  </span>
                </button>
                {contextOpen && (
                  <div className="translation-panel__context-body">
                    {state.result.context && (
                      <p className="translation-panel__context-en">
                        {state.result.context}
                      </p>
                    )}
                    {state.result.contextTranslation && (
                      <p className="translation-panel__context-pl">
                        {state.result.contextTranslation}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {state.result.explanation && (
              <p className="translation-panel__expl">{state.result.explanation}</p>
            )}
            {state.result.similar && state.result.similar.length > 0 && (
              <div className="translation-panel__similar">
                <span className="translation-panel__label">
                  Podobne (w tym znaczeniu)
                </span>
                <ul>
                  {state.result.similar.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
