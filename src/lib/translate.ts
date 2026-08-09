import type { TranslationResult } from '../types'

const cache = new Map<string, TranslationResult>()

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

type DictSense = {
  pos: string
  definition: string
  example?: string
  synonyms: string[]
}

type DictionaryEntry = {
  meanings?: Array<{
    partOfSpeech?: string
    synonyms?: string[]
    definitions?: Array<{
      definition?: string
      example?: string
      synonyms?: string[]
    }>
  }>
}

async function fetchMyMemory(text: string): Promise<string | null> {
  const q = text.trim()
  if (!q) return null
  const clipped = q.length > 450 ? `${q.slice(0, 450)}…` : q
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clipped)}&langpair=en|pl`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = (await res.json()) as {
    responseData?: { translatedText?: string }
    responseStatus?: number
  }
  const translated = data.responseData?.translatedText?.trim()
  if (!translated) return null
  if (
    data.responseStatus &&
    data.responseStatus !== 200 &&
    translated.toLowerCase() === q.toLowerCase()
  ) {
    return null
  }
  return translated.replace(/\s+/g, ' ').trim()
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
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

/** Guess part of speech from how the term sits in the sentence. */
function guessPos(term: string, context?: string): string | null {
  if (!context) return null
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const before = new RegExp(
    `\\b(the|a|an|my|your|his|her|its|our|their|this|that|these|those)\\s+${escaped}\\b`,
    'i',
  )
  if (before.test(context)) return 'noun'

  const verb = new RegExp(
    `\\b(to|will|would|can|could|should|must|may|might|don't|doesn't|didn't|won't|can't|let's)\\s+${escaped}\\b`,
    'i',
  )
  if (verb.test(context)) return 'verb'

  const afterBe = new RegExp(
    `\\b(is|are|was|were|be|been|being|seem|seems|look|looks|feel|feels|become|became)\\s+${escaped}\\b`,
    'i',
  )
  if (afterBe.test(context)) return 'adjective'

  const afterAdv = new RegExp(`\\b${escaped}\\s+(the|a|an|my|his|her)\\b`, 'i')
  if (afterAdv.test(context)) return 'verb'

  return null
}

function flattenSenses(entries: DictionaryEntry[]): DictSense[] {
  const senses: DictSense[] = []
  for (const entry of entries) {
    for (const meaning of entry.meanings ?? []) {
      const pos = meaning.partOfSpeech ?? ''
      const meaningSyn = meaning.synonyms ?? []
      for (const def of meaning.definitions ?? []) {
        if (!def.definition) continue
        senses.push({
          pos,
          definition: def.definition,
          example: def.example,
          synonyms: [...meaningSyn, ...(def.synonyms ?? [])].filter(Boolean),
        })
      }
    }
  }
  return senses
}

function scoreSense(
  sense: DictSense,
  contextTokens: Set<string>,
  preferredPos: string | null,
): number {
  let score = 0
  if (preferredPos && sense.pos === preferredPos) score += 8
  if (preferredPos && sense.pos && sense.pos !== preferredPos) score -= 2

  const bag = tokenize(
    `${sense.definition} ${sense.example ?? ''} ${sense.synonyms.join(' ')}`,
  )
  for (const w of bag) {
    if (contextTokens.has(w)) score += 3
  }
  // Prefer shorter, concrete definitions slightly
  if (sense.definition.length < 80) score += 1
  if (sense.example) score += 1
  return score
}

function pickBestSense(
  senses: DictSense[],
  term: string,
  context?: string,
): DictSense | null {
  if (!senses.length) return null
  const preferredPos = guessPos(term, context)
  const contextTokens = new Set(
    tokenize(context ?? '').filter((w) => w !== term.toLowerCase()),
  )

  let best = senses[0]!
  let bestScore = Number.NEGATIVE_INFINITY
  for (const sense of senses) {
    const s = scoreSense(sense, contextTokens, preferredPos)
    if (s > bestScore) {
      bestScore = s
      best = sense
    }
  }
  return best
}

async function fetchDictionarySenses(term: string): Promise<DictSense[]> {
  if (/\s/.test(term) || term.length < 2) return []
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`
  const res = await fetch(url)
  if (!res.ok) return []
  const entries = (await res.json()) as DictionaryEntry[]
  return flattenSenses(entries)
}

type DatamuseWord = { word: string; score?: number; tags?: string[] }

