import { useEffect, useLayoutEffect, useState } from 'react'
import type { TranslationResult, TranslationState } from '../types'
import { speakEnglish } from '../lib/speech'
import { translateSentence } from '../lib/translate'

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

export function TranslationPanel({
  state,
  onClose,
  isSaved = false,
  onAddToStudy,
}: Props) {
  const [contextOpen, setContextOpen] = useState(false)
  const [justAdded, setJustAdded] = useState(false)
  const [contextPl, setContextPl] = useState<string | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
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
    setContextOpen(false)
    setJustAdded(false)
    setContextPl(
      state.status === 'ready' ? state.result.contextTranslation ?? null : null,
    )
    setContextLoading(false)
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

  const openContext = () => {
    const opening = !contextOpen
    setContextOpen(opening)
    if (
      opening &&
      state.status === 'ready' &&
      state.result.context &&
      !contextPl &&
      !contextLoading
    ) {
      setContextLoading(true)
      void translateSentence(state.result.context).then((pl) => {
        setContextPl(pl)
        setContextLoading(false)
      })
    }
  }

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
            <p className="translation-panel__term">{state.term}</p>
            <p className="translation-panel__muted">Tłumaczę…</p>
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

            {state.result.context && (
              <div className="translation-panel__context">
                <button
                  type="button"
                  className="translation-panel__context-toggle"
                  aria-expanded={contextOpen}
                  onClick={openContext}
                >
                  <span>W kontekście</span>
                  <span className="translation-panel__chevron" aria-hidden="true">
                    {contextOpen ? '▾' : '▸'}
                  </span>
                </button>
                {contextOpen && (
                  <div className="translation-panel__context-body">
                    <p className="translation-panel__context-en">
                      {state.result.context}
                    </p>
                    {contextLoading && (
                      <p className="translation-panel__muted">Tłumaczę zdanie…</p>
                    )}
                    {contextPl && (
                      <p className="translation-panel__context-pl">{contextPl}</p>
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
