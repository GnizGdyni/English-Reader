import type { BookFormat } from '../types'

export function detectFormat(file: File): BookFormat | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.epub') || file.type === 'application/epub+zip') {
    return 'epub'
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return 'pdf'
  }
  if (
    name.endsWith('.txt') ||
    file.type === 'text/plain' ||
    file.type.startsWith('text/')
  ) {
    return 'txt'
  }
  return null
}

export const ACCEPT_ATTR = '.epub,.pdf,.txt,application/epub+zip,application/pdf,text/plain'
