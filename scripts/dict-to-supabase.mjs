/**
 * Import slim SQLite dictionary → Supabase Postgres.
 *
 * Prerequisites:
 * 1) Run supabase/dict-schema.sql in SQL Editor
 * 2) .env.local → SUPABASE_DB_URL (Settings → Database → URI, port 5432)
 *
 * Usage:
 *   npm run dict:to-supabase
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SQLITE = path.join(ROOT, 'data', 'dict', 'en.sqlite')

function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

async function insertBatch(client, table, columns, rows, batchSize = 400) {
  let done = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const values = []
    const params = []
    let p = 1
    for (const row of chunk) {
      const ph = columns.map(() => `$${p++}`)
      values.push(`(${ph.join(',')})`)
      for (const c of columns) {
        params.push(row[c] == null ? null : row[c])
      }
    }
    await client.query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')}`,
      params,
    )
    done += chunk.length
    if (done % 50000 === 0 || done === rows.length) {
      console.log(
        `  ${table}: ${done.toLocaleString()} / ${rows.length.toLocaleString()}`,
      )
    }
  }
}

async function main() {
  loadEnvLocal()
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  if (!url) {
    console.error(
      'Missing SUPABASE_DB_URL in .env.local\n' +
        'Supabase → Project Settings → Database → Connection string (URI)\n' +
        'Prefer direct connection port 5432.',
    )
    process.exit(1)
  }
  if (!fs.existsSync(SQLITE)) {
    console.error('Missing', SQLITE)
    process.exit(1)
  }

  console.log('Reading SQLite…')
  const sqlite = new DatabaseSync(SQLITE, { readOnly: true })
  const words = sqlite.prepare('SELECT word, pos, gloss FROM words').all()
  const forms = sqlite
    .prepare('SELECT form, word, pos, tags FROM forms')
    .all()
  const examples = sqlite
    .prepare('SELECT word, pos, example FROM examples')
    .all()
  sqlite.close()
  console.log(
    `  words=${words.length} forms=${forms.length} examples=${examples.length}`,
  )

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  console.log('Connected to Postgres')

  try {
    await client.query('BEGIN')
    console.log('Truncating…')
    await client.query(
      'TRUNCATE dict_examples, dict_forms, dict_words RESTART IDENTITY',
    )

    console.log('Importing words…')
    await insertBatch(client, 'dict_words', ['word', 'pos', 'gloss'], words)
    console.log('Importing forms…')
    await insertBatch(client, 'dict_forms', ['form', 'word', 'pos', 'tags'], forms)
    console.log('Importing examples…')
    await insertBatch(
      client,
      'dict_examples',
      ['word', 'pos', 'example'],
      examples,
    )

    await client.query('COMMIT')
    console.log('Analyzing…')
    await client.query('ANALYZE dict_words')
    await client.query('ANALYZE dict_forms')
    await client.query('ANALYZE dict_examples')

    const sizes = await client.query(`
      select relname,
             pg_size_pretty(pg_total_relation_size(c.oid)) as total
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and relname in ('dict_words','dict_forms','dict_examples')
      order by relname
    `)
    console.log('\nDone. Table sizes:')
    for (const r of sizes.rows) {
      console.log(`  ${r.relname}: ${r.total}`)
    }

    const probe = await client.query(`select public.lookup_dict($1) as j`, [
      'feet',
    ])
    console.log('\nProbe feet:', JSON.stringify(probe.rows[0]?.j)?.slice(0, 240))
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
