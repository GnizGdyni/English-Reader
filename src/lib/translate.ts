import { phraseAround } from './selection'
import type { TranslationResult } from '../types'

const CACHE_KEY = 'english-reader:translate-v5'
const CACHE_MAX = 400

const cache = new Map<string, TranslationResult>()
const inflight = new Map<string, Promise<TranslationResult>>()

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

type GlossCandidate = {
  gloss: string
  source: string
  score: number
}

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
    const res = await fetch(url)
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

/** Unofficial Google Translate endpoint — fallback when MyMemory quota is exhausted. */
async function fetchGoogleGtx(text: string): Promise<string | null> {
  const q = text.trim()
  if (!q) return null
  const clipped = q.length > 450 ? q.slice(0, 450) : q
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pl&dt=t&q=` +
    encodeURIComponent(clipped)

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    // Response shape: [[["pl text","en text",...],...], ...]
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
  const primary = await fetchMyMemory(text)
  if (primary) return primary
  return fetchGoogleGtx(text)
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

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

function normalizeToken(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\p{N}'-]+|[^\p{L}\p{N}'-]+$/gu, '')
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

function findTermBounds(
  sentence: string,
  term: string,
): { start: number; end: number } | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b${escaped}\\b`, 'i')
  const match = re.exec(sentence)
  if (match) {
    return { start: match.index, end: match.index + match[0].length }
  }
  const idx = sentence.toLowerCase().indexOf(term.toLowerCase())
  if (idx < 0) return null
  return { start: idx, end: idx + term.length }
}

/** Map EN term position → corresponding word(s) in PL translation. */
function extractGlossFromAlignment(
  term: string,
  enText: string,
  plText: string,
): string | null {
  const termWords = splitWords(term)
  const enWords = splitWords(enText)
  const plWords = splitWords(plText)
  if (!enWords.length || !plWords.length) return null

  const termNorm = termWords.map(normalizeToken).join(' ')
  let termIdx = -1
  for (let i = 0; i <= enWords.length - termWords.length; i++) {
    const chunk = enWords
      .slice(i, i + termWords.length)
      .map(normalizeToken)
      .join(' ')
    if (chunk === termNorm) {
      termIdx = i
      break
    }
  }
  if (termIdx < 0) return null

  const termLen = termWords.length
  const plStart = Math.min(
    plWords.length - termLen,
    Math.max(
      0,
      Math.round(
        (termIdx / Math.max(1, enWords.length - termLen)) *
          (plWords.length - termLen),
      ),
    ),
  )
  return plWords.slice(plStart, plStart + termLen).join(' ').trim() || null
}

/** Reject oblique-case fragments pulled from the wrong word in a PL sentence. */
function isLikelyMisalignedFragment(
  gloss: string,
  referenceGloss: string | null,
): boolean {
  const g = gloss.toLowerCase().trim()
  if (!g) return true

  if (/^(po|na|we|w|z|ze|do|u|o|przy|dla|od|przed|pod|nad|między|przez)\s+/i.test(gloss)) {
    return true
  }

  if (wordCount(gloss) === 1) {
    if (/[bcdfghjklmnprstvwz]ach$/i.test(g)) return true
    if (/[bcdfghjklmnprstvwz]ami$/i.test(g)) return true
    if (/[bcdfghjklmnprstvwz]om$/i.test(g) && g.length >= 6) return true
  }

  if (referenceGloss) {
    const ref = referenceGloss.toLowerCase().trim()
    if (!ref) return false
    if (g === ref) return false
    if (ref.includes(g) || g.includes(ref)) return false
    if (wordCount(gloss) === 1 && wordCount(referenceGloss) <= 2) {
      return true
    }
  }

  return false
}

function isValidAlignedGloss(
  term: string,
  aligned: string,
  referenceGloss: string | null,
): boolean {
  const gloss = cleanGloss(term, aligned)
  if (!gloss) return false
  if (isLikelyMisalignedFragment(gloss, referenceGloss)) return false
  return true
}

