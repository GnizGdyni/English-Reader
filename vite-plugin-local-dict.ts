/**
 * Dev/preview middleware: safe local dictionary lookup via node:sqlite.
 * User input is never concatenated into SQL — only bound parameters.
 * DB missing / errors → JSON { ok: false } (app keeps working).
 */
import type { Plugin } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const MAX_Q = 48
const SAFE_TERM = /^[\p{L}']+$/u

type DictHit = {
  ok: true
  query: string
  lemma: string
  viaForm: null | {
    form: string
    lemma: string
    pos: string
    tags: string | null
  }
  entries: Array<{
    word: string
    pos: string
    gloss: string | null
    ipa: string | null
    examples: string[]
    translations_pl: string[]
  }>
}

type DictMiss = {
  ok: false
  query: string
  reason: string
}

function sanitizeTerm(raw: string): string | null {
  const t = raw.trim().toLowerCase()
  if (!t || t.length > MAX_Q) return null
  if (!SAFE_TERM.test(t)) return null
  return t
}

export function localDictPlugin(): Plugin {
  const root = path.dirname(fileURLToPath(import.meta.url))
  const dbPath = path.resolve(root, 'data/dict/en.sqlite')

  let db: DatabaseSync | null = null
  let dbFailed = false

  function getDb(): DatabaseSync | null {
    if (dbFailed) return null
    if (db) return db
    try {
      if (!fs.existsSync(dbPath)) {
        dbFailed = true
        return null
      }
      db = new DatabaseSync(dbPath, { readOnly: true })
      return db
    } catch {
      dbFailed = true
      db = null
      return null
    }
  }

  function lookup(query: string): DictHit | DictMiss {
    const q = sanitizeTerm(query)
    if (!q) return { ok: false, query, reason: 'invalid_query' }

    const database = getDb()
    if (!database) return { ok: false, query: q, reason: 'db_unavailable' }

    try {
      const formRows = database
        .prepare(
          `SELECT form, word, pos, tags FROM forms WHERE form = ? COLLATE NOCASE LIMIT 8`,
        )
        .all(q) as Array<{
        form: string
        word: string
        pos: string
        tags: string | null
      }>

      let lemma = q
      let viaForm: DictHit['viaForm'] = null
      if (formRows.length > 0) {
        const best =
          formRows.find((r) => r.word.toLowerCase() !== q) ?? formRows[0]!
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
          `SELECT word, pos, gloss, ipa FROM words WHERE word = ? COLLATE NOCASE LIMIT 6`,
        )
        .all(lemma) as Array<{
        word: string
        pos: string
        gloss: string | null
        ipa: string | null
      }>

      if (!wordRows.length && lemma !== q) {
        wordRows = database
          .prepare(
            `SELECT word, pos, gloss, ipa FROM words WHERE word = ? COLLATE NOCASE LIMIT 6`,
          )
          .all(q) as typeof wordRows
        lemma = q
        viaForm = null
      }

      const exStmt = database.prepare(
        `SELECT example FROM examples WHERE word = ? COLLATE NOCASE LIMIT 3`,
      )
      const plStmt = database.prepare(
        `SELECT gloss_pl FROM translations_pl WHERE word = ? COLLATE NOCASE LIMIT 4`,
      )

      const entries = wordRows.map((row) => {
        const examples = (
          exStmt.all(row.word) as Array<{ example: string }>
        ).map((r) => r.example)
        const translations_pl = (
          plStmt.all(row.word) as Array<{ gloss_pl: string }>
        ).map((r) => r.gloss_pl)
        return {
          word: row.word,
          pos: row.pos,
          gloss: row.gloss,
          ipa: row.ipa,
          examples,
          translations_pl,
        }
      })

      return {
        ok: true,
        query: q,
        lemma,
        viaForm,
        entries,
      }
    } catch {
      return { ok: false, query: q, reason: 'query_error' }
    }
  }

  function mount(
    middlewares: { use: (fn: (req: any, res: any, next: any) => void) => void },
  ) {
    middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/api/local-dict')) {
        next()
        return
      }

      try {
        const url = new URL(req.url, 'http://localhost')
        const q = url.searchParams.get('q') ?? ''
        const result = lookup(q)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(result))
      } catch {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(
          JSON.stringify({ ok: false, query: '', reason: 'handler_error' }),
        )
      }
    })
  }

  return {
    name: 'local-dict-api',
    configureServer(server) {
      mount(server.middlewares)
    },
    configurePreviewServer(server) {
      mount(server.middlewares)
    },
  }
}
