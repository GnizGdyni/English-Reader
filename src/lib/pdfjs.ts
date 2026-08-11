import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  setLayerDimensions,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

// Use URL-based worker — pdf.js spawns/destroys it per PDFWorker instance,
// so we never get "worker is being destroyed" on component remount.
GlobalWorkerOptions.workerSrc = workerUrl

export {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  setLayerDimensions,
  type PDFDocumentProxy,
}
