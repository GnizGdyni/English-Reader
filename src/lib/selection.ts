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
  const cached = textIndexCache.get(root)
  if (cached) return cached

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

  const built = { text, nodes, indexOf }
  textIndexCache.set(root, built)
  return built
}

const textIndexCache = new WeakMap<
  Node,
  {
    text: string
    nodes: Array<{ node: Text; start: number }>
    indexOf: (node: Node, offset: number) => number | null
  }
>()

/** Drop cached flattened text (call after DOM mutations / page change). */
export function invalidateTextIndex(root?: Node | null) {
  if (root) textIndexCache.delete(root)
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
  invalidateTextIndex(root instanceof Document ? root.body : root)
}

function wrapTextPortion(
  textNode: Text,
  from: number,
  to: number,
  doc: Document,
  className = HIGHLIGHT_CLASS,
) {
  const len = textNode.textContent?.length ?? 0
  if (from >= to || from < 0 || to > len) return

  const range = doc.createRange()
  range.setStart(textNode, from)
  range.setEnd(textNode, to)

  const mark = doc.createElement('mark')
  mark.className = className
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
  className = HIGHLIGHT_CLASS,
) {
  const doc = root.ownerDocument
  if (!doc || start >= end) return

  clearLookupHighlight(root)
  invalidateTextIndex(root)

  const { nodes } = buildTextIndex(root)
  for (const entry of nodes) {
    const len = entry.node.textContent?.length ?? 0
    const nodeStart = entry.start
    const nodeEnd = nodeStart + len
    const from = Math.max(start, nodeStart)
    const to = Math.min(end, nodeEnd)
    if (from < to) {
      wrapTextPortion(entry.node, from - nodeStart, to - nodeStart, doc, className)
    }
  }

  invalidateTextIndex(root)
}

/** Apply highlight from a LookupPayload (if it carries offsets). */
export function highlightLookup(
  root: HTMLElement | Document | null | undefined,
  payload: LookupPayload | null,
  className = HIGHLIGHT_CLASS,
) {
  if (!root || !payload?.highlight) return
  const el = root instanceof Document ? root.body : root
  if (!el) return
  applyLookupHighlight(
    el,
    payload.highlight.start,
    payload.highlight.end,
    className,
  )
}

/** Union of all highlight mark rects in viewport coordinates. */
export function getHighlightAnchorRect(
  root: HTMLElement | Document | null | undefined,
): DOMRect | null {
  if (!root) return null
  const el = root instanceof Document ? root.body : root
  if (!el) return null
  const marks = el.querySelectorAll(`.${HIGHLIGHT_CLASS}`)
  if (!marks.length) return null

  let top = Infinity
  let left = Infinity
  let bottom = -Infinity
  let right = -Infinity
  marks.forEach((m) => {
    const r = m.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    top = Math.min(top, r.top)
    left = Math.min(left, r.left)
    bottom = Math.max(bottom, r.bottom)
    right = Math.max(right, r.right)
  })
  if (!Number.isFinite(top)) return null
  return new DOMRect(left, top, right - left, bottom - top)
}

/** Sentence bounds from period/!/? to period (absolute offsets in flattened text). */
export function sentenceBoundsAt(
  text: string,
  offset: number,
): { start: number; end: number; text: string } | null {
  if (!text || offset < 0 || offset > text.length) return null

  // Period-to-period (+ ! ? … as sentence ends)
  const boundary = /[.!?…]/
  let from = Math.min(offset, text.length)
  while (from > 0 && !boundary.test(text[from - 1]!)) from--
  while (from < text.length && /\s/.test(text[from]!)) from++

  let to = Math.min(offset, text.length)
  while (to < text.length && !boundary.test(text[to]!)) to++
  if (to < text.length && boundary.test(text[to]!)) to++

  const sentence = text.slice(from, to).replace(/\s+/g, ' ').trim()
  if (!sentence) return null
  return { start: from, end: to, text: sentence }
}

/** Sentence under a click — for double-click translate. */
export function sentenceAtPoint(
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
  if (abs == null) return null

  const bounds = sentenceBoundsAt(text, abs)
  if (!bounds) return null

  return {
    term: bounds.text,
    context: bounds.text,
    highlight: { start: bounds.start, end: bounds.end },
  }
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

  const mid = Math.floor((start + end) / 2)
  const bounds = sentenceBoundsAt(text, mid)
  if (bounds) return bounds.text

  const winFrom = Math.max(0, start - 60)
  const winTo = Math.min(text.length, end + 60)
  return text.slice(winFrom, winTo).replace(/\s+/g, ' ').trim()
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

/** Absolute character index in flattened container text under a point. */
export function absoluteIndexAtPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = container.ownerDocument
  const range = caretRangeAtPoint(doc, clientX, clientY)
  if (!range) return null
  const { indexOf } = buildTextIndex(container)
  return indexOf(range.startContainer, range.startOffset)
}

