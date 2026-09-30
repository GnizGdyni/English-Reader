import { detectFormat } from './bookFormat'
import {
  BOOKS_BUCKET,
  getSupabase,
  isSupabaseConfigured,
  MAX_SAVED_BOOKS,
} from './supabase'
import type { BookFormat, LoadedBook, SavedBook, StudyCard } from '../types'

type BookRow = {
  id: string
  user_id: string
  name: string
  format: BookFormat
  storage_path: string
  page: number
  progress_cfi: string | null
  reading_seconds?: number | null
  total_pages?: number | null
  progress_percent?: number | null
  created_at: string
}

type CardRow = {
  id: string
  user_id: string
  client_id: string
  term: string
  translation: string
  context: string | null
  explanation: string | null
  added_at: number
}

function rowToSavedBook(row: BookRow): SavedBook {
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    page: row.page,
    progressCfi: row.progress_cfi ?? undefined,
    readingSeconds: Math.max(0, row.reading_seconds ?? 0),
    totalPages: row.total_pages ?? undefined,
    progressPercent: Math.min(100, Math.max(0, row.progress_percent ?? 0)),
    createdAt: row.created_at,
  }
}

function rowToCard(row: CardRow): StudyCard {
  return {
    id: row.client_id,
    term: row.term,
    translation: row.translation,
    context: row.context ?? undefined,
    explanation: row.explanation ?? undefined,
    addedAt: row.added_at,
  }
}

export async function fetchSavedBooks(): Promise<SavedBook[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('user_books')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data as BookRow[]).map(rowToSavedBook)
}

export async function uploadBook(file: File): Promise<SavedBook> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase nie jest skonfigurowany.')

  const format = detectFormat(file)
  if (!format) throw new Error('Obsługiwane formaty: EPUB, PDF, TXT.')

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Musisz być zalogowany.')

  const existing = await fetchSavedBooks()
  if (existing.length >= MAX_SAVED_BOOKS) {
    throw new Error(`Możesz zapisać max ${MAX_SAVED_BOOKS} książki. Usuń jedną, by dodać nową.`)
  }

  const bookId = crypto.randomUUID()
  const storagePath = `${userData.user.id}/${bookId}/${file.name}`

  const { error: uploadError } = await supabase.storage
    .from(BOOKS_BUCKET)
    .upload(storagePath, file, { upsert: false })

  if (uploadError) throw new Error(uploadError.message)

  const { data, error } = await supabase
    .from('user_books')
    .insert({
      id: bookId,
      user_id: userData.user.id,
      name: file.name,
      format,
      storage_path: storagePath,
      page: 1,
    })
    .select('*')
    .single()

  if (error) {
    await supabase.storage.from(BOOKS_BUCKET).remove([storagePath])
    throw new Error(error.message)
  }

  return rowToSavedBook(data as BookRow)
}

export async function deleteSavedBook(bookId: string): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  const { data: row, error: fetchError } = await supabase
    .from('user_books')
    .select('storage_path')
    .eq('id', bookId)
    .single()

  if (fetchError || !row) throw new Error(fetchError?.message ?? 'Nie znaleziono książki.')

  const storagePath = (row as { storage_path: string }).storage_path

  const { error: dbError } = await supabase.from('user_books').delete().eq('id', bookId)
  if (dbError) throw new Error(dbError.message)

  await supabase.storage.from(BOOKS_BUCKET).remove([storagePath])
}

export async function openSavedBook(saved: SavedBook): Promise<LoadedBook> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase nie jest skonfigurowany.')

  const { data: row, error } = await supabase
    .from('user_books')
    .select('storage_path')
    .eq('id', saved.id)
    .single()

  if (error || !row) throw new Error('Nie znaleziono książki.')

  const { data: blob, error: downloadError } = await supabase.storage
    .from(BOOKS_BUCKET)
    .download((row as { storage_path: string }).storage_path)

  if (downloadError || !blob) throw new Error(downloadError?.message ?? 'Błąd pobierania pliku.')

  const file = new File([blob], saved.name, { type: blob.type || 'application/octet-stream' })
  const url = URL.createObjectURL(file)

  return {
    name: saved.name,
    format: saved.format,
    url,
    file,
    cloudId: saved.id,
    initialPage: saved.page,
    initialCfi: saved.progressCfi,
  }
}

export async function renameSavedBook(
  bookId: string,
  name: string,
): Promise<SavedBook> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase nie jest skonfigurowany.')

  const trimmed = name.replace(/\s+/g, ' ').trim()
  if (!trimmed) throw new Error('Nazwa nie może być pusta.')
  if (trimmed.length > 120) throw new Error('Nazwa jest za długa (max 120 znaków).')

  const { data, error } = await supabase
    .from('user_books')
    .update({ name: trimmed })
    .eq('id', bookId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return rowToSavedBook(data as BookRow)
}

export async function saveReadingProgress(
  cloudId: string,
  page: number,
  progressCfi?: string,
  extras?: { totalPages?: number; progressPercent?: number },
): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  const payload: {
    page: number
    progress_cfi?: string | null
    total_pages?: number
    progress_percent?: number
  } = { page }
  if (progressCfi !== undefined) {
    payload.progress_cfi = progressCfi || null
  }
  if (extras?.totalPages != null && extras.totalPages > 0) {
    payload.total_pages = extras.totalPages
  }
  if (extras?.progressPercent != null) {
    payload.progress_percent = Math.min(
      100,
      Math.max(0, Math.round(extras.progressPercent)),
    )
  }

  const { error } = await supabase.from('user_books').update(payload).eq('id', cloudId)
  if (error) console.warn('saveReadingProgress:', error.message)
}

/** Add seconds to cloud book reading timer (own books only). */
export async function addReadingTime(
  cloudId: string,
  seconds: number,
): Promise<void> {
  const supabase = getSupabase()
  if (!supabase || seconds <= 0) return

  const { error } = await supabase.rpc('increment_book_reading_time', {
    p_book_id: cloudId,
    p_seconds: Math.floor(seconds),
  })
  if (error) console.warn('addReadingTime:', error.message)
}

export async function fetchStudyCardsFromCloud(): Promise<StudyCard[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('study_cards')
    .select('*')
    .order('added_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data as CardRow[]).map(rowToCard)
}

export async function syncStudyCardsToCloud(cards: StudyCard[]): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return

  const userId = userData.user.id

  const { error: deleteError } = await supabase
    .from('study_cards')
    .delete()
    .eq('user_id', userId)

  if (deleteError) throw new Error(deleteError.message)

  if (cards.length === 0) return

  const rows = cards.map((c) => ({
    user_id: userId,
    client_id: c.id,
    term: c.term,
    translation: c.translation,
    context: c.context ?? null,
    explanation: c.explanation ?? null,
    added_at: c.addedAt,
  }))

  const { error: insertError } = await supabase.from('study_cards').insert(rows)
  if (insertError) throw new Error(insertError.message)
}

export function canUseCloud(): boolean {
  return isSupabaseConfigured()
}
