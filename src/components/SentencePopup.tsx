import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type SentenceAnchor = {
  top: number
  left: number
  width: number
  height: number
}

export type SentencePopupState = {
  sentence: string
  translation: string | null
  loading: boolean
  error?: string
  anchor: SentenceAnchor
}

type Props = {
  state: SentencePopupState
  onClose: () => void
}

function getPdfPageRect(): DOMRect | null {
  const el = document.querySelector('.pdf-page')
  return el?.getBoundingClientRect() ?? null
}

export function SentencePopup({ state, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const pad = 10
    const gap = 8
    const vh = window.innerHeight
    const vw = window.innerWidth
    const page = getPdfPageRect()
    const a = state.anchor

    const width = page
      ? Math.max(120, page.width)
      : Math.min(vw - pad * 2, a.width || vw - pad * 2)
    const left = page
      ? page.left
      : Math.max(pad, Math.min(a.left, vw - width - pad))

    // Measure height with the target width applied.
    el.style.width = `${width}px`
    const box = el.getBoundingClientRect()

    let top = a.top + a.height + gap
    if (top + box.height > vh - pad) {
      top = Math.max(pad, a.top - box.height - gap)
    }

    setPos({ top, left, width })
  }, [state.anchor, state.translation, state.loading, state.error])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="sentence-popup"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width || undefined,
      }}
      role="dialog"
      aria-live="polite"
    >
      <button
        type="button"
        className="sentence-popup__close"
        onClick={onClose}
        aria-label="Zamknij tłumaczenie zdania"
      >
        ×
      </button>
      <p className="sentence-popup__en">{state.sentence}</p>
      {state.loading && (
        <p className="sentence-popup__muted">Tłumaczę zdanie…</p>
      )}
      {state.error && <p className="sentence-popup__error">{state.error}</p>}
      {state.translation && (
        <p className="sentence-popup__pl">{state.translation}</p>
      )}
    </div>
  )
}
