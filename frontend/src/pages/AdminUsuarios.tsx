import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Profile, Rol, UserRole } from '../types'

const ROLES: Rol[] = ['admin', 'proveedor', 'vendedor']

export function AdminUsuarios() {
  const { isAdmin } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [roles, setRoles] = useState<UserRole[]>([])
  const [drafts, setDrafts] = useState<Record<string, Rol>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (profileError) {
      setError(profileError.message)
      setLoading(false)
      return
    }

    const { data: roleData, error: roleError } = await supabase.from('user_roles').select('*')

    if (roleError) setError(roleError.message)
    else setRoles((roleData ?? []) as UserRole[])

    setProfiles((profileData ?? []) as Profile[])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  if (!isAdmin) return <Navigate to="/" replace />

  async function toggleActivo(profile: Profile) {
    setError(null)
    const { data, error: updateError } = await supabase
      .from('profiles')
      .update({ activo: !profile.activo })
      .eq('id', profile.id)
      .select('id')

    if (updateError) setError(updateError.message)
    else if (!data || data.length === 0) setError('No se pudo actualizar el usuario.')
    else await load()
  }

  async function addRole(userId: string) {
    setError(null)
    const rol = drafts[userId] ?? 'vendedor'
    const { error: insertError } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, rol })

    if (insertError) setError(insertError.message)
    else await load()
  }

  async function removeRole(role: UserRole) {
    setError(null)
    const { error: deleteError } = await supabase.from('user_roles').delete().eq('id', role.id)

    if (deleteError) setError(deleteError.message)
    else await load()
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Usuarios</h1>
          <p className="muted">
            Activa cuentas y asigna roles. Las invitaciones se envían desde el Dashboard de Supabase.
          </p>
        </div>
        <button className="secondary" onClick={() => void load()}>
          Refrescar
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : (
        <div className="grid">
          {profiles.map((profile) => {
            const userRoles = roles.filter((role) => role.user_id === profile.id)

            return (
              <article key={profile.id} className="card">
                <div className="row between">
                  <div>
                    <h2>{profile.nombre}</h2>
                    <p className="muted small">{profile.email ?? 'sin email'}</p>
                  </div>
                  <span className={`status ${profile.activo ? 'disponible' : 'vendido'}`}>
                    {profile.activo ? 'activo' : 'pendiente'}
                  </span>
                </div>

                <div className="row wrap roles">
                  {userRoles.length === 0 && <span className="muted small">Sin roles</span>}
                  {userRoles.map((role) => (
                    <span key={role.id} className="badge role">
                      {role.rol}
                      <button
                        className="chip-x"
                        title="Quitar rol"
                        onClick={() => void removeRole(role)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <div className="row wrap">
                  <select
                    value={drafts[profile.id] ?? 'vendedor'}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [profile.id]: event.target.value as Rol,
                      }))
                    }
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <button className="secondary" onClick={() => void addRole(profile.id)}>
                    Añadir rol
                  </button>
                  <button
                    className={profile.activo ? 'danger' : ''}
                    onClick={() => void toggleActivo(profile)}
                  >
                    {profile.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <p className="muted small">
        Reglas: no se puede desactivar ni quitar el rol al último administrador activo. Un usuario
        inactivo no ve productos aunque tenga visibilidad.
      </p>
    </section>
  )
}
