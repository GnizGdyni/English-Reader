import type { TranslationResult } from '../types'

const CACHE_KEY = 'english-reader:translate-v8'
const CACHE_MAX = 400

const cache = new Map<string, TranslationResult>()
const inflight = new Map<string, Promise<TranslationResult>>()

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'in', 'on', 'at', 'to', 'for',
  'of', 'as', 'by', 'with', 'from', 'into', 'about', 'than', 'then', 'that',
  'this', 'these', 'those', 'it', 'its', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'can', 'not', 'no', 'nor', 'so',
  'he', 'she', 'they', 'we', 'you', 'i', 'me', 'him', 'her', 'them', 'my',
  'your', 'his', 'their', 'our', 'what', 'which', 'who', 'whom', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very',
  'just', 'also', 'there', 'here', 'up', 'out', 'over', 'after', 'before',
])

function loadPersistentCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const entries = JSON.parse(raw) as Array<[string, TranslationResult]>
    for (const [key, value] of entries.slice(-CACHE_MAX)) {
      cache.set(key, value)
    }
  } catch {
    /* ignore */
  }
}

function savePersistentCache() {
  try {
    const entries = [...cache.entries()].slice(-CACHE_MAX)
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries))
  } catch {
    /* ignore */
  }
}

loadPersistentCache()

async function fetchMyMemory(text: string): Promise<string | null> {
  const q = text.trim()
  if (!q) return null
  const clipped = q.length > 450 ? `${q.slice(0, 450)}…` : q
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clipped)}&langpair=en|pl`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) })
    if (res.status === 429) return null
    if (!res.ok) return null
    const data = (await res.json()) as {
      responseData?: { translatedText?: string }
      responseStatus?: number
    }
    const translated = data.responseData?.translatedText?.trim()
    if (!translated) return null
    if (/MYMEMORY WARNING|QUOTA|AVAILABLE FREE/i.test(translated)) return null
    if (data.responseStatus === 429) return null
    if (
      data.responseStatus &&
      data.responseStatus !== 200 &&
      translated.toLowerCase() === q.toLowerCase()
    ) {
      return null
    }
    return translated.replace(/\s+/g, ' ').trim()
  } catch {
    return null
  }
}

async function fetchGoogleGtx(text: string): Promise<string | null> {
  const q = text.trim()
  if (!q) return null
  const clipped = q.length > 450 ? q.slice(0, 450) : q
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pl&dt=t&q=` +
    encodeURIComponent(clipped)

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) })
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null
    const parts: string[] = []
    for (const chunk of data[0] as unknown[]) {
      if (Array.isArray(chunk) && typeof chunk[0] === 'string') {
        parts.push(chunk[0])
      }
    }
    const joined = parts.join('').replace(/\s+/g, ' ').trim()
    return joined || null
  } catch {
    return null
  }
}

async function fetchTranslation(text: string): Promise<string | null> {
  const primary = await fetchGoogleGtx(text)
  if (primary) return primary
  return fetchMyMemory(text)
}

/** Synonyms / related words via Datamuse (usually very fast). */
async function fetchSimilarEn(
  term: string,
  context?: string,
): Promise<string[]> {
  if (/\s/.test(term) || term.length < 2) return []

  const topics = (context ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && w !== term.toLowerCase())
    .slice(0, 4)
    .join('+')

  const url = topics
    ? `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(term)}&topics=${encodeURIComponent(topics)}&max=8`
    : `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(term)}&max=8`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return []
    const data = (await res.json()) as Array<{ word?: string }>
    const seen = new Set<string>()
    const out: string[] = []
    for (const row of data) {
      const w = row.word?.trim()
      if (!w) continue
      const key = w.toLowerCase()
      if (key === term.toLowerCase() || seen.has(key) || key.includes(' ')) continue
      seen.add(key)
      out.push(w)
      if (out.length >= 5) break
    }
    return out
  } catch {
    return []
  }
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function asTermGloss(term: string, translated: string): string {
  const termWords = wordCount(term)
  const glossWords = wordCount(translated)
  if (termWords > 1) return translated
  if (glossWords <= Math.max(2, termWords + 1)) return translated
  const first = translated.split(/[,;/|]/)[0]?.trim()
  if (first && wordCount(first) <= 3) return first
  return translated.split(/\s+/).slice(0, 2).join(' ')
}

function cleanGloss(term: string, raw: string): string {
  let gloss = asTermGloss(term, raw.replace(/\s+/g, ' ').trim())
  gloss = gloss
    .replace(
      /^(do|the|a|an|bardzo|to|na|w|z|ze|dla|o|po|od|przez|przy|jak|że)\s+/i,
      '',
    )
    .trim()
  gloss = gloss.replace(/\s*(QUOTA|MYMEMORY|WARNING).*$/i, '').trim()
  return gloss
}

