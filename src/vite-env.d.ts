/// <reference types="vite/client" />

declare module '*?url' {
  const src: string
  export default src
}

declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist'
}
