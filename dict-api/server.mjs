/**
 * Standalone dictionary API for Railway / Render / Fly.
 * Same contract as Vite /api/local-dict — safe parameterized SQL only.
 *
 * Env:
 *   PORT          — default 8080
 *   DICT_DB_PATH  — default ./data/en.sqlite
 *   DICT_DB_URL   — optional: download DB on first boot if file missing
 *   CORS_ORIGIN   — comma-separated allowlist (default *)
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8080)
const DB_PATH = path.resolve(
  process.env.DICT_DB_PATH || path.join(__dirname, 'data', 'en.sqlite'),
)
const DB_URL = process.env.DICT_DB_URL || ''
const CORS = process.env.CORS_ORIGIN || '*'

const MAX_Q = 48
const SAFE_TERM = /^[\p{L}']+$/u

/** @type {import('node:sqlite').DatabaseSync | null} */
let db = null
let dbFailed = false

function sanitizeTerm(raw) {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!t || t.length > MAX_Q) return null
  if (!SAFE_TERM.test(t)) return null
  return t
}

function getDb() {
  if (dbFailed) return null
  if (db) return db
  try {
    if (!fs.existsSync(DB_PATH)) {
      dbFailed = true
      return null
    }
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    return db
  } catch {
    dbFailed = true
    db = null
    return null
  }
}

function lookup(query) {
  const q = sanitizeTerm(query)
  if (!q) return { ok: false, query: String(query ?? ''), reason: 'invalid_query' }

  const database = getDb()
  if (!database) return { ok: false, query: q, reason: 'db_unavailable' }

  try {
    const formRows = database
      .prepare(
        `SELECT form, word, pos, tags FROM forms WHERE form = ? COLLATE NOCASE LIMIT 8`,
      )
      .all(q)

    let lemma = q
    let viaForm = null
    if (formRows.length > 0) {
      const best =
        formRows.find((r) => r.word.toLowerCase() !== q) ?? formRows[0]
      lemma = best.word
      viaForm = {
        form: best.form,
        lemma: best.word,
        pos: best.pos,
        tags: best.tags,
      }
    }

    let wordRows = database
      .prepare(
        `SELECT word, pos, gloss FROM words WHERE word = ? COLLATE NOCASE LIMIT 6`,
      )
      .all(lemma)

    if (!wordRows.length && lemma !== q) {
      wordRows = database
        .prepare(
          `SELECT word, pos, gloss FROM words WHERE word = ? COLLATE NOCASE LIMIT 6`,
        )
        .all(q)
      lemma = q
      viaForm = null
    }

    const exStmt = database.prepare(
      `SELECT example FROM examples WHERE word = ? COLLATE NOCASE LIMIT 1`,
    )

    const entries = wordRows.map((row) => {
      const examples = exStmt.all(row.word).map((r) => r.example)
      return {
        word: row.word,
        pos: row.pos,
        gloss: row.gloss,
        examples,
      }
    })

    return { ok: true, query: q, lemma, viaForm, entries }
  } catch {
    return { ok: false, query: q, reason: 'query_error' }
  }
}

function setCors(res, req) {
  const origin = req.headers.origin || ''
  if (CORS === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else {
    const allowed = CORS.split(',').map((s) => s.trim())
    if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type')
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(raw)
}

async function ensureDb() {
  if (fs.existsSync(DB_PATH)) {
    console.log(`[dict-api] using existing DB at ${DB_PATH}`)
    return
  }
  if (!DB_URL) {
    console.warn(
      `[dict-api] DB missing at ${DB_PATH} and DICT_DB_URL not set — lookups will fail`,
    )
    return
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  const tmp = `${DB_PATH}.download`
  console.log(`[dict-api] downloading DB from DICT_DB_URL…`)

  const res = await fetch(DB_URL)
  if (!res.ok || !res.body) {
    throw new Error(`DICT_DB_URL download failed: HTTP ${res.status}`)
  }

  const file = fs.createWriteStream(tmp)
  const { Readable } = await import('node:stream')
  const { pipeline } = await import('node:stream/promises')
  await pipeline(Readable.fromWeb(res.body), file)
  fs.renameSync(tmp, DB_PATH)
  console.log(`[dict-api] DB ready (${Math.round(fs.statSync(DB_PATH).size / 1e6)} MB)`)
}

const server = http.createServer((req, res) => {
  setCors(res, req)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      db: Boolean(getDb()),
    })
    return
  }

  if (url.pathname === '/api/local-dict' && req.method === 'GET') {
    try {
      const q = url.searchParams.get('q') ?? ''
      sendJson(res, 200, lookup(q))
    } catch {
      sendJson(res, 200, { ok: false, query: '', reason: 'handler_error' })
    }
    return
  }

  sendJson(res, 404, { ok: false, reason: 'not_found' })
})

await ensureDb()
getDb()

server.listen(PORT, () => {
  console.log(`[dict-api] listening on :${PORT}`)
})
