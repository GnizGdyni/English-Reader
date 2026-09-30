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
  /** Accumulated reading time for this cloud book (seconds). */
  readingSeconds: number
  totalPages?: number
  /** 0–100, based on page / EPUB percentage. */
  progressPercent: number
  createdAt: string
}

export type ReadingProgress = {
  page: number
  cfi?: string
}

export type TranslationExample = {
  en: string
  /** Polish translation of the example; may be missing if lookup failed. */
  pl?: string | null
}

/** Viewport rect used to place translation popups near the text. */
export type LookupAnchor = {
  top: number
  left: number
  width: number
  height: number
}

export type TranslationResult = {
  /** Word as clicked in the text (e.g. feet). */
  term: string
  /** Dictionary headword to display (e.g. foot). Falls back to term. */
  headword?: string
  translation: string
  /** Short Polish note (form / sense), when available. */
  explanation?: string
  /** One picked example from local dict + optional PL. */
  example?: TranslationExample
  /** English sentence / phrase used for sense (internal / flashcards). */
  context?: string
  /** Polish translation of that context. */
  contextTranslation?: string
}

export type TranslationState =
  | { status: 'idle' }
  | { status: 'loading'; term: string; anchor?: LookupAnchor }
  | { status: 'ready'; result: TranslationResult; anchor?: LookupAnchor }
  | {
      status: 'error'
      term: string
      message: string
      anchor?: LookupAnchor
    }

/** Word saved for flashcard practice (persisted in localStorage). */
export type StudyCard = {
  id: string
  term: string
  translation: string
  context?: string
  explanation?: string
  addedAt: number
}
