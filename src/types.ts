export type BookFormat = 'epub' | 'pdf' | 'txt'

export type LoadedBook = {
  name: string
  format: BookFormat
  url: string
  file: File
  /** Supabase book id — sync postępu w chmurze */
  cloudId?: string
  initialPage?: number
  initialCfi?: string
}

export type SavedBook = {
  id: string
  name: string
  format: BookFormat
  page: number
  progressCfi?: string
  createdAt: string
}

export type ReadingProgress = {
  page: number
  cfi?: string
}

export type TranslationResult = {
  term: string
  translation: string
  explanation?: string
  similar?: string[]
  /** English sentence / phrase used for sense. */
  context?: string
  /** Polish translation of that context. */
  contextTranslation?: string
}

export type TranslationState =
  | { status: 'idle' }
  | { status: 'loading'; term: string }
  | { status: 'ready'; result: TranslationResult }
  | { status: 'error'; term: string; message: string }

/** Word saved for flashcard practice (persisted in localStorage). */
export type StudyCard = {
  id: string
  term: string
  translation: string
  context?: string
  explanation?: string
  addedAt: number
}
