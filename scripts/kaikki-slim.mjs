/**
 * Slim Kaikki English dump → SQLite
 *
 * Keeps only what we need for lookup UX (feet → foot, gloss, IPA, examples, PL):
 *   words(word, pos, gloss, ipa)
 *   forms(form, word, pos, tags)   -- reverse index for inflected forms
 *   examples(word, pos, example)
 *   translations_pl(word, pos, gloss_pl)
 *
 * Usage:
 *   npm run dict:slim -- "C:\\path\\kaikki.org-dictionary-English.jsonl.gz"
 *   npm run dict:slim -- "./kaikki.org-dictionary-English.jsonl"
 *
 * Output:
 *   data/dict/en.sqlite
 *   data/dict/meta.json
 *
 * Download:
 *   https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
 */

import {
  createReadStream,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  statSync,
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

const MAX_GLOSSES = 2
const MAX_EXAMPLES_PER_WORD = 3
const MAX_PL = 4
const EXAMPLE_MIN = 8
const EXAMPLE_MAX = 160

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

function pickIpa(sounds) {
  if (!Array.isArray(sounds)) return null
  for (const s of sounds) {
    const ipa = typeof s?.ipa === 'string' ? s.ipa.trim() : ''
    if (ipa) return ipa.slice(0, 80)
  }
  return null
}

function cleanText(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}

function pickGloss(senses) {
  if (!Array.isArray(senses)) return null
  const glosses = []
  for (const sense of senses) {
    const list = sense?.glosses
    if (!Array.isArray(list)) continue
    for (const g of list) {
      if (typeof g !== 'string') continue
      const t = cleanText(g)
      if (t.length < 3 || t.length > 240) continue
      glosses.push(t)
      if (glosses.length >= MAX_GLOSSES) return glosses.join(' | ')
    }
  }
  return glosses.length ? glosses.join(' | ') : null
}

function pickExamples(senses) {
  if (!Array.isArray(senses)) return []
  const out = []
  const seen = new Set()
  for (const sense of senses) {
    const exs = sense?.examples
    if (!Array.isArray(exs)) continue
    for (const ex of exs) {
      const raw = typeof ex === 'string' ? ex : ex?.text
      if (typeof raw !== 'string') continue
      const t = cleanText(raw)
      if (t.length < EXAMPLE_MIN || t.length > EXAMPLE_MAX) continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
      if (out.length >= MAX_EXAMPLES_PER_WORD) return out
    }
  }
  return out
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

function pickPl(translations) {
  if (!Array.isArray(translations)) return []
  const out = []
  const seen = new Set()
  for (const tr of translations) {
    const code = tr?.lang_code || tr?.code
    const lang = typeof tr?.lang === 'string' ? tr.lang.toLowerCase() : ''
    const isPl =
      code === 'pl' ||
      lang === 'polish' ||
      lang === 'polski' ||
      lang.startsWith('polish')
    if (!isPl) continue
    const w = typeof tr?.word === 'string' ? cleanText(tr.word) : ''
    if (!w || w.length > 80) continue
    const key = w.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
    if (out.length >= MAX_PL) break
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
  mkdirSync(OUT_DIR, { recursive: true })

  try {
    unlinkSync(dbPath)
  } catch {
    /* ok */
  }

  const db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;

    CREATE TABLE words (
      word TEXT NOT NULL COLLATE NOCASE,
      pos  TEXT NOT NULL,
      gloss TEXT,
      ipa TEXT,
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

    CREATE TABLE translations_pl (
      word TEXT NOT NULL COLLATE NOCASE,
      pos TEXT NOT NULL,
      gloss_pl TEXT NOT NULL,
      PRIMARY KEY (word, pos, gloss_pl)
    );
  `)

  const insertWord = db.prepare(
    `INSERT OR REPLACE INTO words (word, pos, gloss, ipa) VALUES (?, ?, ?, ?)`,
  )
  const insertForm = db.prepare(
    `INSERT OR IGNORE INTO forms (form, word, pos, tags) VALUES (?, ?, ?, ?)`,
  )
  const insertExample = db.prepare(
    `INSERT INTO examples (word, pos, example) VALUES (?, ?, ?)`,
  )
  const insertPl = db.prepare(
    `INSERT OR IGNORE INTO translations_pl (word, pos, gloss_pl) VALUES (?, ?, ?)`,
  )

  let lines = 0
  let kept = 0
  let skippedPos = 0
  let formRows = 0
  let exampleRows = 0
  let plRows = 0
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

    // Multi-word only for phrases
    if (/\s/.test(word) && pos !== 'phrase') continue

    const lang = entry.lang_code || entry.lang
    if (lang && lang !== 'en' && lang !== 'English') continue

    const gloss = pickGloss(entry.senses)
    const ipa = pickIpa(entry.sounds)
    const examples = pickExamples(entry.senses)
    const forms = pickForms(word, entry.forms)
    const pl = pickPl(entry.translations)

    if (!gloss && !examples.length && !forms.length && !pl.length) continue

    insertWord.run(word, pos, gloss, ipa)
    kept++

    for (const f of forms) {
      insertForm.run(f.form, word, pos, f.tags || null)
      formRows++
    }
    for (const ex of examples) {
      insertExample.run(word, pos, ex)
      exampleRows++
    }
    for (const g of pl) {
      insertPl.run(word, pos, g)
      plRows++
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
  db.close()

  const meta = {
    source: path.basename(inputPath),
    createdAt: new Date().toISOString(),
    linesRead: lines,
    parseErrors,
    skippedPos,
    words: kept,
    forms: formRows,
    examples: exampleRows,
    translations_pl: plRows,
    db: 'data/dict/en.sqlite',
    schema: {
      words: ['word', 'pos', 'gloss', 'ipa'],
      forms: ['form', 'word', 'pos', 'tags'],
      examples: ['word', 'pos', 'example'],
      translations_pl: ['word', 'pos', 'gloss_pl'],
    },
    lookupHint:
      '1) SELECT word, pos, tags FROM forms WHERE form = ? COLLATE NOCASE; 2) else SELECT * FROM words WHERE word = ? COLLATE NOCASE; 3) examples / translations_pl by word(+pos).',
  }

  writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2))

  const sizeMb = (statSync(dbPath).size / (1024 * 1024)).toFixed(1)
  console.log('\nDone.')
  console.log(`  words:           ${kept.toLocaleString()}`)
  console.log(`  forms:           ${formRows.toLocaleString()}`)
  console.log(`  examples:        ${exampleRows.toLocaleString()}`)
  console.log(`  translations_pl: ${plRows.toLocaleString()}`)
  console.log(`  sqlite:          ${dbPath} (${sizeMb} MB)`)
  console.log(`  meta:            ${path.join(OUT_DIR, 'meta.json')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
