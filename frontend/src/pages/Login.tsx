import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function Login() {
  const { session, signIn } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const result = await signIn(identifier.trim(), password)
    setBusy(false)
    if (result.error) setError(result.error)
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={onSubmit}>
        <h1>
          Showroom <span className="badge beta">beta</span>
        </h1>
        <p className="muted">
          Acceso privado. Sin registro público. Versión beta en pruebas.
        </p>

        <label>
          Correo o usuario
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
          />
        </label>

        <label>
          Contraseña
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPassword ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="muted small">
          Entra con tu usuario o tu correo. El usuario no distingue mayúsculas; la contraseña sí.
          Si no puedes entrar, pide a un administrador que te asigne una contraseña.
        </p>
      </form>
    </div>
  )
}
