import { useCallback, useState, type FormEvent } from 'react'

type Mode = 'login' | 'register'

type Props = {
  onClose: () => void
  onSignIn: (email: string, password: string) => Promise<void>
  onSignUp: (email: string, password: string) => Promise<void>
}

export function AuthModal({ onClose, onSignIn, onSignUp }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)
      setMessage(null)
      setLoading(true)
      try {
        if (mode === 'login') {
          await onSignIn(email.trim(), password)
          onClose()
        } else {
          await onSignUp(email.trim(), password)
          setMessage('Konto utworzone. Możesz się zalogować.')
          setMode('login')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Błąd logowania.')
      } finally {
        setLoading(false)
      }
    },
    [email, password, mode, onClose, onSignIn, onSignUp],
  )

  return (
    <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button
        type="button"
        className="auth-modal__backdrop"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="auth-modal__card">
        <button type="button" className="auth-modal__close" onClick={onClose} aria-label="Zamknij">
          ✕
        </button>
        <h2 id="auth-title" className="auth-modal__title">
          {mode === 'login' ? 'Zaloguj się' : 'Zarejestruj się'}
        </h2>
        <p className="auth-modal__lead">
          Zapisz do 2 książek, fiszki i postęp czytania w chmurze.
        </p>

        <form className="auth-modal__form" onSubmit={submit}>
          <label className="auth-modal__field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="auth-modal__field">
            <span>Hasło</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className="error-banner auth-modal__error">{error}</p>}
          {message && <p className="auth-modal__success">{message}</p>}

          <button type="submit" className="auth-modal__submit" disabled={loading}>
            {loading ? '…' : mode === 'login' ? 'Zaloguj' : 'Utwórz konto'}
          </button>
        </form>

        <p className="auth-modal__switch">
          {mode === 'login' ? (
            <>
              Nie masz konta?{' '}
              <button type="button" onClick={() => setMode('register')}>
                Zarejestruj się
              </button>
            </>
          ) : (
            <>
              Masz konto?{' '}
              <button type="button" onClick={() => setMode('login')}>
                Zaloguj się
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
