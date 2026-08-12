/** Normalize selected / clicked text for lookup. */
export function normalizeTerm(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’«»\[\({\-\u2013\u2014]+/, '')
    .replace(/[\s"'“”‘’«»\]\)}.,!?;:…\-–—]+$/, '')
    .trim()
}

export type LookupPayload = {
  term: string
  /** Full sentence (or nearby text) containing the term. */
  context?: string
}

const isWordChar = (ch: string) => /[\p{L}\p{N}'’\-]/u.test(ch)

function caretRangeAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): Range | null {
  const caretRangeFromPoint = (
    doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
  ).caretRangeFromPoint

  if (typeof caretRangeFromPoint === 'function') {
    return caretRangeFromPoint.call(doc, clientX, clientY)
  }

  const pos = (
    doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null
    }
  ).caretPositionFromPoint?.(clientX, clientY)

  if (!pos?.offsetNode) return null
  const range = doc.createRange()
  range.setStart(pos.offsetNode, pos.offset)
  range.collapse(true)
  return range
}

/** Collect visible text nodes under a root, in document order. */
function collectTextNodes(root: Node): Text[] {
  const out: Text[] = []
  const walk = root.ownerDocument?.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  )
  if (!walk) return out
  let n = walk.nextNode()
  while (n) {
    if (n.nodeType === Node.TEXT_NODE && (n.textContent?.length ?? 0) > 0) {
      out.push(n as Text)
    }
    n = walk.nextNode()
  }
  return out
}

function textHost(node: Text): HTMLElement | null {
  const el = node.parentElement
  return el
}

/**
 * PDF text layers put each run in an absolutely positioned <span> without
 * spaces at line wraps. Insert a space when geometry says it's a wrap/gap —
 * but not for mid-word splits or hyphenated breaks ("some-" + "thing").
 */
function shouldInsertSpace(prev: Text, next: Text): boolean {
  const a = prev.textContent ?? ''
  const b = next.textContent ?? ''
  if (!a || !b) return false
  if (/\s$/.test(a) || /^\s/.test(b)) return false
  // Hyphenation across lines: keep glued
  if (/[-­\u2010\u2011]$/.test(a) && /^\p{L}/u.test(b)) return false

  const prevEl = textHost(prev)
  const nextEl = textHost(next)
  if (!prevEl || !nextEl) {
    // Non-positioned text (TXT/EPUB): only soft heuristic for missing space
    return isWordChar(a[a.length - 1]!) && isWordChar(b[0]!)
  }

  const pr = prevEl.getBoundingClientRect()
  const nr = nextEl.getBoundingClientRect()
  if (pr.width === 0 && pr.height === 0) {
    return isWordChar(a[a.length - 1]!) && isWordChar(b[0]!)
  }

  const lineThreshold = Math.max(2, Math.min(pr.height, nr.height) * 0.45)
  // New line / wrap
  if (nr.top > pr.top + lineThreshold) return true

  // Same line with a visible gap between runs
  const gap = nr.left - pr.right
  const em = Math.max(pr.height, nr.height, 10)
  if (gap > em * 0.12) return true

  // Tightly adjacent / overlapping → same word split across spans
  return false
}

/**
 * Build a continuous string from text nodes and map a node+offset to an index.
 * Inserts missing spaces at PDF line wraps / gaps.
 */
function buildTextIndex(root: Node): {
  text: string
  indexOf: (node: Node, offset: number) => number | null
} {
  const nodes = collectTextNodes(root)
  let text = ''
  const starts: Array<{ node: Text; start: number }> = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (i > 0 && shouldInsertSpace(nodes[i - 1]!, node)) {
      text += ' '
    }
    starts.push({ node, start: text.length })
    text += node.textContent ?? ''
  }

  const indexOf = (node: Node, offset: number): number | null => {
    const entry = starts.find((s) => s.node === node)
    if (!entry) return null
    return entry.start + offset
  }

  return { text, indexOf }
}

/** Sentence (or nearby chunk) containing [start, end) in `text`. */
export function sentenceAround(
  text: string,
  start: number,
  end: number,
): string {
  if (!text || start < 0 || end > text.length || start >= end) {
    return text.slice(Math.max(0, start - 40), Math.min(text.length, end + 40)).trim()
  }

  const boundary = /[.!?…\n\r]/
  let from = start
  while (from > 0 && !boundary.test(text[from - 1]!)) from--
  while (from < start && /\s/.test(text[from]!)) from++

  let to = end
  while (to < text.length && !boundary.test(text[to]!)) to++
  if (to < text.length && boundary.test(text[to]!)) to++

  let sentence = text.slice(from, to).replace(/\s+/g, ' ').trim()

  // Fallback: window of nearby words if sentence is huge or empty
  if (!sentence || sentence.length > 280) {
    const winFrom = Math.max(0, start - 60)
    const winTo = Math.min(text.length, end + 60)
    sentence = text.slice(winFrom, winTo).replace(/\s+/g, ' ').trim()
  }

  return sentence
}

