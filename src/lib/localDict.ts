/** Client-side local dictionary probe (Vite /api/local-dict). Fail-soft. */

export type LocalDictEntry = {
  word: string
  pos: string
  gloss: string | null
  ipa: string | null
  examples: string[]
  translations_pl: string[]
  /** True when POS matches sentence heuristic. */
  preferred?: boolean
}

export type LocalDictDebug = {
  ok: boolean
  query: string
  reason?: string
  lemma?: string
  /** Heuristic POS from sentence context (noun/verb/…). */
  guessedPos?: string | null
  viaForm?: {
    form: string
    lemma: string
    pos: string
    tags: string | null
  } | null
  entries?: LocalDictEntry[]
}

/** Map Kaikki / guessPos labels onto a shared key. */
function normalizePos(pos: string): string {
  const p = pos.trim().toLowerCase()
  if (p === 'adjective' || p === 'adj' || p.startsWith('adj')) return 'adj'
  if (p === 'adverb' || p === 'adv' || p.startsWith('adv')) return 'adv'
  if (p.startsWith('noun')) return 'noun'
  if (p.startsWith('verb')) return 'verb'
  if (p.startsWith('pron')) return 'pron'
  if (p.startsWith('prep')) return 'prep'
  return p
}

function posMatches(entryPos: string, guessed: string): boolean {
  return normalizePos(entryPos) === normalizePos(guessed)
}

/**
 * Sort local-dict hits so context-matching POS is first and marked preferred.
 */
export function rankLocalDictByPos(
  debug: LocalDictDebug,
  guessedPos: string | null,
): LocalDictDebug {
  if (!debug.ok || !debug.entries?.length) {
    return { ...debug, guessedPos: guessedPos ?? null }
  }

  if (!guessedPos) {
    return {
      ...debug,
      guessedPos: null,
      entries: debug.entries.map((e) => ({ ...e, preferred: false })),
    }
  }

  const preferred = debug.entries.filter((e) => posMatches(e.pos, guessedPos))
  const rest = debug.entries.filter((e) => !posMatches(e.pos, guessedPos))

  return {
    ...debug,
    guessedPos,
    entries: [
      ...preferred.map((e) => ({ ...e, preferred: true })),
      ...rest.map((e) => ({ ...e, preferred: false })),
    ],
  }
}

const SAFE_TERM = /^[\p{L}']+$/u
const MAX_Q = 48

function sanitize(raw: string): string | null {
  const t = raw.trim().toLowerCase()
  if (!t || t.length > MAX_Q || !SAFE_TERM.test(t)) return null
  return t
}

/**
 * Safe lookup against local Kaikki SQLite (dev server API).
 * Never throws. Returns a structured debug object for the UI.
 */
export async function lookupLocalDict(term: string): Promise<LocalDictDebug> {
  const q = sanitize(term)
  if (!q) {
    return { ok: false, query: term, reason: 'invalid_query' }
  }

  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(`/api/local-dict?q=${encodeURIComponent(q)}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    window.clearTimeout(timer)

    if (!res.ok) {
      return { ok: false, query: q, reason: `http_${res.status}` }
    }

    const data = (await res.json()) as LocalDictDebug
    if (!data || typeof data !== 'object') {
      return { ok: false, query: q, reason: 'bad_json' }
    }
    return data
  } catch {
    // Production / offline / API missing — silent miss
    return { ok: false, query: q, reason: 'unavailable' }
  }
}
