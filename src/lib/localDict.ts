/** Dictionary lookup: Supabase RPC first, then optional Vite/Railway API. */

import { getSupabase } from './supabase'

export type LocalDictEntry = {
  word: string
  pos: string
  gloss: string | null
  examples: string[]
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

async function lookupViaSupabase(q: string): Promise<LocalDictDebug | null> {
  const sb = getSupabase()
  if (!sb) return null

  try {
    const { data, error } = await sb.rpc('lookup_dict', { raw_q: q })
    if (error || !data || typeof data !== 'object') {
      return null
    }
    return data as LocalDictDebug
  } catch {
    return null
  }
}

async function lookupViaHttp(q: string): Promise<LocalDictDebug> {
  const base = (
    import.meta.env.VITE_DICT_API_URL as string | undefined
  )?.replace(/\/$/, '')
  const endpoint = base
    ? `${base}/api/local-dict?q=${encodeURIComponent(q)}`
    : `/api/local-dict?q=${encodeURIComponent(q)}`

  const timeoutMs = base ? 12000 : 2500

  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(endpoint, {
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
    return { ok: false, query: q, reason: 'unavailable' }
  }
}

/**
 * Safe dictionary lookup. Prefer Supabase RPC; fall back to Vite/Railway API.
 * Never throws.
 */
export async function lookupLocalDict(term: string): Promise<LocalDictDebug> {
  const q = sanitize(term)
  if (!q) {
    return { ok: false, query: term, reason: 'invalid_query' }
  }

  const fromSb = await lookupViaSupabase(q)
  if (fromSb?.ok) return fromSb
  if (fromSb && fromSb.ok === false && fromSb.reason === 'invalid_query') {
    return fromSb
  }

  return lookupViaHttp(q)
}