function scoreGlossCandidate(term: string, gloss: string, source: string): number {
  const g = gloss.toLowerCase().trim()
  const t = term.toLowerCase().trim()
  if (!g) return -100
  if (g === t) return -50
  if (g.replace(/[^\p{L}]/gu, '') === t.replace(/[^\p{L}]/gu, '')) return -40
  if (/mymemory|quota|warning|available free/i.test(gloss)) return -100

  let score = 0
  const sourceBonus: Record<string, number> = {
    alignment: 10,
    phrase: 9,
    hint: 12,
    definition: 6,
    bare: 8,
  }
  score += sourceBonus[source] ?? 0

  const wc = wordCount(gloss)
  if (!/\s/.test(term.trim())) {
    if (wc === 1) score += 7
    else if (wc === 2) score += 4
    else if (wc <= 3) score += 1
    else score -= 10
  }

  if (/[ąćęłńóśźż]/i.test(gloss)) score += 5

  return score
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
    new RegExp(`\\b${escaped}\\s+(the|a|an|my|his|her|their|its|this|that|some|any|his|her)\\s+`, 'i').test(ctx) ||
    new RegExp(`\\b${escaped}\\s+(the|a|an|my|your|his|her|their|its|this|that|each|every|all|both|these|those)\\b`, 'i').test(ctx)
  ) {
    return 'adverb'
  }

  if (
    new RegExp(`\\b(come|go|run|walk|move|drive|fly|sail|travel|head|pass|run|rush|speed|look|gaze|stare)\\s+${escaped}\\b`, 'i').test(ctx)
  ) {
    return 'adverb'
  }

  if (
    new RegExp(`\\b${escaped}(ly|ward|wards|wise)\\b`, 'i').test(ctx) ||
    new RegExp(`\\b(very|quite|rather|too|so|more|most|less|least|really|extremely)\\s+${escaped}\\b`, 'i').test(ctx)
  ) {
    return 'adverb'
  }

  if (/\w+ing$/i.test(term) && new RegExp(`\\b(is|are|was|were|be|been|keep|kept|start|started|stop|stopped|continue|continued|enjoy|enjoyed|like|liked|love|loved|hate|hated|avoid|avoided|finish|finished|consider|considered|imagine|imagined|remember|remembered|forget|forgot)\\s+${escaped}\\b`, 'i').test(ctx)) {
    return 'verb'
  }

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
  context?: string,
): number {
  let score = 0
  if (preferredPos && sense.pos === preferredPos) score += 10
  if (preferredPos && sense.pos && sense.pos !== preferredPos) score -= 3

  const bag = tokenize(
    `${sense.definition} ${sense.example ?? ''} ${sense.synonyms.join(' ')}`,
  )
  for (const w of bag) {
    if (contextTokens.has(w)) score += 3
  }

  if (sense.example && context) {
    const ex = sense.example.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
    const ctx = context.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
    const exWords = tokenize(ex).slice(0, 4)
    if (exWords.length && exWords.every((w) => ctx.includes(w))) score += 12
  }

  if (sense.definition.length < 80) score += 1
  if (sense.example) score += 2
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
    const s = scoreSense(sense, contextTokens, preferredPos, context)
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
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const entries = (await res.json()) as DictionaryEntry[]
    return flattenSenses(entries)
  } catch {
    return []
  }
}

function senseHintQuery(term: string, pos: string | null, context?: string): string {
  if (/\s/.test(term)) return term
  const guessed = pos || guessPos(term, context)
  if (guessed === 'verb') return `to ${term}`
  if (guessed === 'noun') return `the ${term}`
  if (guessed === 'adjective') return `very ${term}`
  if (guessed === 'adverb') return term
  return term
}

function addCandidate(
  candidates: GlossCandidate[],
  term: string,
  raw: string | null | undefined,
  source: string,
) {
  if (!raw) return
  const gloss = cleanGloss(term, raw)
  if (!gloss) return
  candidates.push({
    gloss,
    source,
    score: scoreGlossCandidate(term, gloss, source),
  })
}