/** Edge rects from a Range (cheap — no text index). */
export function getRangeEdgeRects(
  range: Range,
): { start: DOMRect; end: DOMRect; bounds: DOMRect } | null {
  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 || r.height > 0,
  )
  if (!rects.length) {
    const b = range.getBoundingClientRect()
    if (b.width === 0 && b.height === 0) return null
    return { start: b, end: b, bounds: b }
  }

  const first = rects[0]!
  const last = rects[rects.length - 1]!
  let top = Infinity
  let left = Infinity
  let bottom = -Infinity
  let right = -Infinity
  for (const r of rects) {
    top = Math.min(top, r.top)
    left = Math.min(left, r.left)
    bottom = Math.max(bottom, r.bottom)
    right = Math.max(right, r.right)
  }
  return {
    start: first,
    end: last,
    bounds: new DOMRect(left, top, right - left, bottom - top),
  }
}

/** Edge rects of the live Selection inside `root` (cheap — no text index). */
export function getLiveSelectionEdgeRects(
  root: HTMLElement | null | undefined,
): { start: DOMRect; end: DOMRect; bounds: DOMRect } | null {
  if (!root) return null
  const doc = root.ownerDocument
  const sel = doc.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null

  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  return getRangeEdgeRects(range)
}

/** Snapshot current selection as a detached Range clone. */
export function cloneLiveSelectionRange(
  root: HTMLElement | null | undefined,
): Range | null {
  if (!root) return null
  const sel = root.ownerDocument.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  try {
    return range.cloneRange()
  } catch {
    return null
  }
}

/** Re-apply a stored range as the live Selection (mobile often clears it). */
export function restoreSelectionRange(
  root: HTMLElement,
  range: Range,
): boolean {
  try {
    const sel = root.ownerDocument.getSelection()
    if (!sel) return false
    sel.removeAllRanges()
    sel.addRange(range.cloneRange())
    return true
  } catch {
    return false
  }
}

/** Move start or end of a Range to a caret under the point; updates live Selection. */
export function moveSelectionEdgeToPoint(
  root: HTMLElement,
  which: 'start' | 'end',
  clientX: number,
  clientY: number,
  baseRange?: Range | null,
): Range | null {
  const doc = root.ownerDocument
  const sel = doc.getSelection()
  const current =
    baseRange?.cloneRange() ??
    (sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null)
  if (!current) return null

  const caret = caretRangeAtPoint(doc, clientX, clientY)
  if (!caret || !root.contains(caret.startContainer)) return null

  const otherNode =
    which === 'start' ? current.endContainer : current.startContainer
  const otherOff = which === 'start' ? current.endOffset : current.startOffset

  try {
    const a = doc.createRange()
    a.setStart(caret.startContainer, caret.startOffset)
    a.collapse(true)
    const b = doc.createRange()
    b.setStart(otherNode, otherOff)
    b.collapse(true)
    const caretFirst = a.compareBoundaryPoints(Range.START_TO_START, b) <= 0

    const range = doc.createRange()
    if (caretFirst) {
      range.setStart(caret.startContainer, caret.startOffset)
      range.setEnd(otherNode, otherOff)
    } else {
      range.setStart(otherNode, otherOff)
      range.setEnd(caret.startContainer, caret.startOffset)
    }
    if (range.collapsed) return null
    restoreSelectionRange(root, range)
    return range.cloneRange()
  } catch {
    return null
  }
}

/** Build a Range for flattened offsets without touching the live Selection. */
export function createRangeFromOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const doc = root.ownerDocument
  if (!doc || start >= end) return null

  const { nodes } = buildTextIndex(root)
  let startNode: Text | null = null
  let startOff = 0
  let endNode: Text | null = null
  let endOff = 0

  for (const entry of nodes) {
    const len = entry.node.textContent?.length ?? 0
    const nodeStart = entry.start
    const nodeEnd = nodeStart + len
    if (!startNode && start >= nodeStart && start <= nodeEnd) {
      startNode = entry.node
      startOff = start - nodeStart
    }
    if (end > nodeStart && end <= nodeEnd) {
      endNode = entry.node
      endOff = end - nodeStart
    } else if (end > nodeEnd && nodes[nodes.length - 1] === entry) {
      endNode = entry.node
      endOff = len
    }
  }

  if (!startNode || !endNode) return null

  try {
    const range = doc.createRange()
    range.setStart(startNode, Math.min(startOff, startNode.length))
    range.setEnd(endNode, Math.min(endOff, endNode.length))
    return range
  } catch {
    return null
  }
}

/** Edge + band rects for a grip range (no Selection / no DOM mutation). */
export function getOffsetsEdgeRects(
  root: HTMLElement,
  start: number,
  end: number,
): {
  start: DOMRect
  end: DOMRect
  bounds: DOMRect
  bands: DOMRect[]
} | null {
  const range = createRangeFromOffsets(root, start, end)
  if (!range) return null
  const edges = getRangeEdgeRects(range)
  if (!edges) return null
  const bands = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 || r.height > 0,
  )
  return { ...edges, bands: bands.length ? bands : [edges.bounds] }
}