/** Context-aware related / similar English words (Datamuse). */
async function fetchSimilarEn(
  term: string,
  context?: string,
  senseSynonyms: string[] = [],
): Promise<string[]> {
  const topics = tokenize(context ?? '')
    .filter((w) => w !== term.toLowerCase())
    .slice(0, 4)
    .join('+')

  const urls = [
    topics
      ? `https://api.datamuse.com/words?ml=${encodeURIComponent(term)}&topics=${encodeURIComponent(topics)}&max=10`
      : `https://api.datamuse.com/words?ml=${encodeURIComponent(term)}&max=10`,
    topics
      ? `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(term)}&topics=${encodeURIComponent(topics)}&max=8`
      : `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(term)}&max=8`,
  ]

  const lists = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url)
        if (!res.ok) return [] as string[]
        const data = (await res.json()) as DatamuseWord[]
        return data.map((d) => d.word).filter(Boolean)
      } catch {
        return [] as string[]
      }
    }),
  )

  const merged = [...senseSynonyms, ...lists.flat()]
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of merged) {
    const key = w.toLowerCase()
    if (key === term.toLowerCase() || seen.has(key) || key.includes(' ')) continue
    seen.add(key)
    out.push(w)
    if (out.length >= 6) break
  }
  return out
}

/**
 * Build a short query that steers MyMemory toward the right sense
 * (e.g. "to bank" vs "a bank") while still returning a short gloss.
 */
function senseHintQuery(term: string, pos: string | null, context?: string): string {
  if (/\s/.test(term)) return term
  const guessed = pos || guessPos(term, context)
  if (guessed === 'verb') return `to ${term}`
  if (guessed === 'noun') return `the ${term}`
  if (guessed === 'adjective' || guessed === 'adverb') return `very ${term}`
  return term
}

/** Translate a list of English words to Polish (one API call when possible). */
async function translateWordList(words: string[]): Promise<string[]> {
  if (!words.length) return []
  const joined = words.join(', ')
  const pl = await fetchMyMemory(joined)
  if (!pl) return words

  const parts = pl.split(/[,;]/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= Math.ceil(words.length * 0.6)) {
    return words.map((en, i) => {
      const gloss = parts[i] ? asTermGloss(en, parts[i]!) : en
      return `${en} — ${gloss}`
    })
  }

  // Fallback: keep English if split failed
  return words
}

/**
 * Contextual EN→PL lookup:
 * 1) pick dictionary sense from sentence / POS
 * 2) short Polish gloss (POS-hinted)
 * 3) similar words from that sense + Datamuse topics
 * 4) full sentence under context
 */
export async function translate(
  term: string,
  context?: string,
): Promise<TranslationResult> {
  const sentence = context?.replace(/\s+/g, ' ').trim() || undefined
  const hasSentence =
    !!sentence && sentence.toLowerCase() !== term.toLowerCase()

  const cacheKey = `v3::${term.toLowerCase()}::${(sentence ?? '').toLowerCase()}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const senses = await fetchDictionarySenses(term)
  const best = pickBestSense(senses, term, sentence)
  const pos = best?.pos || guessPos(term, sentence)
  const hintQuery = senseHintQuery(term, pos, sentence)

  const similarEnPromise = fetchSimilarEn(term, sentence, best?.synonyms ?? [])

  const [hintPl, barePl, sentencePl, defPl, similarEn] = await Promise.all([
    fetchMyMemory(hintQuery),
    hintQuery === term ? Promise.resolve(null) : fetchMyMemory(term),
    hasSentence ? fetchMyMemory(sentence!) : Promise.resolve(null),
    best?.definition
      ? fetchMyMemory(best.definition.slice(0, 180))
      : Promise.resolve(null),
    similarEnPromise,
  ])

  const rawGloss = hintPl || barePl
  if (!rawGloss) {
    throw new Error('Nie udało się przetłumaczyć. Spróbuj ponownie.')
  }

  // Strip leading "to/the/very" artifacts if the API echoed the hint
  let gloss = asTermGloss(term, rawGloss)
  gloss = gloss.replace(/^(do|the|a|an|bardzo|to)\s+/i, '').trim() || gloss

  const similarPl = await translateWordList(similarEn)

  const explanationParts: string[] = []
  if (pos) explanationParts.push(`(${pos})`)
  if (defPl) explanationParts.push(defPl)
  else if (best?.definition) explanationParts.push(best.definition)

  const result: TranslationResult = {
    term,
    translation: gloss,
    explanation: explanationParts.length
      ? explanationParts.join(' ')
      : undefined,
    similar: similarPl.length ? similarPl : undefined,
  }

  if (hasSentence) {
    result.context = sentence
    if (sentencePl) result.contextTranslation = sentencePl
  }

  cache.set(cacheKey, result)
  return result
}

export function clearTranslationCache() {
  cache.clear()
}
