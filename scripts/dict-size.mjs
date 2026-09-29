import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'

const db = new DatabaseSync('data/dict/en.sqlite', { readOnly: true })
const g = db.prepare(`SELECT SUM(LENGTH(gloss)) sg FROM words`).get()
const e = db.prepare(`SELECT SUM(LENGTH(example)) se, COUNT(*) c FROM examples`).get()
const f = db.prepare(`SELECT COUNT(*) c FROM forms`).get()
const w = db.prepare(`SELECT COUNT(*) c FROM words`).get()
const fileMb = (statSync('data/dict/en.sqlite').size / (1024 * 1024)).toFixed(1)

console.log(
  JSON.stringify(
    {
      file_mb: +fileMb,
      words: w.c,
      forms: f.c,
      examples: e.c,
      gloss_mb: +(g.sg / 1e6).toFixed(1),
      examples_mb: +(e.se / 1e6).toFixed(1),
    },
    null,
    2,
  ),
)