/** Lookup payload from flattened offsets (without relying on live Selection). */
export function lookupFromOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): LookupPayload | null {
  if (start >= end) return null
  const { text } = buildTextIndex(root)
  const term = normalizeTerm(text.slice(start, end))
  if (!term) return null
  return {
    term,
    context: sentenceAround(text, start, end),
    highlight: { start, end },
  }
}

/** Build a live Selection covering flattened text [start, end). */
export function selectTextRange(
  root: HTMLElement,
  start: number,
  end: number,
): boolean {
  const doc = root.ownerDocument
  if (!doc || start >= end) return false

  const { nodes } = buildTextIndex(root)
  let startNode: Text | null = null
  let startOff = 0
  let endNode: Text | null = null
  let endOff = 0

  for (const entry of nodes) {
    const len = entry.node.textContent?.length ?? 0
    const nodeStart = entry.start
    const nodeEnd = nodeStart + len
    if (!startNode && start >= nodeStart && start <= nodeEnd) {
      startNode = entry.node
      startOff = start - nodeStart
    }
    if (end > nodeStart && end <= nodeEnd) {
      endNode = entry.node
      endOff = end - nodeStart
    } else if (end > nodeEnd && entry === nodes[nodes.length - 1]) {
      endNode = entry.node
      endOff = len
    }
  }

  if (!startNode || !endNode) return false

  try {
    const range = doc.createRange()
    range.setStart(startNode, Math.min(startOff, startNode.length))
    range.setEnd(endNode, Math.min(endOff, endNode.length))
    const sel = doc.getSelection()
    if (!sel) return false
    sel.removeAllRanges()
    sel.addRange(range)
    return true
  } catch {
    return false
  }
}

/** Select the word under a point (seed for long-press grips). Fast path avoids full-page index. */
export function selectWordAtPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const doc = container.ownerDocument
  const caret = caretRangeAtPoint(doc, clientX, clientY)
  if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) {
    return false
  }

  const node = caret.startContainer as Text
  const local = node.textContent ?? ''
  const localBounds = wordBoundsInText(local, caret.startOffset)
  if (localBounds) {
    try {
      const range = doc.createRange()
      range.setStart(node, localBounds.start)
      range.setEnd(node, localBounds.end)
      if (!range.collapsed) {
        const sel = doc.getSelection()
        if (!sel) return false
        sel.removeAllRanges()
        sel.addRange(range)
        return true
      }
    } catch {
      /* fall through to indexed lookup */
    }
  }

  const hit = lookupAtPoint(container, clientX, clientY)
  if (!hit?.highlight) return false
  return selectTextRange(container, hit.highlight.start, hit.highlight.end)
}

/** Extend selection from an anchor point to the current point. */
export function extendSelectionToPoint(
  container: HTMLElement,
  anchorX: number,
  anchorY: number,
  clientX: number,
  clientY: number,
): boolean {
  const doc = container.ownerDocument
  const a = caretRangeAtPoint(doc, anchorX, anchorY)
  const b = caretRangeAtPoint(doc, clientX, clientY)
  if (!a || !b) return false

  try {
    const range = doc.createRange()
    const cmp = a.compareBoundaryPoints(Range.START_TO_START, b)
    if (cmp <= 0) {
      range.setStart(a.startContainer, a.startOffset)
      range.setEnd(b.startContainer, b.startOffset)
    } else {
      range.setStart(b.startContainer, b.startOffset)
      range.setEnd(a.startContainer, a.startOffset)
    }
    if (range.collapsed) return false
    const sel = doc.getSelection()
    if (!sel) return false
    sel.removeAllRanges()
    sel.addRange(range)
    return true
  } catch {
    return false
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

  // Prefer explicit root (PDF layer / TXT article / EPUB body) so highlight
  // offsets match highlightLookup's scope. Never index a lone <p> for EPUB.
  let scope: HTMLElement | null =
    root instanceof HTMLElement
      ? root
      : root instanceof Document
        ? root.body
        : null

  if (!scope) {
    const container =
      range.commonAncestorContainer.parentElement as HTMLElement | null
    if (!container) return { term }
    scope =
      (container.closest(
        '.txt-article, .textLayer, .epub-host, body',
      ) as HTMLElement | null) ?? container
  }

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

/** EPUB iframe: word/selection from Contents document (always scoped to body). */
export function lookupInDocument(
  doc: Document,
  clientX?: number,
  clientY?: number,
): LookupPayload | null {
  const body = doc.body
  if (!body) return null

  const selected = selectionLookup(body)
  if (selected) return selected

  if (clientX == null || clientY == null) return null
  return lookupAtPoint(body, clientX, clientY)
}
