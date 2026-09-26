import { useCallback, useEffect, useState, type FormEvent } from 'react'

type Mode = 'login' | 'register' | 'forgot' | 'newPassword'

type Props = {
  onClose: () => void
  initialMode?: Mode
  onSignIn: (email: string, password: string) => Promise<void>
  onSignUp: (email: string, password: string) => Promise<void>
  onResetPassword: (email: string) => Promise<void>
  onUpdatePassword: (password: string) => Promise<void>
}

export function AuthModal({
  onClose,
  initialMode = 'login',
  onSignIn,
  onSignUp,
  onResetPassword,
  onUpdatePassword,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setMode(initialMode)
    setError(null)
    setMessage(null)
    setPassword('')
    setPassword2('')
  }, [initialMode])

  const title =
    mode === 'login'
      ? 'Zaloguj się'
      : mode === 'register'
        ? 'Zarejestruj się'
        : mode === 'forgot'
          ? 'Reset hasła'
          : 'Nowe hasło'

  const lead =
    mode === 'forgot'
      ? 'Wyślemy link do zresetowania hasła na Twój email.'
      : mode === 'newPassword'
        ? 'Ustaw nowe hasło do konta.'
        : 'Zapisz do 2 książek, fiszki i postęp czytania w chmurze.'

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
        } else if (mode === 'register') {
          await onSignUp(email.trim(), password)
          setMessage('Konto utworzone. Możesz się zalogować.')
          setMode('login')
          setPassword('')
        } else if (mode === 'forgot') {
          await onResetPassword(email.trim())
          setMessage(
            'Jeśli konto istnieje, wysłaliśmy mail z linkiem. Sprawdź też spam.',
          )
        } else {
          if (password !== password2) {
            throw new Error('Hasła nie są takie same.')
          }
          if (password.length < 6) {
            throw new Error('Hasło musi mieć min. 6 znaków.')
          }
          await onUpdatePassword(password)
          setMessage('Hasło zmienione. Jesteś zalogowany.')
          onClose()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Błąd logowania.')
      } finally {
        setLoading(false)
      }
    },
    [
      email,
      password,
      password2,
      mode,
      onClose,
      onSignIn,
      onSignUp,
      onResetPassword,
      onUpdatePassword,
    ],
  )

  const submitLabel =
    loading
      ? '…'
      : mode === 'login'
        ? 'Zaloguj'
        : mode === 'register'
          ? 'Utwórz konto'
          : mode === 'forgot'
            ? 'Wyślij link'
            : 'Zapisz hasło'

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
          {title}
        </h2>
        <p className="auth-modal__lead">{lead}</p>

        <form className="auth-modal__form" onSubmit={submit}>
          {mode !== 'newPassword' && (
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
          )}

          {(mode === 'login' || mode === 'register' || mode === 'newPassword') && (
            <label className="auth-modal__field">
              <span>{mode === 'newPassword' ? 'Nowe hasło' : 'Hasło'}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
              />
            </label>
          )}

          {mode === 'newPassword' && (
            <label className="auth-modal__field">
              <span>Powtórz hasło</span>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
          )}

          {error && <p className="error-banner auth-modal__error">{error}</p>}
          {message && <p className="auth-modal__success">{message}</p>}

          <button type="submit" className="auth-modal__submit" disabled={loading}>
            {submitLabel}
          </button>
        </form>

        {mode === 'login' && (
          <p className="auth-modal__forgot">
            <button type="button" onClick={() => setMode('forgot')}>
              Nie pamiętam hasła
            </button>
          </p>
        )}

        <p className="auth-modal__switch">
          {mode === 'login' && (
            <>
              Nie masz konta?{' '}
              <button type="button" onClick={() => setMode('register')}>
                Zarejestruj się
              </button>
            </>
          )}
          {mode === 'register' && (
            <>
              Masz konto?{' '}
              <button type="button" onClick={() => setMode('login')}>
                Zaloguj się
              </button>
            </>
          )}
          {(mode === 'forgot' || mode === 'newPassword') && (
            <>
              Wróć do{' '}
              <button type="button" onClick={() => setMode('login')}>
                logowania
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
