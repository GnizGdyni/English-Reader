export type BookFormat = 'epub' | 'pdf' | 'txt'

export type LoadedBook = {
  name: string
  format: BookFormat
  url: string
  file: File
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
