import { useCallback, useState } from 'react'
import { UploadDropzone } from './components/UploadDropzone'
import { Reader } from './components/Reader'
import { ThemeToggle } from './components/ThemeToggle'
import { AuthModal } from './components/AuthModal'
import { LibraryPanel } from './components/LibraryPanel'
import { useTheme } from './hooks/useTheme'
import { useAuth } from './hooks/useAuth'
import type { LoadedBook } from './types'
import './App.css'

function App() {
  const [book, setBook] = useState<LoadedBook | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const { user, loading: authLoading, configured, signIn, signUp, signOut } = useAuth()

  const closeBook = useCallback(() => {
    setBook((prev) => {
      if (prev?.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url)
      return null
    })
  }, [])

  const openBook = useCallback((loaded: LoadedBook) => {
    setBook(loaded)
  }, [])

  if (book) {
    return (
      <Reader
        book={book}
        onClose={closeBook}
        theme={theme}
        onToggleTheme={toggleTheme}
        userId={user?.id}
      />
    )
  }

  return (
    <div className="app-home">
      <div className="app-home__bar">
        {configured && !authLoading && (
          <div className="app-home__auth">
            {user ? (
              <>
                <span className="app-home__user" title={user.email ?? ''}>
                  {user.email}
                </span>
                <button type="button" className="app-home__auth-btn" onClick={() => signOut()}>
                  Wyloguj
                </button>
              </>
            ) : (
              <button
                type="button"
                className="app-home__auth-btn app-home__auth-btn--primary"
                onClick={() => setAuthOpen(true)}
              >
                Zaloguj / Zarejestruj
              </button>
            )}
          </div>
        )}
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>

      <UploadDropzone onLoad={openBook} />

      {user && <LibraryPanel onOpenBook={openBook} />}

      {authOpen && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          onSignIn={signIn}
          onSignUp={signUp}
        />
      )}
    </div>
  )
}

export default App
