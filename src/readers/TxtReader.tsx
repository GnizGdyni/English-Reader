import { useEffect, useRef, useState } from 'react'
import { lookupAtPoint, selectionLookup } from '../lib/selection'

type Props = {
  file: File
  focusMode?: boolean
  onLookup: (term: string, context?: string) => void
  onNavLabel: (label: string) => void
}

export function TxtReader({
  file,
  focusMode = false,
  onLookup,
  onNavLabel,
}: Props) {
  const articleRef = useRef<HTMLElement>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    onNavLabel('Tekst')

    file
      .text()
      .then((content) => {
        if (cancelled) return
        setText(content)
        setLoading(false)
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

  return (
    <div className={`txt-reader${focusMode ? ' txt-reader--focus' : ''}`}>
      {loading && <p className="reader-status">Ładowanie tekstu…</p>}
      {error && <p className="error-banner">{error}</p>}
      {!loading && !error && (
        <article
          ref={articleRef}
          className="txt-article"
          onClick={(e) => {
            const el = articleRef.current
            if (!el) return

            const selected = selectionLookup(el)
            if (selected) {
              onLookup(selected.term, selected.context)
              return
            }

            const sel = window.getSelection()
            if (sel && !sel.isCollapsed && sel.toString().trim()) return

            const hit = lookupAtPoint(el, e.clientX, e.clientY)
            if (hit) onLookup(hit.term, hit.context)
          }}
        >
          {text}
        </article>
      )}
    </div>
  )
}
