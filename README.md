# English Reader

Lokalna aplikacja do czytania EPUB / PDF / TXT z tłumaczeniem EN → PL.

## Start

```bash
npm install
npm run dev
```

Otwórz http://localhost:5173 — wrzuć plik (np. `sample.txt`), zaznacz słowo lub frazę.

## Stack

- Vite + React + TypeScript
- EPUB: epubjs · PDF: pdfjs-dist
- Tłumaczenie: MyMemory + Free Dictionary (adapter w `src/lib/translate.ts`)
