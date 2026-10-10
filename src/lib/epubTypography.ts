const KEY = 'english-reader:epub-typography-v1'

export type EpubTypography = {
  /** Multiplier on base font (1 = default ~1.15em). Range ~0.85–1.6 */
  fontScale: number
  /** Horizontal padding in em */
  marginX: number
  /** Vertical padding in em */
  marginY: number
}

export const EPUB_TYPOGRAPHY_DEFAULTS: EpubTypography = {
  fontScale: 1,
  marginX: 1.25,
  marginY: 0.5,
}

export const EPUB_TYPOGRAPHY_LIMITS = {
  fontScale: { min: 0.85, max: 1.6, step: 0.05 },
  marginX: { min: 0.4, max: 3, step: 0.1 },
  marginY: { min: 0.2, max: 2, step: 0.1 },
} as const

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function loadEpubTypography(): EpubTypography {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...EPUB_TYPOGRAPHY_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<EpubTypography>
    return {
      fontScale: clamp(
        Number(parsed.fontScale) || EPUB_TYPOGRAPHY_DEFAULTS.fontScale,
        EPUB_TYPOGRAPHY_LIMITS.fontScale.min,
        EPUB_TYPOGRAPHY_LIMITS.fontScale.max,
      ),
      marginX: clamp(
        Number(parsed.marginX) || EPUB_TYPOGRAPHY_DEFAULTS.marginX,
        EPUB_TYPOGRAPHY_LIMITS.marginX.min,
        EPUB_TYPOGRAPHY_LIMITS.marginX.max,
      ),
      marginY: clamp(
        Number(parsed.marginY) || EPUB_TYPOGRAPHY_DEFAULTS.marginY,
        EPUB_TYPOGRAPHY_LIMITS.marginY.min,
        EPUB_TYPOGRAPHY_LIMITS.marginY.max,
      ),
    }
  } catch {
    return { ...EPUB_TYPOGRAPHY_DEFAULTS }
  }
}

export function saveEpubTypography(value: EpubTypography) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}
