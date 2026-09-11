import { useCallback, useEffect, useRef, useState } from 'react'
import { ACCEPT_ATTR, detectFormat } from '../lib/bookFormat'
import {
  deleteSavedBook,
  fetchSavedBooks,
  openSavedBook,
  uploadBook,
} from '../lib/cloudApi'
import { MAX_SAVED_BOOKS } from '../lib/supabase'
import type { LoadedBook, SavedBook } from '../types'

type Props = {
  onOpenBook: (book: LoadedBook) => void
}

export function LibraryPanel({ onOpenBook }: Props) {
  const [books, setBooks] = useState<SavedBook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchSavedBooks()
      setBooks(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd wczytywania biblioteki.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleOpen = useCallback(
    async (saved: SavedBook) => {
      setOpeningId(saved.id)
      setError(null)
      try {
        const loaded = await openSavedBook(saved)
        onOpenBook(loaded)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nie udało się otworzyć książki.')
      } finally {
        setOpeningId(null)
      }
    },
    [onOpenBook],
  )

  const handleDelete = useCallback(
    async (bookId: string) => {
      setError(null)
      try {
        await deleteSavedBook(bookId)
        setBooks((prev) => prev.filter((b) => b.id !== bookId))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nie udało się usunąć książki.')
      }
    },
    [],
  )

  const handleUpload = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      const format = detectFormat(file)
      if (!format) {
        setError('Obsługiwane formaty: EPUB, PDF, TXT.')
        return
      }
      setUploading(true)
      setError(null)
      try {
        const saved = await uploadBook(file)
        setBooks((prev) => [...prev, saved])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Błąd zapisu książki.')
      } finally {
        setUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [],
  )

  const canAdd = books.length < MAX_SAVED_BOOKS

  return (
    <section className="library-panel" aria-labelledby="library-title">
      <div className="library-panel__head">
        <h2 id="library-title" className="library-panel__title">Moja biblioteka</h2>
        <span className="library-panel__count">
          {books.length} / {MAX_SAVED_BOOKS}
        </span>
      </div>

      {loading && <p className="library-panel__status">Ładowanie…</p>}

      {!loading && books.length === 0 && (
        <p className="library-panel__empty">
          Brak zapisanych książek. Dodaj plik EPUB, PDF lub TXT (max {MAX_SAVED_BOOKS}).
        </p>
      )}

      <ul className="library-panel__list">
        {books.map((book) => (
          <li key={book.id} className="library-panel__item">
            <button
              type="button"
              className="library-panel__open"
              onClick={() => handleOpen(book)}
              disabled={openingId === book.id}
            >
              <span className="library-panel__name">{book.name}</span>
              <span className="library-panel__meta">
                {book.format.toUpperCase()}
                {book.page > 1 ? ` · strona ${book.page}` : ''}
              </span>
            </button>
            <button
              type="button"
              className="library-panel__delete"
              onClick={() => handleDelete(book.id)}
              aria-label={`Usuń ${book.name}`}
              title="Usuń z biblioteki"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {canAdd && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            hidden
            onChange={(e) => handleUpload(e.target.files?.[0])}
          />
          <button
            type="button"
            className="library-panel__add"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Zapisuję…' : '+ Dodaj książkę do biblioteki'}
          </button>
        </>
      )}

      {error && <p className="error-banner">{error}</p>}
    </section>
  )
}
