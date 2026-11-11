import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Producto } from '../types'

function money(value: number | null): string {
  return value == null ? '—' : value.toFixed(2)
}

export function Productos() {
  const { session, isAdmin, isProveedor } = useAuth()
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeDeleted, setIncludeDeleted] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase
      .from('productos')
      .select('*')
      .order('created_at', { ascending: false })

    if (!(isAdmin && includeDeleted)) {
      query = query.is('deleted_at', null)
    }

    const { data, error: queryError } = await query
    if (queryError) setError(queryError.message)
    else setProductos((data ?? []) as Producto[])
    setLoading(false)
  }, [isAdmin, includeDeleted])

  useEffect(() => {
    void load()
  }, [load])

  async function marcarVendido(producto: Producto) {
    if (!window.confirm(`¿Marcar "${producto.nombre}" como vendido?`)) return
    setError(null)
    const { error: rpcError } = await supabase.rpc('marcar_vendido', { p_id: producto.id })
    if (rpcError) setError(rpcError.message)
    else await load()
  }

  async function eliminar(producto: Producto) {
    if (!window.confirm(`¿Borrar lógicamente "${producto.nombre}"?`)) return
    setError(null)
    const { error: rpcError } = await supabase.rpc('eliminar_producto', { p_id: producto.id })
    if (rpcError) setError(rpcError.message)
    else await load()
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Productos</h1>
          <p className="muted">
            {isAdmin
              ? 'Ves todos los productos, incluidos los pendientes de purga.'
              : isProveedor
                ? 'Ves tus productos y los que un administrador te haya asignado.'
                : 'Ves solo los productos para los que tienes visibilidad.'}
          </p>
        </div>
        <div className="row">
          {isAdmin && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(event) => setIncludeDeleted(event.target.checked)}
              />
              Incluir borrados
            </label>
          )}
          <button onClick={() => void load()} className="secondary">
            Refrescar
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : productos.length === 0 ? (
        <div className="card">
          <p>No hay productos visibles para tu usuario.</p>
          {(isAdmin || isProveedor) && <Link to="/nuevo">Crear el primero</Link>}
        </div>
      ) : (
        <div className="grid">
          {productos.map((producto) => {
            const owner = producto.created_by === session?.user.id
            const canManage = isAdmin || owner
            const disponible = producto.estado === 'disponible' && !producto.deleted_at
            const deleted = Boolean(producto.deleted_at)

            return (
              <article key={producto.id} className={`card product ${deleted ? 'deleted' : ''}`}>
                <div className="row between">
                  <h2>{producto.nombre}</h2>
                  <span className={`status ${producto.estado}`}>{producto.estado}</span>
                </div>

                {producto.descripcion && <p>{producto.descripcion}</p>}
                <p className="muted">Precio: {money(producto.precio)}</p>
                <p className="muted small">
                  Creado {new Date(producto.created_at).toLocaleDateString('es-MX')}
                  {producto.sold_at &&
                    ` · Vendido ${new Date(producto.sold_at).toLocaleDateString('es-MX')}`}
                </p>

                {deleted && <span className="badge danger">borrado lógico</span>}

                <div className="row wrap actions">
                  {disponible && (
                    <button onClick={() => void marcarVendido(producto)}>Marcar vendido</button>
                  )}
                  {canManage && disponible && (
                    <>
                      <Link className="button secondary" to={`/productos/${producto.id}/editar`}>
                        Editar
                      </Link>
                      <button className="secondary" onClick={() => void eliminar(producto)}>
                        Borrar
                      </button>
                    </>
                  )}
                  {canManage && !deleted && (
                    <Link className="button ghost" to={`/productos/${producto.id}/visibilidad`}>
                      Visibilidad
                    </Link>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
