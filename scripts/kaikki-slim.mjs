/**
 * Slim Kaikki English dump → SQLite
 *
 * Kept for reader UX (no PL / no IPA — Google handles translation):
 *   words(word, pos, gloss)         -- 1 short gloss
 *   forms(form, word, pos, tags)    -- feet → foot
 *   examples(word, pos, example)    -- max 1 per lemma+pos
 *
 * Usage:
 *   npm run dict:slim -- "C:\\path\\kaikki.org-dictionary-English.jsonl.gz"
 *
 * Output:
 *   data/dict/en.sqlite
 *   data/dict/meta.json
 */

import {
  createReadStream,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  statSync,
  renameSync,
  copyFileSync,
} from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'data', 'dict')

const KEEP_POS = new Set([
  'noun',
  'verb',
  'adj',
  'adverb',
  'phrase',
  'prep',
  'conj',
  'pron',
  'det',
  'article',
  'num',
  'intj',
  'particle',
  'postp',
  'contraction',
])

const MAX_GLOSSES = 1
const MAX_GLOSS_LEN = 140
const MAX_EXAMPLES_PER_WORD = 1
const EXAMPLE_MIN = 8
const EXAMPLE_MAX = 140

function normalizePos(pos) {
  if (!pos || typeof pos !== 'string') return null
  const p = pos.toLowerCase().trim()
  if (p === 'adjective') return 'adj'
  if (p === 'preposition') return 'prep'
  if (p === 'conjunction') return 'conj'
  if (p === 'pronoun') return 'pron'
  if (p === 'determiner') return 'det'
  if (p === 'numeral') return 'num'
  if (p === 'interjection') return 'intj'
  if (p === 'postposition') return 'postp'
  return p
}

function cleanText(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}

function pickGloss(senses) {
  if (!Array.isArray(senses)) return null
  for (const sense of senses) {
    const list = sense?.glosses
    if (!Array.isArray(list)) continue
    for (const g of list) {
      if (typeof g !== 'string') continue
      let t = cleanText(g)
      if (t.length < 3) continue
      if (t.length > MAX_GLOSS_LEN) t = `${t.slice(0, MAX_GLOSS_LEN - 1).trim()}…`
      return t
    }
  }
  return null
}

function pickExamples(senses) {
  if (!Array.isArray(senses)) return []
  const seen = new Set()
  for (const sense of senses) {
    const exs = sense?.examples
    if (!Array.isArray(exs)) continue
    for (const ex of exs) {
      const raw = typeof ex === 'string' ? ex : ex?.text
      if (typeof raw !== 'string') continue
      const t = cleanText(raw)
      if (t.length < EXAMPLE_MIN || t.length > EXAMPLE_MAX) continue
      if (/[ſ]|\[\.\.\.\]/.test(t)) continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      return [t]
    }
  }
  return []
}

