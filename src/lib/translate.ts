import type { TranslationResult } from '../types'
import {
  lookupLocalDict,
  rankLocalDictByPos,
  type LocalDictDebug,
  type LocalDictEntry,
} from './localDict'

const CACHE_KEY = 'english-reader:translate-v13'
const CACHE_MAX = 400

const cache = new Map<string, TranslationResult>()
const inflight = new Map<string, Promise<TranslationResult>>()

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

function pickGloss(
  term: string,
  directPl: string | null,
  dict: LocalDictDebug,
): string {
  const direct = directPl ? cleanGloss(term, directPl) : ''
  if (direct && isAcceptableGloss(term, direct)) return direct

  // Fallback: first Polish gloss from preferred / any local entry
  const entries = dict.ok ? (dict.entries ?? []) : []
  const ordered = [
    ...entries.filter((e) => e.preferred),
    ...entries.filter((e) => !e.preferred),
  ]
  for (const e of ordered) {
    for (const pl of e.translations_pl) {
      const cleaned = cleanGloss(term, pl)
      if (cleaned && isAcceptableGloss(term, cleaned)) return cleaned
    }
  }

  throw new Error('Nie udało się przetłumaczyć. Spróbuj ponownie.')
}

function describeFormTags(tags: string | null): string | null {
  if (!tags) return null
  const t = tags.toLowerCase()
  if (/\bplural\b/.test(t)) return 'liczbą mnogą'
  if (/\bcomparative\b/.test(t)) return 'stopniem wyższym'
  if (/\bsuperlative\b/.test(t)) return 'stopniem najwyższym'
  if (/\bpast\b/.test(t) && /\bparticiple\b/.test(t)) return 'imiesłowem biernym'
  if (/\bpresent\b/.test(t) && /\bparticiple\b/.test(t)) return 'formą -ing'
  if (/\bthird-person\b/.test(t) || /\bthird person\b/.test(t)) {
    return 'formą 3. os. liczby pojedynczej'
  }
  if (/\bpast\b/.test(t)) return 'formą czasu przeszłego'
  return null
}

function buildFormExplanation(dict: LocalDictDebug): string | null {
  const via = dict.viaForm
  if (!via) return null
  const form = via.form.trim()
  const lemma = via.lemma.trim()
  if (!form || !lemma) return null
  if (form.toLowerCase() === lemma.toLowerCase()) return null

  const kind = describeFormTags(via.tags) ?? 'formą'
  return `Forma „${form}” to ${kind} od „${lemma}”.`
}

function shortGlossClause(gloss: string | null | undefined): string | null {
  if (!gloss) return null
  const first = gloss
    .split('|')[0]
    ?.split(/[.;]/)[0]
    ?.replace(/\s+/g, ' ')
    .trim()
  if (!first) return null
  if (first.length < 18 || first.length > 140) return null
  // Skip archaic / noisy scraps
  if (/[ſſ]|\[\.\.\.\]|^\W/.test(first)) return null
  return first
}

