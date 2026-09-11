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
  /** Absolute offsets in flattened text — for persistent highlight. */
  highlight?: { start: number; end: number }
}

const HIGHLIGHT_CLASS = 'lookup-highlight'
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
  return node.parentElement
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
  if (/[-­\u2010\u2011]$/.test(a) && /^\p{L}/u.test(b)) return false

  const prevEl = textHost(prev)
  const nextEl = textHost(next)
  if (!prevEl || !nextEl) {
    return isWordChar(a[a.length - 1]!) && isWordChar(b[0]!)
  }

  const pr = prevEl.getBoundingClientRect()
  const nr = nextEl.getBoundingClientRect()
  if (pr.width === 0 && pr.height === 0) {
    return isWordChar(a[a.length - 1]!) && isWordChar(b[0]!)
  }

  const lineThreshold = Math.max(2, Math.min(pr.height, nr.height) * 0.45)
  if (nr.top > pr.top + lineThreshold) return true

  const gap = nr.left - pr.right
  const em = Math.max(pr.height, nr.height, 10)
  if (gap > em * 0.12) return true

  return false
}

/**
 * Build a continuous string from text nodes and map a node+offset to an index.
 * Inserts missing spaces at PDF line wraps / gaps.
 */
function buildTextIndex(root: Node): {
  text: string
  nodes: Array<{ node: Text; start: number }>
  indexOf: (node: Node, offset: number) => number | null
} {
  const nodesRaw = collectTextNodes(root)
  let text = ''
  const nodes: Array<{ node: Text; start: number }> = []

  for (let i = 0; i < nodesRaw.length; i++) {
    const node = nodesRaw[i]!
    if (i > 0 && shouldInsertSpace(nodesRaw[i - 1]!, node)) {
      text += ' '
    }
    nodes.push({ node, start: text.length })
    text += node.textContent ?? ''
  }

  const indexOf = (node: Node, offset: number): number | null => {
    const entry = nodes.find((s) => s.node === node)
    if (!entry) return null
    return entry.start + offset
  }

  return { text, nodes, indexOf }
}

/** Remove previous lookup highlights under a root (or whole document). */
export function clearLookupHighlight(root?: Document | HTMLElement | null) {
  if (!root) return
  const scope: ParentNode =
    root instanceof Document ? (root.body ?? root) : root

  const marks = scope.querySelectorAll(`.${HIGHLIGHT_CLASS}`)
  marks.forEach((el) => {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
    parent.normalize()
  })
}

function wrapTextPortion(
  textNode: Text,
  from: number,
  to: number,
  doc: Document,
) {
  const len = textNode.textContent?.length ?? 0
  if (from >= to || from < 0 || to > len) return

  const range = doc.createRange()
  range.setStart(textNode, from)
  range.setEnd(textNode, to)

  const mark = doc.createElement('mark')
  mark.className = HIGHLIGHT_CLASS
  try {
    range.surroundContents(mark)
  } catch {
    const frag = range.extractContents()
    mark.appendChild(frag)
    range.insertNode(mark)
  }
}

/** Highlight a span of flattened text inside `root`. */
export function applyLookupHighlight(
  root: HTMLElement,
  start: number,
  end: number,
) {
  const doc = root.ownerDocument
  if (!doc || start >= end) return

  clearLookupHighlight(root)

  const { nodes } = buildTextIndex(root)
  for (const entry of nodes) {
    const len = entry.node.textContent?.length ?? 0
    const nodeStart = entry.start
    const nodeEnd = nodeStart + len
    const from = Math.max(start, nodeStart)
    const to = Math.min(end, nodeEnd)
    if (from < to) {
      wrapTextPortion(entry.node, from - nodeStart, to - nodeStart, doc)
    }
  }

  const first = root.querySelector(`.${HIGHLIGHT_CLASS}`)
  first?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/** Apply highlight from a LookupPayload (if it carries offsets). */
export function highlightLookup(
  root: HTMLElement | Document | null | undefined,
  payload: LookupPayload | null,
) {
  if (!root || !payload?.highlight) return
  const el = root instanceof Document ? root.body : root
  if (!el) return
  applyLookupHighlight(el, payload.highlight.start, payload.highlight.end)
}

/** Sentence (or nearby chunk) containing [start, end) in `text`. */
export function sentenceAround(
  text: string,
  start: number,
  end: number,
): string {
  if (!text || start < 0 || end > text.length || start >= end) {
    return text
      .slice(Math.max(0, start - 40), Math.min(text.length, end + 40))
      .trim()
  }

  const boundary = /[.!?…\n\r]/
  let from = start
  while (from > 0 && !boundary.test(text[from - 1]!)) from--
  while (from < start && /\s/.test(text[from]!)) from++

  let to = end
  while (to < text.length && !boundary.test(text[to]!)) to++
  if (to < text.length && boundary.test(text[to]!)) to++

  let sentence = text.slice(from, to).replace(/\s+/g, ' ').trim()

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
    if (
      /\s/.test(text[to]!) &&
      to + 1 < text.length &&
      isWordChar(text[to + 1]!)
    ) {
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
  if (
    start < text.length &&
    !isWordChar(text[start]!) &&
    start > 0 &&
    isWordChar(text[start - 1]!)
  ) {
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
    highlight: { start: bounds.start, end: bounds.end },
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
      : (root?.ownerDocument ?? document)
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

  const scope =
    (container.closest(
      '.txt-article, .textLayer, .epub-host',
    ) as HTMLElement | null) ??
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
        highlight: { start, end },
      }
    }
  } catch {
    /* fall through */
  }

  const localText = scope.innerText || scope.textContent || term
  const idx = localText.toLowerCase().indexOf(term.toLowerCase())
  if (idx >= 0) {
    return {
      term,
      context: sentenceAround(localText, idx, idx + term.length),
      highlight: { start: idx, end: idx + term.length },
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
