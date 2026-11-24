import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { useProveedor } from '../proveedor/ProveedorProvider'
import type { Profile, Rol, UserRole } from '../types'

const ROLES: Rol[] = ['admin', 'proveedor', 'vendedor']

export function AdminUsuarios() {
  const { isAdmin } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [roles, setRoles] = useState<UserRole[]>([])
  const [drafts, setDrafts] = useState<Record<string, Rol>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [newEmail, setNewEmail] = useState('')
  const [newNombre, setNewNombre] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [rolesNuevo, setRolesNuevo] = useState<'ambos' | 'proveedor' | 'vendedor'>('ambos')
  const [proveedorNuevo, setProveedorNuevo] = useState('')
  const { proveedores } = useProveedor()
  const [createError, setCreateError] = useState<string | null>(null)
  const [createMessage, setCreateMessage] = useState<string | null>(null)

  async function functionErrorMessage(error: unknown): Promise<string> {
    let message = error instanceof Error ? error.message : 'Error inesperado.'
    const context = (error as { context?: Response }).context
    if (context) {
      try {
        const payload = (await context.json()) as { error?: string }
        if (payload?.error) message = payload.error
      } catch {
        // Sin cuerpo JSON.
      }
    }
    return message
  }

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

  async function asignarProveedor(userId: string, proveedorId: string) {
    setError(null)
    const { error: rpcError } = await supabase.rpc('asignar_proveedor', {
      p_user: userId,
      p_proveedor: proveedorId || null,
    })
    if (rpcError) setError(rpcError.message)
    else await load()
  }

  async function crearUsuario(event: FormEvent) {
    event.preventDefault()
    setCreateError(null)
    setCreateMessage(null)

    const username = newUsername.trim().toLowerCase()
    if (!/^[a-z0-9._-]{2,30}$/.test(username)) {
      setCreateError(
        'El usuario es obligatorio y debe tener entre 2 y 30 caracteres: letras, números, punto, guion o guion bajo.',
      )
      return
    }

    if (!newEmail.trim()) {
      setCreateError('El correo de contacto es obligatorio.')
      return
    }

    if (newPassword.length < 8) {
      setCreateError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    if (rolesNuevo === 'vendedor' && !proveedorNuevo) {
      setCreateError('Si el usuario es solo vendedor, indica a qué proveedor pertenece.')
      return
    }

    setCreating(true)
    const authEmail = `${username}@showroom.local`
    const { data: creado, error: invokeError } = await supabase.functions.invoke('admin-users', {
      body: {
        email: authEmail,
        nombre: newNombre.trim(),
        password: newPassword,
      },
    })

    if (invokeError) {
      setCreateError(await functionErrorMessage(invokeError))
      setCreating(false)
      return
    }

    const creadoId = (creado as { user_id?: string } | null)?.user_id ?? null
    if (creadoId) {
      const rolesAAsignar =
        rolesNuevo === 'ambos' ? ['proveedor', 'vendedor'] : [rolesNuevo]

      for (const rol of rolesAAsignar) {
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({ user_id: creadoId, rol })
        if (roleError) setCreateError(`Usuario creado, pero no se pudo asignar ${rol}: ${roleError.message}`)
      }

      if (rolesNuevo === 'vendedor' && proveedorNuevo) {
        const { error: assignError } = await supabase.rpc('asignar_proveedor', {
          p_user: creadoId,
          p_proveedor: proveedorNuevo,
        })
        if (assignError) setCreateError(`Usuario creado, pero no se pudo asignar el proveedor: ${assignError.message}`)
      }

      // El correo real es de contacto: el login usa <usuario>@showroom.local.
      const { error: emailError } = await supabase
        .from('profiles')
        .update({ email: newEmail.trim().toLowerCase() })
        .eq('id', creadoId)
      if (emailError) {
        setCreateError(
          `Usuario creado, pero no se pudo guardar el correo de contacto: ${emailError.message}`,
        )
      }
    }

    setCreateMessage(
      `Usuario @${username} creado con roles: ${
        rolesNuevo === 'ambos' ? 'proveedor, vendedor' : rolesNuevo
      }. Entra con el usuario y la contraseña.`,
    )
    setNewEmail('')
    setNewNombre('')
    setNewUsername('')
    setNewPassword('')
    setProveedorNuevo('')
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
          Se crea confirmado. Entra con el usuario; el correo es solo de contacto.
        </p>

        <label>
          Usuario
          <input
            value={newUsername}
            onChange={(event) => setNewUsername(event.target.value)}
            placeholder="ej. will"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <span className="muted small">No distingue mayúsculas. Es el login.</span>
        </label>

        <label>
          Nombre
          <input
            value={newNombre}
            onChange={(event) => setNewNombre(event.target.value)}
            placeholder="Nombre visible"
          />
        </label>

        <label>
          Correo de contacto
          <input
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            required
          />
          <span className="muted small">Solo lo ve el admin; no es el login.</span>
        </label>

        <label>
          Roles
          <select
            value={rolesNuevo}
            onChange={(event) =>
              setRolesNuevo(event.target.value as 'ambos' | 'proveedor' | 'vendedor')
            }
          >
            <option value="ambos">Proveedor + vendedor (por defecto)</option>
            <option value="proveedor">Solo proveedor</option>
            <option value="vendedor">Solo vendedor</option>
          </select>
        </label>

        {rolesNuevo === 'vendedor' && (
          <label>
            Proveedor asignado
            <select
              value={proveedorNuevo}
              onChange={(event) => setProveedorNuevo(event.target.value)}
              required
            >
              <option value="">— elegir —</option>
              {proveedores.map((proveedor) => (
                <option key={proveedor.id} value={proveedor.id}>
                  {proveedor.nombre || 'sin nombre'}
                  {proveedor.email ? ` — ${proveedor.email}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

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

        {createError && <p className="error">{createError}</p>}
        {createMessage && <p className="muted">{createMessage}</p>}

        <div className="row">
          <button type="submit" disabled={creating}>
            {creating ? 'Creando…' : 'Crear usuario'}
          </button>
        </div>

        <p className="muted small">
          Requiere la Edge Function <code>admin-users</code> desplegada.
        </p>
      </form>

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
                  <select
                    value={profile.proveedor_id ?? ''}
                    onChange={(event) => void asignarProveedor(profile.id, event.target.value)}
                    title="Proveedor asignado"
                  >
                    <option value="">sin proveedor</option>
                    {proveedores.map((proveedor) => (
                      <option key={proveedor.id} value={proveedor.id}>
                        {proveedor.nombre || 'sin nombre'}
                        {proveedor.email ? ` — ${proveedor.email}` : ''}
                      </option>
                    ))}
                  </select>
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