function pickForms(word, forms) {
  if (!Array.isArray(forms)) return []
  const lemma = word.toLowerCase()
  const out = []
  const seen = new Set()
  for (const f of forms) {
    const form = typeof f?.form === 'string' ? cleanText(f.form) : ''
    if (!form || form.includes(' ')) continue
    if (form.toLowerCase() === lemma) continue
    if (!/^[\p{L}']+$/u.test(form)) continue
    const tags = Array.isArray(f.tags)
      ? f.tags.filter((t) => typeof t === 'string').slice(0, 6).join(',')
      : ''
    const key = `${form.toLowerCase()}|${tags}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ form, tags })
    if (out.length >= 24) break
  }
  return out
}

function openInput(filePath) {
  const stream = createReadStream(filePath)
  if (filePath.endsWith('.gz')) return stream.pipe(createGunzip())
  return stream
}

async function main() {
  const input = process.argv[2]
  if (!input) {
    console.error(
      'Usage: npm run dict:slim -- <path-to-kaikki.org-dictionary-English.jsonl[.gz]>',
    )
    process.exit(1)
  }

  const inputPath = path.resolve(input)
  const dbPath = path.join(OUT_DIR, 'en.sqlite')
  const tmpPath = path.join(OUT_DIR, 'en.sqlite.tmp')
  mkdirSync(OUT_DIR, { recursive: true })

  for (const p of [tmpPath, `${tmpPath}-journal`, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
    try {
      unlinkSync(p)
    } catch {
      /* ok */
    }
  }

  const db = new DatabaseSync(tmpPath)
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;

    CREATE TABLE words (
      word TEXT NOT NULL COLLATE NOCASE,
      pos  TEXT NOT NULL,
      gloss TEXT,
      PRIMARY KEY (word, pos)
    );

    CREATE TABLE forms (
      form TEXT NOT NULL COLLATE NOCASE,
      word TEXT NOT NULL COLLATE NOCASE,
      pos  TEXT NOT NULL,
      tags TEXT,
      PRIMARY KEY (form, word, pos)
    );
    CREATE INDEX idx_forms_form ON forms(form);

    CREATE TABLE examples (
      id INTEGER PRIMARY KEY,
      word TEXT NOT NULL COLLATE NOCASE,
      pos TEXT NOT NULL,
      example TEXT NOT NULL
    );
    CREATE INDEX idx_examples_word ON examples(word);
  `)

  const insertWord = db.prepare(
    `INSERT OR REPLACE INTO words (word, pos, gloss) VALUES (?, ?, ?)`,
  )
  const insertForm = db.prepare(
    `INSERT OR IGNORE INTO forms (form, word, pos, tags) VALUES (?, ?, ?, ?)`,
  )
  const insertExample = db.prepare(
    `INSERT INTO examples (word, pos, example) VALUES (?, ?, ?)`,
  )

  let lines = 0
  let kept = 0
  let skippedPos = 0
  let formRows = 0
  let exampleRows = 0
  let parseErrors = 0

  const rl = createInterface({
    input: openInput(inputPath),
    crlfDelay: Infinity,
  })

  db.exec('BEGIN')
  let batch = 0

  console.log(`Reading: ${inputPath}`)
  console.log(`Writing: ${dbPath}`)

  for await (const line of rl) {
    lines++
    if (!line.trim()) continue

    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      parseErrors++
      continue
    }

    const word = typeof entry.word === 'string' ? cleanText(entry.word) : ''
    if (!word || word.length > 60) continue

    const pos = normalizePos(entry.pos)
    if (!pos || !KEEP_POS.has(pos)) {
      skippedPos++
      continue
    }

    if (/\s/.test(word) && pos !== 'phrase') continue

    const lang = entry.lang_code || entry.lang
    if (lang && lang !== 'en' && lang !== 'English') continue

    const gloss = pickGloss(entry.senses)
    const examples = pickExamples(entry.senses)
    const forms = pickForms(word, entry.forms)

    if (!gloss && !examples.length && !forms.length) continue

    insertWord.run(word, pos, gloss)
    kept++

    for (const f of forms) {
      insertForm.run(f.form, word, pos, f.tags || null)
      formRows++
    }
    for (const ex of examples) {
      insertExample.run(word, pos, ex)
      exampleRows++
    }

    batch++
    if (batch >= 5000) {
      db.exec('COMMIT')
      db.exec('BEGIN')
      batch = 0
      if (lines % 50000 === 0) {
        console.log(
          `… ${lines.toLocaleString()} lines, kept ${kept.toLocaleString()} lemmas`,
        )
      }
    }
  }

  db.exec('COMMIT')
  db.exec('ANALYZE')
  db.exec('VACUUM')
  db.close()

  try {
    unlinkSync(dbPath)
  } catch {
    /* may be locked — try rename over */
  }
  try {
    try {
      renameSync(tmpPath, dbPath)
    } catch {
      copyFileSync(tmpPath, dbPath)
      unlinkSync(tmpPath)
    }
  } catch (err) {
    console.error('Failed to replace en.sqlite — left at', tmpPath)
    throw err
  }

  const meta = {
    source: path.basename(inputPath),
    createdAt: new Date().toISOString(),
    slim: {
      maxGlosses: MAX_GLOSSES,
      maxGlossLen: MAX_GLOSS_LEN,
      maxExamples: MAX_EXAMPLES_PER_WORD,
      noIpa: true,
      noTranslationsPl: true,
    },
    linesRead: lines,
    parseErrors,
    skippedPos,
    words: kept,
    forms: formRows,
    examples: exampleRows,
    db: 'data/dict/en.sqlite',
    schema: {
      words: ['word', 'pos', 'gloss'],
      forms: ['form', 'word', 'pos', 'tags'],
      examples: ['word', 'pos', 'example'],
    },
    lookupHint:
      '1) forms WHERE form=?; 2) words WHERE word=?; 3) examples WHERE word=? LIMIT 1',
  }

  writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2))

  const sizeMb = (statSync(dbPath).size / (1024 * 1024)).toFixed(1)
  console.log('\nDone.')
  console.log(`  words:    ${kept.toLocaleString()}`)
  console.log(`  forms:    ${formRows.toLocaleString()}`)
  console.log(`  examples: ${exampleRows.toLocaleString()}`)
  console.log(`  sqlite:   ${dbPath} (${sizeMb} MB)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
