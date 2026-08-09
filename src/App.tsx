import { useCallback, useState } from 'react'
import { UploadDropzone } from './components/UploadDropzone'
import { Reader } from './components/Reader'
import { ThemeToggle } from './components/ThemeToggle'
import { useTheme } from './hooks/useTheme'
import type { LoadedBook } from './types'
import './App.css'

function App() {
  const [book, setBook] = useState<LoadedBook | null>(null)
  const { theme, toggleTheme } = useTheme()

  const closeBook = useCallback(() => {
    setBook((prev) => {
      if (prev?.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url)
      return null
    })
  }, [])

  if (book) {
    return (
      <Reader
        book={book}
        onClose={closeBook}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    )
  }

  return (
    <div className="app-home">
      <div className="app-home__theme">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <UploadDropzone onLoad={setBook} />
    </div>
  )
}

export default App
