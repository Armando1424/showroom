import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Profile, Rol, UserRole } from '../types'

const ROLES: Rol[] = ['admin', 'proveedor', 'vendedor']

export function AdminUsuarios() {
  const { isAdmin } = useAuth()
  const projectRef = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]
  const dashboardUsersUrl = `https://supabase.com/dashboard/project/${projectRef}/auth/users`
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [roles, setRoles] = useState<UserRole[]>([])
  const [drafts, setDrafts] = useState<Record<string, Rol>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [newEmail, setNewEmail] = useState('')
  const [newNombre, setNewNombre] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'invite'>('password')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createMessage, setCreateMessage] = useState<string | null>(null)

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

  async function crearUsuario(event: FormEvent) {
    event.preventDefault()
    setCreateError(null)
    setCreateMessage(null)

    if (!newEmail.trim()) {
      setCreateError('El correo es obligatorio.')
      return
    }

    if (mode === 'password' && newPassword.length < 8) {
      setCreateError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    setCreating(true)
    const { error: invokeError } = await supabase.functions.invoke('admin-users', {
      body: {
        email: newEmail.trim(),
        nombre: newNombre.trim(),
        password: mode === 'password' ? newPassword : undefined,
      },
    })

    if (invokeError) {
      let message = invokeError.message
      const context = (invokeError as { context?: Response }).context
      if (context) {
        try {
          const payload = await context.json()
          if (payload?.error) message = String(payload.error)
        } catch {
          // Sin cuerpo JSON; se queda el mensaje original.
        }
      }
      setCreateError(message)
      setCreating(false)
      return
    }

    setCreateMessage(
      mode === 'password'
        ? `Usuario ${newEmail.trim()} creado. Actívalo y asígnale un rol.`
        : `Invitación enviada a ${newEmail.trim()}.`,
    )
    setNewEmail('')
    setNewNombre('')
    setNewPassword('')
    setCreating(false)
    await load()
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Usuarios</h1>
          <p className="muted">
            Agrega usuarios, actívalos y asigna roles.
          </p>
        </div>
        <button className="secondary" onClick={() => void load()}>
          Refrescar
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <form className="card form" onSubmit={crearUsuario}>
        <h2>Agregar usuario</h2>
        <p className="muted">
          Se crea en Supabase Auth y queda pendiente. Después actívalo y asígnale un rol.
        </p>

        <label>
          Correo
          <input
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            required
          />
        </label>

        <label>
          Nombre
          <input
            value={newNombre}
            onChange={(event) => setNewNombre(event.target.value)}
            placeholder="Nombre visible"
          />
        </label>

        <div className="row wrap">
          <label className="inline">
            <input
              type="radio"
              name="modo"
              checked={mode === 'password'}
              onChange={() => setMode('password')}
            />
            Crear con contraseña
          </label>
          <label className="inline">
            <input
              type="radio"
              name="modo"
              checked={mode === 'invite'}
              onChange={() => setMode('invite')}
            />
            Invitar por correo
          </label>
        </div>

        {mode === 'password' && (
          <label>
            Contraseña
            <input
              type="password"
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
        )}

        {createError && <p className="error">{createError}</p>}
        {createMessage && <p className="muted">{createMessage}</p>}

        <div className="row">
          <button type="submit" disabled={creating}>
            {creating
              ? 'Creando…'
              : mode === 'password'
                ? 'Crear usuario'
                : 'Enviar invitación'}
          </button>
        </div>

        <p className="muted small">
          Requiere la Edge Function <code>admin-users</code> desplegada. Si no está, usa la
          alternativa del Dashboard.
        </p>
      </form>

      <div className="card">
        <h2>Alternativa: Dashboard</h2>
        <p className="muted">
          Si la Edge Function no está desplegada, invita desde Supabase y vuelve a Refrescar.
        </p>
        <a className="button secondary" href={dashboardUsersUrl} target="_blank" rel="noreferrer">
          Abrir invitaciones en Supabase
        </a>
      </div>

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
