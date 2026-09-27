import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('data/dict/en.sqlite')
console.log('forms feet:', db.prepare('SELECT * FROM forms WHERE form = ? LIMIT 5').all('feet'))
console.log(
  'word foot:',
  db.prepare('SELECT word, pos, ipa, substr(gloss,1,80) AS g FROM words WHERE word = ? LIMIT 3').all('foot'),
)
console.log(
  'examples:',
  db.prepare('SELECT example FROM examples WHERE word = ? LIMIT 2').all('foot'),
)