function isAcceptableGloss(term: string, gloss: string): boolean {
  const g = gloss.toLowerCase().trim()
  const t = term.toLowerCase().trim()
  if (!g) return false
  if (g === t) return false
  if (g.replace(/[^\p{L}]/gu, '') === t.replace(/[^\p{L}]/gu, '')) return false
  if (/mymemory|quota|warning|available free/i.test(gloss)) return false
  return true
}

function guessPos(term: string, context?: string): string | null {
  if (!context) return null
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const ctx = context

  if (
    new RegExp(
      `\\b(the|a|an|my|your|his|her|its|our|their|this|that|these|those|some|any|every|each|no|another|such)\\s+${escaped}\\b`,
      'i',
    ).test(ctx)
  ) {
    return 'noun'
  }

  if (
    new RegExp(
      `\\b(to|will|would|can|could|should|must|may|might|shall|let's|don't|doesn't|didn't|won't|can't|always|never|often|sometimes|just|still|also)\\s+${escaped}\\b`,
      'i',
    ).test(ctx)
  ) {
    return 'verb'
  }

  if (
    new RegExp(
      `\\b(is|are|was|were|be|been|being|seem|seems|look|looks|feel|feels|become|became|grow|grows|turn|turns|stay|stays|remain|remains|sound|sounds|taste|tastes|smell|smells)\\s+${escaped}\\b`,
      'i',
    ).test(ctx)
  ) {
    return 'adjective'
  }

  if (
    new RegExp(
      `\\b${escaped}\\s+(the|a|an|my|your|his|her|their|its|this|that|each|every|all|both|these|those)\\b`,
      'i',
    ).test(ctx)
  ) {
    return 'adverb'
  }

  if (
    new RegExp(
      `\\b(come|go|run|walk|move|drive|fly|sail|travel|head|pass|rush|speed|look|gaze|stare)\\s+${escaped}\\b`,
      'i',
    ).test(ctx)
  ) {
    return 'adverb'
  }

  return null
}

function senseHintQuery(term: string, context?: string): string {
  if (/\s/.test(term)) return term
  const guessed = guessPos(term, context)
  if (guessed === 'verb') return `to ${term}`
  if (guessed === 'noun') return `the ${term}`
  if (guessed === 'adjective') return `very ${term}`
  return term
}

function pickGloss(term: string, directPl: string | null): string {
  const direct = directPl ? cleanGloss(term, directPl) : ''
  if (!direct || !isAcceptableGloss(term, direct)) {
    throw new Error('Nie udało się przetłumaczyć. Spróbuj ponownie.')
  }
  return direct
}

/**
 * Fast lookup:
 * 1) Google (term) — Polish gloss
 * 2) Datamuse — English synonyms (parallel, usually ~fast)
 * Sentence PL loads later via translateSentence().
 */
export async function translate(
  term: string,
  context?: string,
): Promise<TranslationResult> {
  const sentence = context?.replace(/\s+/g, ' ').trim() || undefined
  const hasSentence =
    !!sentence && sentence.toLowerCase() !== term.toLowerCase()

  const cacheKey = `v8::${term.toLowerCase()}::${(sentence ?? '').toLowerCase()}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const pending = inflight.get(cacheKey)
  if (pending) return pending

  const promise = translateInternal(term, sentence, hasSentence, cacheKey)
  inflight.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    inflight.delete(cacheKey)
  }
}

export async function translateSentence(
  sentence: string,
): Promise<string | null> {
  const trimmed = sentence.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  return fetchTranslation(trimmed)
}

async function translateInternal(
  term: string,
  sentence: string | undefined,
  hasSentence: boolean,
  cacheKey: string,
): Promise<TranslationResult> {
  const hintQuery = senseHintQuery(term, sentence)
  const pos = guessPos(term, sentence)

  const [directPl, similar] = await Promise.all([
    fetchTranslation(hintQuery),
    fetchSimilarEn(term, sentence),
  ])

  const result: TranslationResult = {
    term,
    translation: pickGloss(term, directPl),
    explanation: pos ? `(${pos})` : undefined,
    similar: similar.length ? similar : undefined,
  }

  if (hasSentence && sentence) {
    result.context = sentence
  }

  cache.set(cacheKey, result)
  savePersistentCache()
  return result
}

export function clearTranslationCache() {
  cache.clear()
  inflight.clear()
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}
