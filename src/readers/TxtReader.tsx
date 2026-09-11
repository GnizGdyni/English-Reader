import { useEffect, useRef, useState } from 'react'
import {
  lookupAtPoint,
  selectionLookup,
  highlightLookup,
  clearLookupHighlight,
} from '../lib/selection'

type Props = {
  file: File
  focusMode?: boolean
  keepHighlight?: boolean
  onLookup: (term: string, context?: string) => void
  onNavLabel: (label: string) => void
}

export function TxtReader({
  file,
  focusMode = false,
  keepHighlight = false,
  onLookup,
  onNavLabel,
}: Props) {
  const articleRef = useRef<HTMLElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReady(false)
    setError(null)
    onNavLabel('Tekst')

    file
      .text()
      .then((content) => {
        if (cancelled) return
        const el = articleRef.current
        if (el) el.textContent = content
        setLoading(false)
        setReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : 'Nie udało się wczytać pliku tekstowego.',
        )
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [file, onNavLabel])

  useEffect(() => {
    if (!keepHighlight) {
      clearLookupHighlight(articleRef.current)
    }
  }, [keepHighlight])

  return (
    <div className={`txt-reader${focusMode ? ' txt-reader--focus' : ''}`}>
      {loading && <p className="reader-status">Ładowanie tekstu…</p>}
      {error && <p className="error-banner">{error}</p>}
      <article
        ref={articleRef}
        className="txt-article"
        hidden={loading || Boolean(error) || !ready}
        onClick={(e) => {
          const el = articleRef.current
          if (!el) return

          const selected = selectionLookup(el)
          if (selected) {
            highlightLookup(el, selected)
            onLookup(selected.term, selected.context)
            return
          }

          const sel = window.getSelection()
          if (sel && !sel.isCollapsed && sel.toString().trim()) return

          const hit = lookupAtPoint(el, e.clientX, e.clientY)
          if (hit) {
            highlightLookup(el, hit)
            onLookup(hit.term, hit.context)
          }
        }}
      />
    </div>
  )
}
