import { useCallback, useEffect, useState } from 'react'
import {
  applyTheme,
  loadTheme,
  saveTheme,
  type Theme,
} from '../lib/theme'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = loadTheme()
    applyTheme(initial)
    return initial
  })

  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === 'light' ? 'dark' : 'light'))
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
  }, [])

  return { theme, setTheme, toggleTheme }
}