async function resolveBestGloss(
  term: string,
  sentence: string | undefined,
  pos: string | null,
  bestSense: DictSense | null,
  sentencePl: string | null,
): Promise<string> {
  const candidates: GlossCandidate[] = []

  const bounds = sentence ? findTermBounds(sentence, term) : null
  const phrase =
    sentence && bounds
      ? phraseAround(sentence, bounds.start, bounds.end, 3)
      : null

  const hintQuery = senseHintQuery(term, pos, sentence)
  const defSnippet = bestSense?.definition
    ?.split(/[;(.]/)[0]
    ?.trim()
    .slice(0, 120)

  const [hintPl, barePl, phrasePl, defPl] = await Promise.all([
    hintQuery !== term ? fetchTranslation(hintQuery) : Promise.resolve(null),
    fetchTranslation(term),
    phrase && phrase.toLowerCase() !== term.toLowerCase()
      ? fetchTranslation(phrase)
      : Promise.resolve(null),
    defSnippet ? fetchTranslation(defSnippet) : Promise.resolve(null),
  ])

  const referenceGloss = cleanGloss(
    term,
    hintPl || barePl || defPl || '',
  ) || null

  if (sentence && sentencePl) {
    const aligned = extractGlossFromAlignment(term, sentence, sentencePl)
    if (isValidAlignedGloss(term, aligned ?? '', referenceGloss)) {
      addCandidate(candidates, term, aligned, 'alignment')
    }
  }

  if (phrase && phrasePl) {
    if (/\s/.test(term.trim())) {
      addCandidate(candidates, term, phrasePl, 'phrase')
    } else {
      const phraseAligned = extractGlossFromAlignment(term, phrase, phrasePl)
      if (isValidAlignedGloss(term, phraseAligned ?? '', referenceGloss)) {
        addCandidate(candidates, term, phraseAligned, 'phrase')
      }
    }
  }

  addCandidate(candidates, term, hintPl, 'hint')
  addCandidate(candidates, term, barePl, 'bare')
  addCandidate(candidates, term, defPl, 'definition')

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates.find((c) => c.score > 0) ?? candidates[0]
  if (!best?.gloss) {
    throw new Error('Nie udało się przetłumaczyć. Spróbuj ponownie.')
  }
  return best.gloss
}

type DatamuseWord = { word: string }

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

async function translateWordList(words: string[]): Promise<string[]> {
  if (!words.length) return []
  const joined = words.join(', ')
  const pl = await fetchTranslation(joined)
  if (!pl) return words

  const parts = pl.split(/[,;]/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= Math.ceil(words.length * 0.6)) {
    return words.map((en, i) => {
      const gloss = parts[i] ? asTermGloss(en, parts[i]!) : en
      return `${en} — ${gloss}`
    })
  }
  return words
}

export async function translate(
  term: string,
  context?: string,
): Promise<TranslationResult> {
  const sentence = context?.replace(/\s+/g, ' ').trim() || undefined
  const hasSentence =
    !!sentence && sentence.toLowerCase() !== term.toLowerCase()

  const cacheKey = `v5::${term.toLowerCase()}::${(sentence ?? '').toLowerCase()}`
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

async function translateInternal(
  term: string,
  sentence: string | undefined,
  hasSentence: boolean,
  cacheKey: string,
): Promise<TranslationResult> {
  const [senses, sentencePl] = await Promise.all([
    fetchDictionarySenses(term),
    hasSentence && sentence ? fetchTranslation(sentence) : Promise.resolve(null),
  ])

  const best = pickBestSense(senses, term, sentence)
  const pos = best?.pos || guessPos(term, sentence)

  const gloss = await resolveBestGloss(term, sentence, pos, best, sentencePl)

  const explanationParts: string[] = []
  if (pos) explanationParts.push(`(${pos})`)
  if (best?.definition) explanationParts.push(best.definition)

  const result: TranslationResult = {
    term,
    translation: gloss,
    explanation: explanationParts.length
      ? explanationParts.join(' ')
      : undefined,
  }

  if (hasSentence && sentence) {
    result.context = sentence
    if (sentencePl) result.contextTranslation = sentencePl
  }

  const similarEn = await fetchSimilarEn(term, sentence, best?.synonyms ?? []).catch(
    () => [] as string[],
  )
  if (similarEn.length) {
    const similarPl = await translateWordList(similarEn)
    if (similarPl.length) result.similar = similarPl
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
