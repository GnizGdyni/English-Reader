import type { Book } from 'epubjs'

/** Chars per location — epub.js default is 150; 1024 is a common balance. */
const CHARS_PER_LOCATION = 1024
const CACHE_PREFIX = 'english-reader:epub-locations:v1:'

export type EpubProgress = {
  /** 1-based location index for UI. */
  page: number
  /** Total locations (stable across font size). */
  totalPages: number
  /** 0–100. */
  percent: number
  locationIndex: number
}

function cacheKey(book: Book): string {
  try {
    const key = typeof book.key === 'function' ? book.key() : ''
    return `${CACHE_PREFIX}${key || 'unknown'}`
  } catch {
    return `${CACHE_PREFIX}unknown`
  }
}

/** Load cached location CFIs or generate and persist them. */
export async function ensureEpubLocations(book: Book): Promise<number> {
  const locs = book.locations
  if (locs.length() > 0) return locs.length()

  const key = cacheKey(book)
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      locs.load(stored)
      if (locs.length() > 0) return locs.length()
    }
  } catch {
    /* ignore corrupt cache */
  }

  await locs.generate(CHARS_PER_LOCATION)
  try {
    localStorage.setItem(key, locs.save())
  } catch {
    /* quota */
  }
  return locs.length()
}

/**
 * Progress from CFI using the locations index.
 * Avoids epub.js `percentageFromLocation` quirk (`!loc` treats 0 as empty).
 */
export function epubProgressFromCfi(
  book: Book,
  cfi: string | undefined | null,
): EpubProgress | null {
  const locs = book.locations
  const totalSlots = locs.length()
  if (!totalSlots) return null

  // epub.js sets locations.total = length - 1 (last index)
  const lastIndex = Math.max(0, totalSlots - 1)
  let loc = 0
  if (cfi) {
    try {
      // Runtime returns number; typings incorrectly say Location
      const found = locs.locationFromCfi(cfi) as unknown as number
      if (typeof found === 'number' && Number.isFinite(found) && found >= 0) {
        loc = found
      }
    } catch {
      loc = 0
    }
  }
  loc = Math.min(lastIndex, Math.max(0, loc))

  const percent =
    lastIndex <= 0
      ? 100
      : Math.min(100, Math.max(0, Math.round((loc / lastIndex) * 100)))

  return {
    page: loc + 1,
    totalPages: lastIndex + 1,
    percent,
    locationIndex: loc,
  }
}
