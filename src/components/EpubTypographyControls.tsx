import { useId } from 'react'
import {
  EPUB_TYPOGRAPHY_DEFAULTS,
  EPUB_TYPOGRAPHY_LIMITS,
  type EpubTypography,
} from '../lib/epubTypography'

type Props = {
  value: EpubTypography
  onChange: (next: EpubTypography) => void
  compact?: boolean
}

function pct(scale: number): number {
  return Math.round(scale * 100)
}

export function EpubTypographyControls({
  value,
  onChange,
  compact = false,
}: Props) {
  const fontId = useId()
  const mxId = useId()
  const myId = useId()

  const set = (patch: Partial<EpubTypography>) => {
    onChange({ ...value, ...patch })
  }

  return (
    <div
      className={`epub-typo${compact ? ' epub-typo--compact' : ''}`}
      role="group"
      aria-label="Ustawienia tekstu EPUB"
    >
      <div className="epub-typo__head">
        <span className="epub-typo__title">Tekst EPUB</span>
        <button
          type="button"
          className="epub-typo__reset"
          onClick={() => onChange({ ...EPUB_TYPOGRAPHY_DEFAULTS })}
        >
          Reset
        </button>
      </div>

      <label className="epub-typo__row" htmlFor={fontId}>
        <span className="epub-typo__label">
          Czcionka <em>{pct(value.fontScale)}%</em>
        </span>
        <input
          id={fontId}
          type="range"
          min={EPUB_TYPOGRAPHY_LIMITS.fontScale.min}
          max={EPUB_TYPOGRAPHY_LIMITS.fontScale.max}
          step={EPUB_TYPOGRAPHY_LIMITS.fontScale.step}
          value={value.fontScale}
          onChange={(e) => set({ fontScale: Number(e.target.value) })}
        />
      </label>

      <label className="epub-typo__row" htmlFor={mxId}>
        <span className="epub-typo__label">
          Marginesy boczne <em>{value.marginX.toFixed(1)}em</em>
        </span>
        <input
          id={mxId}
          type="range"
          min={EPUB_TYPOGRAPHY_LIMITS.marginX.min}
          max={EPUB_TYPOGRAPHY_LIMITS.marginX.max}
          step={EPUB_TYPOGRAPHY_LIMITS.marginX.step}
          value={value.marginX}
          onChange={(e) => set({ marginX: Number(e.target.value) })}
        />
      </label>

      <label className="epub-typo__row" htmlFor={myId}>
        <span className="epub-typo__label">
          Marginesy góra/dół <em>{value.marginY.toFixed(1)}em</em>
        </span>
        <input
          id={myId}
          type="range"
          min={EPUB_TYPOGRAPHY_LIMITS.marginY.min}
          max={EPUB_TYPOGRAPHY_LIMITS.marginY.max}
          step={EPUB_TYPOGRAPHY_LIMITS.marginY.step}
          value={value.marginY}
          onChange={(e) => set({ marginY: Number(e.target.value) })}
        />
      </label>
    </div>
  )
}
