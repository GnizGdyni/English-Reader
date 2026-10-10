import { useEffect, useId, useState, type CSSProperties } from 'react'
import type { ReaderNavSnapshot } from '../types'
import type { EpubTypography } from '../lib/epubTypography'
import { EpubTypographyControls } from './EpubTypographyControls'

type Props = {
  expanded: boolean
  onToggle: () => void
  nav: ReaderNavSnapshot
  onPrev: () => void
  onNext: () => void
  onSeekPercent: (percent: number) => void
  autoSpeak: boolean
  onToggleAutoSpeak: () => void
  studyCount: number
  onOpenStudy: () => void
  epubTypography?: EpubTypography
  onEpubTypographyChange?: (next: EpubTypography) => void
}

function formatNavLabel(nav: ReaderNavSnapshot): string {
  const pct = `${nav.percent}%`
  if (nav.totalPages != null && nav.totalPages > 0) {
    return `${nav.page}/${nav.totalPages} · ${pct}`
  }
  if (nav.page > 0) return `${nav.page} · ${pct}`
  return pct
}

export function ReaderDock({
  expanded,
  onToggle,
  nav,
  onPrev,
  onNext,
  onSeekPercent,
  autoSpeak,
  onToggleAutoSpeak,
  studyCount,
  onOpenStudy,
  epubTypography,
  onEpubTypographyChange,
}: Props) {
  const sliderId = useId()
  const [sliderValue, setSliderValue] = useState(nav.percent)

  useEffect(() => {
    setSliderValue(nav.percent)
  }, [nav.percent])

  return (
    <div
      className={`reader-dock${expanded ? ' reader-dock--expanded' : ''}`}
    >
      <button
        type="button"
        className="reader-dock__handle"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label="Ukryj panele"
      >
        <span className="reader-dock__handle-bar" aria-hidden />
      </button>

      {expanded && (
        <div className="reader-dock__tools">
          <button
            type="button"
            className={`reader-dock__tool${autoSpeak ? ' reader-dock__tool--on' : ''}`}
            onClick={onToggleAutoSpeak}
            aria-pressed={autoSpeak}
            title="Czytaj kliknięte słowo"
          >
            <span className="reader-dock__tool-icon" aria-hidden>
              ♪
            </span>
            <span className="reader-dock__tool-label">Czytaj</span>
          </button>

          <button
            type="button"
            className="reader-dock__tool"
            onClick={onOpenStudy}
            title="Słownik — zapisane słówka"
          >
            <span className="reader-dock__tool-icon" aria-hidden>
              あ
            </span>
            <span className="reader-dock__tool-label">Słownik</span>
            {studyCount > 0 && (
              <span className="reader-dock__tool-badge">{studyCount}</span>
            )}
          </button>
        </div>
      )}

      {expanded && epubTypography && onEpubTypographyChange && (
        <EpubTypographyControls
          value={epubTypography}
          onChange={onEpubTypographyChange}
          compact
        />
      )}

      {expanded && (
        <div className="reader-dock__slider-wrap">
          <label className="visually-hidden" htmlFor={sliderId}>
            Postęp czytania
          </label>
          <input
            id={sliderId}
            className="reader-dock__slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={sliderValue}
            onChange={(e) => setSliderValue(Number(e.target.value))}
            onPointerUp={() => onSeekPercent(sliderValue)}
            onKeyUp={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSeekPercent(sliderValue)
            }}
            onBlur={() => onSeekPercent(sliderValue)}
            style={
              {
                '--seek': `${sliderValue}%`,
              } as CSSProperties
            }
          />
        </div>
      )}

      <div className="reader-dock__nav">
        <button
          type="button"
          className="reader-dock__arrow"
          onClick={onPrev}
          disabled={!nav.canPrev}
          aria-label="Poprzednia strona"
        >
          «
        </button>
        <button
          type="button"
          className="reader-dock__status"
          onClick={onToggle}
          aria-label="Ukryj panele"
        >
          {formatNavLabel(nav)}
        </button>
        <button
          type="button"
          className="reader-dock__arrow"
          onClick={onNext}
          disabled={!nav.canNext}
          aria-label="Następna strona"
        >
          »
        </button>
      </div>
    </div>
  )
}