function contextTokens(context: string | undefined, term: string): Set<string> {
  const key = term.toLowerCase()
  const out = new Set<string>()
  if (!context) return out
  for (const w of context.toLowerCase().match(/[\p{L}']+/gu) ?? []) {
    if (w.length > 2 && w !== key) out.add(w)
  }
  return out
}

function isUsableExample(ex: string): boolean {
  const t = ex.replace(/\s+/g, ' ').trim()
  if (t.length < 12 || t.length > 160) return false
  if (/[ſ]|\[\.\.\.\]|^\W/.test(t)) return false
  if ((t.match(/\s+/g) ?? []).length < 2) return false
  return true
}

/**
 * Pick one example: prefer preferred POS entries, then overlap with reading
 * context, then presence of the looked-up form / lemma.
 */
function pickExample(
  dict: LocalDictDebug,
  term: string,
  context: string | undefined,
): string | null {
  if (!dict.ok || !dict.entries?.length) return null

  const lemma = (dict.lemma ?? term).toLowerCase()
  const form = term.toLowerCase()
  const ctx = contextTokens(context, term)
  const seen = new Set<string>()
  const candidates: Array<{ ex: string; score: number }> = []

  const consider = (entry: LocalDictEntry, boost: number) => {
    for (const raw of entry.examples) {
      if (!isUsableExample(raw)) continue
      const ex = raw.replace(/\s+/g, ' ').trim()
      const key = ex.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      let score = boost
      const lower = key
      if (new RegExp(`\\b${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
        score += 8
      } else if (
        new RegExp(`\\b${lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(
          lower,
        )
      ) {
        score += 5
      }

      for (const w of lower.match(/[\p{L}']+/gu) ?? []) {
        if (ctx.has(w)) score += 2
      }

      // Prefer mid-length readable examples
      const len = ex.length
      if (len >= 35 && len <= 110) score += 2

      candidates.push({ ex, score })
    }
  }

  for (const e of dict.entries) {
    consider(e, e.preferred ? 10 : 0)
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score || a.ex.length - b.ex.length)
  return candidates[0]!.ex
}

function primaryEntry(dict: LocalDictDebug): LocalDictEntry | null {
  if (!dict.ok || !dict.entries?.length) return null
  return dict.entries.find((e) => e.preferred) ?? dict.entries[0] ?? null
}

/**
 * Contextual EN→PL word lookup powered by Google + local Kaikki SQLite.
 * Local dict never breaks the main gloss; example/explanation are optional.
 */
export async function translate(
  term: string,
  context?: string,
): Promise<TranslationResult> {
  const sentence = context?.replace(/\s+/g, ' ').trim() || undefined
  const hasSentence =
    !!sentence && sentence.toLowerCase() !== term.toLowerCase()

  const cacheKey = `v13::${term.toLowerCase()}::${(sentence ?? '').toLowerCase()}`
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

  const localDictPromise = lookupLocalDict(term).catch(
    (): LocalDictDebug => ({
      ok: false,
      query: term,
      reason: 'client_error',
    }),
  )

  const [directPl, localDictRaw] = await Promise.all([
    fetchTranslation(hintQuery),
    localDictPromise,
  ])

  const guessedPos = hasSentence && sentence ? guessPos(term, sentence) : null
  const dict = rankLocalDictByPos(localDictRaw, guessedPos)

  const translation = pickGloss(term, directPl, dict)
  const headword =
    dict.ok && dict.lemma && dict.lemma.toLowerCase() !== term.toLowerCase()
      ? dict.lemma
      : term

  const formNote = dict.ok ? buildFormExplanation(dict) : null
  const entry = primaryEntry(dict)
  const glossClause = shortGlossClause(entry?.gloss)

  const exampleEn = pickExample(
    dict,
    term,
    hasSentence ? sentence : undefined,
  )

  // Optional extras — never fail the whole lookup
  const [examplePl, glossPl] = await Promise.all([
    exampleEn
      ? fetchTranslation(exampleEn).catch(() => null)
      : Promise.resolve(null),
    glossClause
      ? fetchTranslation(glossClause).catch(() => null)
      : Promise.resolve(null),
  ])

  const explanationParts: string[] = []
  if (formNote) explanationParts.push(formNote)
  if (glossPl) {
    const cleaned = glossPl.replace(/\s+/g, ' ').trim()
    if (
      cleaned &&
      cleaned.length >= 12 &&
      cleaned.length <= 180 &&
      cleaned.toLowerCase() !== translation.toLowerCase()
    ) {
      explanationParts.push(cleaned)
    }
  }
  const explanation =
    explanationParts.length > 0 ? explanationParts.join(' ') : undefined

  const result: TranslationResult = {
    term,
    headword: headword !== term ? headword : undefined,
    translation,
    explanation,
  }

  if (exampleEn) {
    result.example = {
      en: exampleEn,
      pl:
        examplePl &&
        examplePl.toLowerCase() !== exampleEn.toLowerCase() &&
        !/mymemory|quota|warning/i.test(examplePl)
          ? examplePl
          : null,
    }
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
