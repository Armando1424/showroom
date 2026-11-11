import type { ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import type { Rol } from '../types'

export function RequireAuth() {
  const { session, profile, loading, profileLoading, signOut, refresh } = useAuth()

  if (loading || profileLoading) {
    return <div className="center muted">Cargando…</div>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!profile) {
    return (
      <div className="center">
        <div className="card narrow">
          <h2>Perfil no disponible</h2>
          <p className="muted">
            Tu usuario existe en Auth pero el perfil aún no está creado. Reintenta en unos segundos.
          </p>
          <div className="row">
            <button onClick={() => void refresh()}>Reintentar</button>
            <button className="secondary" onClick={() => void signOut()}>
              Salir
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!profile.activo) {
    return (
      <div className="center">
        <div className="card narrow">
          <h2>Cuenta pendiente de activación</h2>
          <p className="muted">
            Un administrador debe activar tu cuenta y asignarte un rol antes de que puedas ver productos.
          </p>
          <button className="secondary" onClick={() => void signOut()}>
            Salir
          </button>
        </div>
      </div>
    )
  }

  return <Outlet />
}

export function RequireRole({ roles, children }: { roles: Rol[]; children: ReactNode }) {
  const { roles: current } = useAuth()

  if (!roles.some((rol) => current.includes(rol))) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
