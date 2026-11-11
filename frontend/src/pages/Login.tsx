import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function Login() {
  const { session, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const result = await signIn(email.trim(), password)
    setBusy(false)
    if (result.error) setError(result.error)
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={onSubmit}>
        <h1>Showroom</h1>
        <p className="muted">Acceso privado. Sin registro público.</p>

        <label>
          Correo
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="muted small">
          El acceso es por invitación. Si no puedes entrar, pide a un administrador que active tu
          cuenta.
        </p>
      </form>
    </div>
  )
}