/** Short phrase around the term (± few words) — better for sense disambiguation. */
export function phraseAround(
  text: string,
  start: number,
  end: number,
  radius = 4,
): string {
  let from = start
  let wordsLeft = radius
  while (from > 0 && wordsLeft > 0) {
    from--
    if (from > 0 && /\s/.test(text[from]!) && isWordChar(text[from - 1]!)) {
      wordsLeft--
    }
  }
  while (from < start && /\s/.test(text[from]!)) from++

  let to = end
  let wordsRight = radius
  while (to < text.length && wordsRight > 0) {
    if (/\s/.test(text[to]!) && to + 1 < text.length && isWordChar(text[to + 1]!)) {
      wordsRight--
    }
    to++
  }

  return text.slice(from, to).replace(/\s+/g, ' ').trim()
}

function wordBoundsInText(
  text: string,
  offset: number,
): { start: number; end: number } | null {
  if (!text || offset < 0 || offset > text.length) return null
  let start = Math.min(offset, text.length)
  let end = start
  // If caret is between words, nudge into a word
  if (start < text.length && !isWordChar(text[start]!) && start > 0 && isWordChar(text[start - 1]!)) {
    start--
    end = start + 1
  }
  while (start > 0 && isWordChar(text[start - 1]!)) start--
  while (end < text.length && isWordChar(text[end]!)) end++
  if (start >= end) return null
  return { start, end }
}

/** Word under a click + surrounding sentence from a container. */
export function lookupAtPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): LookupPayload | null {
  const doc = container.ownerDocument
  const range = caretRangeAtPoint(doc, clientX, clientY)
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) {
    return null
  }

  const { text, indexOf } = buildTextIndex(container)
  const abs = indexOf(range.startContainer, range.startOffset)
  if (abs == null) {
    // Fallback: only local text node
    const local = range.startContainer.textContent ?? ''
    const bounds = wordBoundsInText(local, range.startOffset)
    if (!bounds) return null
    const term = normalizeTerm(local.slice(bounds.start, bounds.end))
    if (!term) return null
    return {
      term,
      context: sentenceAround(local, bounds.start, bounds.end),
    }
  }

  const bounds = wordBoundsInText(text, abs)
  if (!bounds) return null
  const term = normalizeTerm(text.slice(bounds.start, bounds.end))
  if (!term) return null

  return {
    term,
    context: sentenceAround(text, bounds.start, bounds.end),
  }
}

/** @deprecated prefer lookupAtPoint */
export function wordAtPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): string | null {
  return lookupAtPoint(container, clientX, clientY)?.term ?? null
}

export function getSelectionText(root?: Document | HTMLElement): string {
  return selectionLookup(root)?.term ?? ''
}

/** Current selection + sentence context from the same root. */
export function selectionLookup(
  root?: Document | HTMLElement,
): LookupPayload | null {
  const doc =
    root instanceof Document
      ? root
      : root?.ownerDocument ?? document
  const selection = doc.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return null
  }

  const term = normalizeTerm(selection.toString())
  if (!term) return null

  const range = selection.getRangeAt(0)
  const container =
    root instanceof HTMLElement
      ? root
      : (range.commonAncestorContainer.parentElement as HTMLElement | null)

  if (!container) {
    return { term }
  }

  // Prefer book root (article / textLayer / body) for full sentence
  const scope =
    (container.closest('.txt-article, .textLayer, .epub-host') as HTMLElement | null) ??
    (root instanceof HTMLElement ? root : container)

  try {
    const { text, indexOf } = buildTextIndex(scope)
    const start = indexOf(range.startContainer, range.startOffset)
    const end = indexOf(range.endContainer, range.endOffset)
    if (start != null && end != null && end > start) {
      const fromIndex = normalizeTerm(text.slice(start, end))
      return {
        term: fromIndex || term,
        context: sentenceAround(text, start, end),
      }
    }
  } catch {
    /* fall through */
  }

  // Local fallback from selected range's ancestor text
  const localText = scope.innerText || scope.textContent || term
  const idx = localText.toLowerCase().indexOf(term.toLowerCase())
  if (idx >= 0) {
    return {
      term,
      context: sentenceAround(localText, idx, idx + term.length),
    }
  }

  return { term, context: term }
}

/** EPUB iframe: word/selection from Contents document. */
export function lookupInDocument(
  doc: Document,
  clientX?: number,
  clientY?: number,
): LookupPayload | null {
  const selected = selectionLookup(doc)
  if (selected) return selected

  if (clientX == null || clientY == null) return null
  const body = doc.body
  if (!body) return null
  return lookupAtPoint(body, clientX, clientY)
}
