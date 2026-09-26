import { useCallback, useEffect, useState } from 'react'
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
  const {
    user,
    loading: authLoading,
    configured,
    passwordRecovery,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    clearPasswordRecovery,
  } = useAuth()

  useEffect(() => {
    if (passwordRecovery) {
      setAuthOpen(true)
    }
  }, [passwordRecovery])

  const closeBook = useCallback(() => {
    setBook((prev) => {
      if (prev?.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url)
      return null
    })
  }, [])

  const openBook = useCallback((loaded: LoadedBook) => {
    setBook(loaded)
  }, [])

  const closeAuth = useCallback(() => {
    setAuthOpen(false)
    clearPasswordRecovery()
  }, [clearPasswordRecovery])

  if (book && !passwordRecovery) {
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
      <div className="app-home__bg" aria-hidden="true">
        <video
          className="app-home__bg-video"
          src={`${import.meta.env.BASE_URL}images/home-bg.mp4`}
          poster={`${import.meta.env.BASE_URL}images/home-bg.png`}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
        <div className="app-home__bg-veil" />
      </div>
      <div className="app-home__bar">
        {configured && !authLoading && (
          <div className="app-home__auth">
            {user && !passwordRecovery ? (
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

      {user && !passwordRecovery && <LibraryPanel onOpenBook={openBook} />}

      {authOpen && (
        <AuthModal
          onClose={closeAuth}
          initialMode={passwordRecovery ? 'newPassword' : 'login'}
          onSignIn={signIn}
          onSignUp={signUp}
          onResetPassword={resetPassword}
          onUpdatePassword={updatePassword}
        />
      )}
    </div>
  )
}

export default App
