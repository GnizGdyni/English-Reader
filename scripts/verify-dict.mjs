import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('data/dict/en.sqlite', { readOnly: true })
console.log(
  'forms feet:',
  db.prepare('SELECT * FROM forms WHERE form = ? LIMIT 5').all('feet'),
)
console.log(
  'word foot:',
  db
    .prepare(
      'SELECT word, pos, substr(gloss,1,80) AS g FROM words WHERE word = ? LIMIT 3',
    )
    .all('foot'),
)
console.log(
  'examples:',
  db.prepare('SELECT example FROM examples WHERE word = ? LIMIT 2').all('foot'),
)
const pages = db
  .prepare(
    'SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()',
  )
  .get()
console.log('size_mb', (pages.bytes / (1024 * 1024)).toFixed(1))
