import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  LookupAnchor,
  TranslationResult,
  TranslationState,
} from '../types'
import { speakEnglish } from '../lib/speech'
import { getReaderSurfaceRect } from '../lib/popupAnchor'

type Props = {
  state: TranslationState
  onClose: () => void
  isSaved?: boolean
  onAddToStudy?: (result: TranslationResult) => void
}

function highlightTerm(
  text: string,
  hitClass: string,
  ...needles: string[]
): ReactNode {
  const parts = [
    ...new Set(
      needles
        .map((n) => n.trim())
        .filter((n) => n.length > 0)
        .sort((a, b) => b.length - a.length),
    ),
  ]
  if (!parts.length) return text

  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  let re: RegExp
  try {
    // Word-ish boundaries for EN/PL (incl. diacritics)
    re = new RegExp(
      `(?<![\\p{L}\\p{N}_])(${escaped.join('|')})(?![\\p{L}\\p{N}_])`,
      'giu',
    )
  } catch {
    re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
  }
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    nodes.push(
      <mark key={`h-${i++}`} className={hitClass}>
        {m[0]}
      </mark>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length ? nodes : text
}

/** First gloss token(s) suitable for highlighting inside a PL example. */
function polishGlossNeedles(translation: string): string[] {
  const cleaned = translation
    .split(/[;/|•·]/)[0]
    ?.trim()
    .replace(/^\(+|\)+$/g, '')
    .trim()
  if (!cleaned) return []
  const out = [cleaned]
  // Also try the first 1–2 words for multi-word glosses
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length > 1) out.push(words.slice(0, 2).join(' '))
  if (words[0] && words[0].length >= 3) out.push(words[0])
  return out
}

function stateAnchor(state: TranslationState): LookupAnchor | undefined {
  if (state.status === 'idle') return undefined
  return state.anchor
}

export function TranslationPanel({
  state,
  onClose,
  isSaved = false,
  onAddToStudy,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const [justAdded, setJustAdded] = useState(false)

  const termKey =
    state.status === 'ready'
      ? state.result.term
      : state.status === 'loading' || state.status === 'error'
        ? state.term
        : ''
  const anchor = stateAnchor(state)

  useEffect(() => {
    setJustAdded(false)
  }, [termKey, state])

  useLayoutEffect(() => {
    if (state.status === 'idle') return
    const el = ref.current
    if (!el) return

    const pad = 10
    const gap = 10
    const vh = window.innerHeight
    const vw = window.innerWidth
    const page = getReaderSurfaceRect()
    const a = anchor ?? {
      top: vh * 0.35,
      left: page?.left ?? pad,
      width: page?.width ?? Math.min(360, vw - pad * 2),
      height: 24,
    }

    const width = Math.min(
      page ? page.width - pad * 2 : vw - pad * 2,
      Math.max(260, Math.min(420, a.width > 80 ? a.width + 40 : 360)),
    )
    let left = a.left + a.width / 2 - width / 2
    if (page) {
      left = Math.max(
        page.left + pad,
        Math.min(left, page.left + page.width - width - pad),
      )
    } else {
      left = Math.max(pad, Math.min(left, vw - width - pad))
    }

    el.style.width = `${width}px`
    const box = el.getBoundingClientRect()

    let top = a.top + a.height + gap
    if (top + box.height > vh - pad) {
      top = Math.max(pad, a.top - box.height - gap)
    }

    setPos({ top, left, width })
  }, [
    state.status,
    termKey,
    anchor?.top,
    anchor?.left,
    anchor?.width,
    anchor?.height,
    state.status === 'ready' ? state.result.translation : '',
    state.status === 'ready' ? state.result.explanation : '',
    state.status === 'ready' ? state.result.example?.en : '',
  ])

  useEffect(() => {
    if (state.status === 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.status, onClose])

  if (state.status === 'idle') return null

  const englishTerm = termKey
  const saved = isSaved || justAdded

  return (
    <div
      ref={ref}
      className="word-popup"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width || undefined,
      }}
      role="dialog"
      aria-live="polite"
    >
      {state.status === 'loading' && (
        <div className="word-popup__body">
          <div className="word-popup__toolbar">
            <p className="word-popup__lemma">{state.term}</p>
            <button
              type="button"
              className="word-popup__action"
              onClick={onClose}
              aria-label="Zamknij tłumaczenie"
            >
              ×
            </button>
          </div>
          <p className="word-popup__muted">Tłumaczę…</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="word-popup__body">
          <div className="word-popup__toolbar">
            <p className="word-popup__lemma">{state.term}</p>
            <button
              type="button"
              className="word-popup__action"
              onClick={onClose}
              aria-label="Zamknij tłumaczenie"
            >
              ×
            </button>
          </div>
          <p className="word-popup__error">{state.message}</p>
        </div>
      )}

      {state.status === 'ready' && (
        <div className="word-popup__body">
          <div className="word-popup__toolbar">
            <div className="word-popup__titles">
              <p className="word-popup__lemma">
                {state.result.headword ?? state.result.term}
              </p>
              {state.result.headword &&
                state.result.headword.toLowerCase() !==
                  state.result.term.toLowerCase() && (
                  <p className="word-popup__form">
                    forma: <em>{state.result.term}</em>
                  </p>
                )}
            </div>
            <div className="word-popup__actions" role="group" aria-label="Akcje">
              <button
                type="button"
                className="word-popup__action"
                onClick={() => speakEnglish(englishTerm)}
                title="Wymowa"
                aria-label={`Odtwórz wymowę: ${englishTerm}`}
              >
                ▶
              </button>
              {onAddToStudy && (
                <button
                  type="button"
                  className={`word-popup__action${saved ? ' word-popup__action--saved' : ''}`}
                  disabled={saved}
                  title={saved ? 'Już w nauce' : 'Do nauki'}
                  aria-label={saved ? 'Już w nauce' : 'Dodaj do nauki'}
                  onClick={() => {
                    onAddToStudy(state.result)
                    setJustAdded(true)
                  }}
                >
                  {saved ? '✓' : '+'}
                </button>
              )}
              <button
                type="button"
                className="word-popup__action"
                onClick={onClose}
                title="Zamknij"
                aria-label="Zamknij tłumaczenie"
              >
                ×
              </button>
            </div>
          </div>

          <p className="word-popup__pl">{state.result.translation}</p>

          {state.result.explanation && (
            <p className="word-popup__note">{state.result.explanation}</p>
          )}

          {state.result.example && (
            <div className="word-popup__example">
              <p className="word-popup__example-caption">Przykład</p>
              <p className="word-popup__example-en">
                <span className="word-popup__example-lang" aria-hidden="true">
                  EN
                </span>
                <span className="word-popup__example-text">
                  {highlightTerm(
                    state.result.example.en,
                    'word-popup__ex-hit word-popup__ex-hit--en',
                    state.result.term,
                    state.result.headword ?? '',
                  )}
                </span>
                <button
                  type="button"
                  className="word-popup__example-speak"
                  onClick={() => speakEnglish(state.result.example!.en)}
                  title="Wymowa przykładu"
                  aria-label="Odtwórz wymowę przykładu"
                >
                  ▶
                </button>
              </p>
              {state.result.example.pl ? (
                <p className="word-popup__example-pl">
                  <span className="word-popup__example-lang" aria-hidden="true">
                    PL
                  </span>
                  <span className="word-popup__example-text">
                    {highlightTerm(
                      state.result.example.pl,
                      'word-popup__ex-hit word-popup__ex-hit--pl',
                      ...polishGlossNeedles(state.result.translation),
                    )}
                  </span>
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
