import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Producto } from '../types'

export function ProductoFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const { isAdmin, isProveedor, session } = useAuth()
  const navigate = useNavigate()

  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precio, setPrecio] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notAllowed, setNotAllowed] = useState(false)

  useEffect(() => {
    if (!id) return

    let active = true
    setLoading(true)

    void (async () => {
      const { data, error: queryError } = await supabase
        .from('productos')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (!active) return

      if (queryError || !data) {
        setError(queryError?.message ?? 'Producto no encontrado')
        setLoading(false)
        return
      }

      const producto = data as Producto
      if (!(isAdmin || producto.created_by === session?.user.id)) {
        setNotAllowed(true)
        setLoading(false)
        return
      }

      setNombre(producto.nombre)
      setDescripcion(producto.descripcion ?? '')
      setPrecio(producto.precio == null ? '' : String(producto.precio))
      setLoading(false)
    })()

    return () => {
      active = false
    }
  }, [id, isAdmin, session?.user.id])

  if (!isEdit && !isAdmin && !isProveedor) {
    return <Navigate to="/" replace />
  }

  if (notAllowed) {
    return (
      <div className="card">
        <h2>No autorizado</h2>
        <p className="muted">Solo el creador del producto o un administrador puede editarlo.</p>
        <Link to="/">Volver</Link>
      </div>
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const name = nombre.trim()
    if (!name) {
      setError('El nombre es obligatorio.')
      return
    }

    const price = precio.trim() === '' ? null : Number(precio)
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setError('El precio debe ser un número mayor o igual a 0.')
      return
    }

    setSaving(true)
    const description = descripcion.trim() || null

    if (isEdit && id) {
      const { error: rpcError } = await supabase.rpc('actualizar_producto', {
        p_id: id,
        p_nombre: name,
        p_descripcion: description,
        p_precio: price,
      })

      if (rpcError) {
        setError(rpcError.message)
        setSaving(false)
        return
      }
    } else {
      const { error: insertError } = await supabase.from('productos').insert({
        nombre: name,
        descripcion: description,
        precio: price,
      })

      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }
    }

    navigate('/')
  }

  if (loading) return <p className="muted">Cargando…</p>

  return (
    <section>
      <div className="page-head">
        <h1>{isEdit ? 'Editar producto' : 'Nuevo producto'}</h1>
        <Link to="/">Volver</Link>
      </div>

      <form className="card form" onSubmit={onSubmit}>
        <label>
          Nombre
          <input
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
            maxLength={200}
            required
          />
        </label>

        <label>
          Descripción
          <textarea
            value={descripcion}
            onChange={(event) => setDescripcion(event.target.value)}
            rows={4}
            maxLength={2000}
          />
        </label>

        <label>
          Precio (opcional)
          <input
            type="number"
            min="0"
            step="0.01"
            value={precio}
            onChange={(event) => setPrecio(event.target.value)}
            placeholder="Sin precio"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="row">
          <button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear producto'}
          </button>
          <Link className="button secondary" to="/">
            Cancelar
          </Link>
        </div>

        {isEdit && (
          <p className="muted small">
            Solo se actualizan nombre, descripción y precio. Un producto vendido o borrado no se puede
            editar.
          </p>
        )}
      </form>
    </section>
  )
}
