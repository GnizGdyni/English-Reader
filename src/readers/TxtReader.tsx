import { useEffect, useRef, useState } from 'react'
import { lookupAtPoint, selectionLookup } from '../lib/selection'

type Props = {
  file: File
  onLookup: (term: string, context?: string) => void
  onNavLabel: (label: string) => void
}

export function TxtReader({ file, onLookup, onNavLabel }: Props) {
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
            : 'Nie udało się odczytać pliku TXT.',
        )
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [file, onNavLabel])

  return (
    <div className="txt-reader">
      {loading && <p className="reader-status">Ładowanie tekstu…</p>}
      {error && <p className="error-banner">{error}</p>}
      {!loading && !error && (
        <article
          ref={articleRef}
          className="txt-article"
          onMouseUp={() => {
            const el = articleRef.current
            const selected = selectionLookup(el ?? undefined)
            if (selected) onLookup(selected.term, selected.context)
          }}
          onClick={(e) => {
            const el = articleRef.current
            if (!el) return
            const sel = window.getSelection()
            if (sel && !sel.isCollapsed && sel.toString().trim()) return
            const hit = lookupAtPoint(el, e.clientX, e.clientY)
            if (hit) onLookup(hit.term, hit.context)
          }}
        >
          {text}
        </article>
      )}
      <p className="reader-hint">Zaznacz tekst lub kliknij słowo</p>
    </div>
  )
}
