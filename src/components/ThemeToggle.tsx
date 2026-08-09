import type { Theme } from '../lib/theme'

type Props = {
  theme: Theme
  onToggle: () => void
}

export function ThemeToggle({ theme, onToggle }: Props) {
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      title={isDark ? 'Tryb jasny' : 'Tryb ciemny'}
      aria-label={isDark ? 'Włącz tryb jasny' : 'Włącz tryb ciemny'}
    >
      {isDark ? 'Jasny' : 'Ciemny'}
    </button>
  )
}
