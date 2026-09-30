import { useCallback, useEffect, useRef, useState } from 'react'
import { ACCEPT_ATTR, detectFormat } from '../lib/bookFormat'
import {
  deleteSavedBook,
  fetchSavedBooks,
  openSavedBook,
  renameSavedBook,
  uploadBook,
} from '../lib/cloudApi'
import { MAX_SAVED_BOOKS } from '../lib/supabase'
import type { LoadedBook, SavedBook } from '../types'

type Props = {
  onOpenBook: (book: LoadedBook) => void
}

function formatReadingTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h} h ${rm} min` : `${h} h`
}

export function LibraryPanel({ onOpenBook }: Props) {
  const [books, setBooks] = useState<SavedBook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingBusy, setRenamingBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  const handleOpen = useCallback(
    async (saved: SavedBook) => {
      if (renamingId === saved.id) return
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
    [onOpenBook, renamingId],
  )

  const handleDelete = useCallback(async (bookId: string) => {
    setError(null)
    try {
      await deleteSavedBook(bookId)
      setBooks((prev) => prev.filter((b) => b.id !== bookId))
      if (renamingId === bookId) setRenamingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć książki.')
    }
  }, [renamingId])

  const startRename = useCallback((book: SavedBook) => {
    setRenamingId(book.id)
    setRenameValue(book.name)
    setError(null)
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
    setRenameValue('')
  }, [])

  const commitRename = useCallback(async () => {
    if (!renamingId) return
    const next = renameValue.replace(/\s+/g, ' ').trim()
    if (!next) {
      setError('Nazwa nie może być pusta.')
      return
    }
    setRenamingBusy(true)
    setError(null)
    try {
      const updated = await renameSavedBook(renamingId, next)
      setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
      setRenamingId(null)
      setRenameValue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zmienić nazwy.')
    } finally {
      setRenamingBusy(false)
    }
  }, [renamingId, renameValue])

  const handleUpload = useCallback(async (file: File | undefined) => {
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
  }, [])

  const canAdd = books.length < MAX_SAVED_BOOKS

  return (
    <section className="library-panel" aria-labelledby="library-title">
      <div className="library-panel__head">
        <h2 id="library-title" className="library-panel__title">
          Moja biblioteka
        </h2>
        <span className="library-panel__count">
          {books.length} / {MAX_SAVED_BOOKS}
        </span>
      </div>

      {loading && <p className="library-panel__status">Ładowanie…</p>}

      {!loading && books.length === 0 && (
        <p className="library-panel__empty">
          Brak zapisanych książek. Dodaj plik EPUB, PDF lub TXT (max{' '}
          {MAX_SAVED_BOOKS}).
        </p>
      )}

      <ul className="library-panel__list">
        {books.map((book) => {
          const renaming = renamingId === book.id
          const pct = book.progressPercent
          const showPct = book.progressPercent > 0 || book.totalPages != null

          return (
            <li key={book.id} className="library-panel__item">
              <div className="library-panel__main">
                {renaming ? (
                  <div className="library-panel__rename">
                    <input
                      ref={renameInputRef}
                      className="library-panel__rename-input"
                      value={renameValue}
                      maxLength={120}
                      disabled={renamingBusy}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename()
                        if (e.key === 'Escape') cancelRename()
                      }}
                      aria-label="Nowa nazwa książki"
                    />
                    <button
                      type="button"
                      className="library-panel__rename-save"
                      onClick={() => void commitRename()}
                      disabled={renamingBusy}
                    >
                      Zapisz
                    </button>
                    <button
                      type="button"
                      className="library-panel__rename-cancel"
                      onClick={cancelRename}
                      disabled={renamingBusy}
                    >
                      Anuluj
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="library-panel__open"
                    onClick={() => handleOpen(book)}
                    disabled={openingId === book.id}
                  >
                    <span className="library-panel__name">{book.name}</span>
                    <span className="library-panel__meta">
                      {book.format.toUpperCase()}
                      {book.readingSeconds > 0
                        ? ` · ${formatReadingTime(book.readingSeconds)}`
                        : ''}
                      {showPct ? ` · ${pct}%` : ''}
                    </span>
                    {showPct && (
                      <span
                        className="library-panel__bar"
                        aria-hidden="true"
                      >
                        <span
                          className="library-panel__bar-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    )}
                  </button>
                )}
              </div>
              {!renaming && (
                <div className="library-panel__actions">
                  <button
                    type="button"
                    className="library-panel__rename-btn"
                    onClick={() => startRename(book)}
                    aria-label={`Zmień nazwę: ${book.name}`}
                    title="Zmień nazwę"
                  >
                    ✎
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
                </div>
              )}
            </li>
          )
        })}
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
