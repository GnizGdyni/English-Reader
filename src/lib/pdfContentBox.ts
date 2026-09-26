/** Uniform crop insets as fractions of page width / height (0–0.45). */
export type PdfCropInsets = {
  left: number
  right: number
  top: number
  bottom: number
}

/** Absolute content box in PDF user space for one page. */
export type PdfContentBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type PdfPageLike = {
  view: number[]
  getTextContent: () => Promise<{
    items: Array<Record<string, unknown>>
  }>
}

type PdfDocLike = {
  numPages: number
  getPage: (n: number) => Promise<PdfPageLike>
}

const MAX_INSET = 0.28
const SAMPLE_FROM = 5
const SAMPLE_TO = 15
const MIN_TEXT_LEN = 80

/**
 * Bounding box of visible text on a PDF page (PDF user space).
 * Ignores empty runs and short edge crumbs (page numbers / headers).
 */
export async function getPdfTextContentBox(
  page: PdfPageLike,
): Promise<PdfContentBox | null> {
  const view = page.view
  const pageW = (view[2] ?? 0) - (view[0] ?? 0)
  const pageH = (view[3] ?? 0) - (view[1] ?? 0)
  if (pageW <= 0 || pageH <= 0) return null

  const textContent = await page.getTextContent()
  const boxes: Array<{
    x0: number
    y0: number
    x1: number
    y1: number
    len: number
  }> = []
  let totalLen = 0

  for (const raw of textContent.items) {
    const str = typeof raw.str === 'string' ? raw.str.trim() : ''
    if (!str) continue
    const m = raw.transform
    if (!Array.isArray(m) || m.length < 6) continue

    const x = Number(m[4]) || 0
    const y = Number(m[5]) || 0
    const fontH =
      Math.hypot(Number(m[2]) || 0, Number(m[3]) || 0) ||
      Number(raw.height) ||
      10
    const w = Number(raw.width) || str.length * fontH * 0.45

    boxes.push({
      x0: x,
      y0: y - fontH * 0.25,
      x1: x + Math.max(w, fontH * 0.3),
      y1: y + fontH * 0.85,
      len: str.length,
    })
    totalLen += str.length
  }

  if (!boxes.length || totalLen < MIN_TEXT_LEN) return null

  const edge = 0.06
  const filtered = boxes.filter((b) => {
    const cx = (b.x0 + b.x1) / 2
    const cy = (b.y0 + b.y1) / 2
    const nearEdge =
      cx < (view[0] ?? 0) + pageW * edge ||
      cx > (view[2] ?? 0) - pageW * edge ||
      cy < (view[1] ?? 0) + pageH * edge ||
      cy > (view[3] ?? 0) - pageH * edge
    if (nearEdge && b.len <= 4) return false
    return true
  })

  const use =
    filtered.length >= Math.max(3, boxes.length * 0.2) ? filtered : boxes

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of use) {
    minX = Math.min(minX, b.x0)
    minY = Math.min(minY, b.y0)
    maxX = Math.max(maxX, b.x1)
    maxY = Math.max(maxY, b.y1)
  }

  if (!Number.isFinite(minX)) return null

  const pad = Math.max(8, Math.min(pageW, pageH) * 0.02)
  minX = Math.max(view[0] ?? 0, minX - pad)
  minY = Math.max(view[1] ?? 0, minY - pad)
  maxX = Math.min(view[2] ?? pageW, maxX + pad)
  maxY = Math.min(view[3] ?? pageH, maxY + pad)

  return { minX, minY, maxX, maxY }
}

function boxToInsets(
  box: PdfContentBox,
  view: number[],
): PdfCropInsets | null {
  const pageW = (view[2] ?? 0) - (view[0] ?? 0)
  const pageH = (view[3] ?? 0) - (view[1] ?? 0)
  if (pageW <= 0 || pageH <= 0) return null

  const left = Math.max(0, (box.minX - (view[0] ?? 0)) / pageW)
  const right = Math.max(0, ((view[2] ?? 0) - box.maxX) / pageW)
  const bottom = Math.max(0, (box.minY - (view[1] ?? 0)) / pageH)
  const top = Math.max(0, ((view[3] ?? 0) - box.maxY) / pageH)

  const clamp = (v: number) => Math.min(MAX_INSET, v)
  return {
    left: clamp(left),
    right: clamp(right),
    top: clamp(top),
    bottom: clamp(bottom),
  }
}

/**
 * Sample pages 5–15 (text-heavy only) and take the *smallest* shared
 * empty margins so every page keeps the same crop / scale.
 */
export async function estimatePdfCropInsets(
  doc: PdfDocLike,
  fromPage = SAMPLE_FROM,
  toPage = SAMPLE_TO,
): Promise<PdfCropInsets | null> {
  const start = Math.min(Math.max(1, fromPage), doc.numPages)
  const end = Math.min(Math.max(start, toPage), doc.numPages)
  const samples: PdfCropInsets[] = []

  for (let i = start; i <= end; i++) {
    try {
      const page = await doc.getPage(i)
      const box = await getPdfTextContentBox(page)
      if (!box) continue
      const insets = boxToInsets(box, page.view)
      if (!insets) continue
      samples.push(insets)
    } catch {
      // skip unreadable pages
    }
  }

  if (!samples.length) return null

  // Conservative: only crop what every sampled page agrees is empty.
  const left = Math.min(...samples.map((s) => s.left))
  const right = Math.min(...samples.map((s) => s.right))
  const top = Math.min(...samples.map((s) => s.top))
  const bottom = Math.min(...samples.map((s) => s.bottom))

  if (left + right < 0.04 && top + bottom < 0.04) return null

  return { left, right, top, bottom }
}

/** Apply document-level inset ratios to a page media box. */
export function contentBoxFromInsets(
  view: number[],
  insets: PdfCropInsets,
): PdfContentBox {
  const x0 = view[0] ?? 0
  const y0 = view[1] ?? 0
  const x1 = view[2] ?? 0
  const y1 = view[3] ?? 0
  const pageW = x1 - x0
  const pageH = y1 - y0

  return {
    minX: x0 + pageW * insets.left,
    maxX: x1 - pageW * insets.right,
    minY: y0 + pageH * insets.bottom,
    maxY: y1 - pageH * insets.top,
  }
}
