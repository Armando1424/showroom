import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Producto, ProductVisibility, Rol } from '../types'

interface PerfilResumen {
  id: string
  nombre: string
  email: string | null
  activo: boolean
}

const ROLES_OTORGABLES: Rol[] = ['vendedor', 'proveedor']

export function Visibilidad() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin, session } = useAuth()

  const [producto, setProducto] = useState<Producto | null>(null)
  const [items, setItems] = useState<ProductVisibility[]>([])
  const [perfiles, setPerfiles] = useState<PerfilResumen[]>([])
  const [targetType, setTargetType] = useState<'user' | 'rol'>('user')
  const [userId, setUserId] = useState('')
  const [rol, setRol] = useState<Rol>('vendedor')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notAllowed, setNotAllowed] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const { data: productData, error: productError } = await supabase
      .from('productos')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (productError || !productData) {
      setError(productError?.message ?? 'Producto no encontrado')
      setLoading(false)
      return
    }

    const current = productData as Producto
    if (!(isAdmin || current.created_by === session?.user.id)) {
      setNotAllowed(true)
      setLoading(false)
      return
    }
    setProducto(current)

    const { data: visibilityData, error: visibilityError } = await supabase
      .from('product_visibility')
      .select('*')
      .eq('producto_id', id)
      .order('granted_at', { ascending: false })

    if (visibilityError) setError(visibilityError.message)
    else setItems((visibilityData ?? []) as ProductVisibility[])

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, nombre, email, activo')
      .order('nombre')

    if (profileError) setError(profileError.message)
    else setPerfiles((profileData ?? []) as PerfilResumen[])

    setLoading(false)
  }, [id, isAdmin, session?.user.id])

  useEffect(() => {
    void load()
  }, [load])

  async function agregar() {
    if (!id) return
    setError(null)

    if (targetType === 'user' && !userId) {
      setError('Selecciona un usuario.')
      return
    }

    const { error: insertError } =
      targetType === 'user'
        ? await supabase
            .from('product_visibility')
            .insert({ producto_id: id, user_id: userId, rol: null })
        : await supabase
            .from('product_visibility')
            .insert({ producto_id: id, user_id: null, rol })
    if (insertError) setError(insertError.message)
    else await load()
  }

  async function revocar(item: ProductVisibility) {
    setError(null)
    const { error: deleteError } = await supabase
      .from('product_visibility')
      .delete()
      .eq('id', item.id)

    if (deleteError) setError(deleteError.message)
    else await load()
  }

  function targetLabel(item: ProductVisibility): string {
    if (item.user_id) {
      const perfil = perfiles.find((candidate) => candidate.id === item.user_id)
      if (!perfil) return item.user_id
      return `${perfil.nombre}${perfil.email ? ` (${perfil.email})` : ''}${
        perfil.activo ? '' : ' — inactivo'
      }`
    }
    return `rol: ${item.rol}`
  }

  if (notAllowed) {
    return (
      <div className="card">
        <h2>No autorizado</h2>
        <p className="muted">Solo el creador del producto o un administrador gestiona la visibilidad.</p>
        <Link to="/">Volver</Link>
      </div>
    )
  }

  if (loading) return <p className="muted">Cargando…</p>

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Visibilidad</h1>
          <p className="muted">{producto?.nombre}</p>
        </div>
        <Link to="/">Volver</Link>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card form">
        <h2>Otorgar acceso</h2>
        <div className="row wrap">
          <label className="inline">
            <input
              type="radio"
              name="target"
              checked={targetType === 'user'}
              onChange={() => setTargetType('user')}
            />
            Usuario
          </label>
          <label className="inline">
            <input
              type="radio"
              name="target"
              checked={targetType === 'rol'}
              onChange={() => setTargetType('rol')}
            />
            Rol
          </label>
        </div>

        {targetType === 'user' ? (
          <label>
            Usuario
            <select value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">Selecciona…</option>
              {perfiles.map((perfil) => (
                <option key={perfil.id} value={perfil.id}>
                  {perfil.nombre}
                  {perfil.email ? ` (${perfil.email})` : ''}
                  {perfil.activo ? '' : ' — inactivo'}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Rol
            <select value={rol} onChange={(event) => setRol(event.target.value as Rol)}>
              {ROLES_OTORGABLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}

        <button onClick={() => void agregar()}>Otorgar</button>
        <p className="muted small">
          La lista es default-deny: si no hay una fila aquí, el producto no es visible (salvo para el
          creador y el admin).
        </p>
      </div>

      <div className="card">
        <h2>Accesos actuales</h2>
        {items.length === 0 ? (
          <p className="muted">Sin accesos explícitos.</p>
        ) : (
          <ul className="list">
            {items.map((item) => (
              <li key={item.id} className="row between">
                <span>{targetLabel(item)}</span>
                <button className="secondary" onClick={() => void revocar(item)}>
                  Revocar
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Revocar es eliminar la fila; el efecto es inmediato.</p>
      </div>
    </section>
  )
}
