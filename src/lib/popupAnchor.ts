import type { LookupAnchor } from '../types'

/** Reading surface used to clamp popups (PDF page / EPUB host / TXT article). */
export function getReaderSurfaceRect(): DOMRect | null {
  const el =
    document.querySelector('.pdf-page') ??
    document.querySelector('.epub-host') ??
    document.querySelector('.txt-article')
  return el?.getBoundingClientRect() ?? null
}

/** Map a rect from an iframe document into the top-window viewport. */
export function viewportRectFromDoc(
  doc: Document,
  rect: { top: number; left: number; width: number; height: number },
): LookupAnchor {
  const win = doc.defaultView
  let top = rect.top
  let left = rect.left

  const frame = win?.frameElement as HTMLElement | null
  if (frame) {
    const fr = frame.getBoundingClientRect()
    top += fr.top
    left += fr.left
  } else {
    const iframes = document.querySelectorAll('iframe')
    for (const iframe of iframes) {
      try {
        if (iframe.contentDocument === doc) {
          const fr = iframe.getBoundingClientRect()
          top += fr.top
          left += fr.left
          break
        }
      } catch {
        /* cross-origin */
      }
    }
  }

  return {
    top,
    left,
    width: rect.width,
    height: rect.height,
  }
}
