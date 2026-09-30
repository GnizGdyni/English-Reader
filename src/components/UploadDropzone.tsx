import { useCallback, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { ACCEPT_ATTR, detectFormat } from '../lib/bookFormat'
import type { LoadedBook } from '../types'

const SAMPLE_BOOK = {
  name: 'HuckFinn.pdf',
  path: `${import.meta.env.BASE_URL}books/HuckFinn.pdf`,
} as const

type Props = {
  onLoad: (book: LoadedBook) => void
}

export function UploadDropzone({ onLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingSample, setLoadingSample] = useState(false)

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      const format = detectFormat(file)
      if (!format) {
        setError('Obsługiwane formaty: EPUB, PDF, TXT.')
        return
      }
      setError(null)
      const url = URL.createObjectURL(file)
      onLoad({ name: file.name, format, url, file })
    },
    [onLoad],
  )

  const loadSample = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation()
      if (loadingSample) return
      setLoadingSample(true)
      setError(null)
      try {
        const res = await fetch(SAMPLE_BOOK.path)
        if (!res.ok) throw new Error('Nie znaleziono pliku testowego.')
        const blob = await res.blob()
        const file = new File([blob], SAMPLE_BOOK.name, {
          type: 'application/pdf',
        })
        const url = URL.createObjectURL(file)
        onLoad({ name: SAMPLE_BOOK.name, format: 'pdf', url, file })
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Nie udało się wczytać książki testowej.',
        )
      } finally {
        setLoadingSample(false)
      }
    },
    [loadingSample, onLoad],
  )

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  return (
    <div className="home">
      <header className="home-brand">
        <p className="brand">English Reader</p>
        <h1>Wrzuć książkę i czytaj z tłumaczeniem</h1>
        <p className="home-lead">
          Zaznacz słowo lub frazę — zobaczysz polskie tłumaczenie, znaczenie i
          podobne słowa.
        </p>
      </header>

      <div className="home-actions">
        <div
          className={`dropzone${dragging ? ' dropzone--active' : ''}`}
          onDragEnter={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <span className="dropzone-title">Upuść plik lub kliknij, by wybrać</span>
          <span className="dropzone-hint">EPUB · PDF · TXT</span>
        </div>

        <button
          type="button"
          className="sample-book"
          onClick={loadSample}
          disabled={loadingSample}
        >
          {loadingSample ? (
            <span className="sample-book__action">Ładowanie…</span>
          ) : (
            <>
              <span className="sample-book__action">Otwórz książkę testową</span>
              <span className="sample-book__title">
                Adventures of Huckleberry Finn
              </span>
            </>
          )}
        </button>
      </div>

      {error && <p className="error-banner">{error}</p>}
    </div>
  )
}
