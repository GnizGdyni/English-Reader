import './lib/polyfills.ts'
import { Component, type ErrorInfo, type ReactNode, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crash:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: 480 }}>
          <h1 style={{ fontSize: '1.25rem' }}>Coś poszło nie tak</h1>
          <p style={{ color: '#666', wordBreak: 'break-word' }}>
            {this.state.error.message}
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Odśwież stronę
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
