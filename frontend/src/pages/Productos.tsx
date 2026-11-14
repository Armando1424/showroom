import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useProveedor } from '../proveedor/ProveedorProvider'
import { supabase } from '../lib/supabase'
import type { MetodoPago, Producto } from '../types'

function money(value: number | null): string {
  return value == null ? '—' : value.toFixed(2)
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

type Tab = 'disponible' | 'vendido'

export function Productos() {
  const { session, isAdmin, isProveedor } = useAuth()
  const { proveedorId, requiereSeleccion } = useProveedor()

  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('disponible')
  const [detalle, setDetalle] = useState<Producto | null>(null)
  const [detalleImagen, setDetalleImagen] = useState<string>('')
  const [venta, setVenta] = useState<Producto | null>(null)
  const [vendiendo, setVendiendo] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: queryError } = await supabase
      .from('productos')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (queryError) {
      setError(queryError.message)
      setLoading(false)
      return
    }

    setProductos((data ?? []) as Producto[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // El admin ve todo por RLS; aquí se limita al proveedor elegido.
  const delProveedor = useMemo(() => {
    if (!isAdmin) return productos
    if (!proveedorId) return []
    return productos.filter((producto) => producto.proveedor_id === proveedorId)
  }, [productos, isAdmin, proveedorId])

  const visibles = useMemo(() => {
    const needle = normalize(query)
    const base = delProveedor.filter((producto) =>
      tab === 'vendido' ? producto.estado === 'vendido' : producto.estado === 'disponible',
    )
    if (!needle) return base
    return base.filter((producto) =>
      normalize(`${producto.nombre} ${producto.descripcion ?? ''}`).includes(needle),
    )
  }, [delProveedor, tab, query])

  const conteo = useMemo(
    () => ({
      disponible: delProveedor.filter((p) => p.estado === 'disponible').length,
      vendido: delProveedor.filter((p) => p.estado === 'vendido').length,
    }),
    [delProveedor],
  )

  async function abrirDetalle(producto: Producto) {
    setDetalle(producto)
    setDetalleImagen('')

    if (!producto.imagen_path) return
    const { data: signed } = await supabase.storage
      .from('productos')
      .createSignedUrl(producto.imagen_path, 3600)
    setDetalleImagen(signed?.signedUrl ?? '')
  }

  async function vender(producto: Producto, metodo: MetodoPago) {
    setVendiendo(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('marcar_vendido', {
      p_id: producto.id,
      p_metodo_pago: metodo,
      p_precio: producto.precio,
    })
    setVendiendo(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setVenta(null)
    setDetalle(null)
    await load()
  }

  async function devolver(producto: Producto) {
    if (!window.confirm(`¿Devolver "${producto.nombre}" a disponible?`)) return
    setError(null)
    const { error: rpcError } = await supabase.rpc('devolver_producto', { p_id: producto.id })
    if (rpcError) setError(rpcError.message)
    else {
      setDetalle(null)
      await load()
    }
  }

  if (requiereSeleccion) {
    return (
      <section>
        <h1>Productos</h1>
        <div className="card">
          <p>Elige un proveedor en la barra superior para ver sus productos.</p>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Productos</h1>
          <p className="muted">
            {isAdmin
              ? 'Productos del proveedor seleccionado.'
              : isProveedor
                ? 'Tus productos.'
                : 'Productos de tu proveedor.'}
          </p>
        </div>
        <div className="row">
          <button onClick={() => void load()} className="secondary">
            Refrescar
          </button>
          {(isAdmin || isProveedor) && (
            <Link className="button" to="/nuevo" title="Nuevo producto">
              +
            </Link>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'disponible'}
          className={tab === 'disponible' ? 'tab active' : 'tab'}
          onClick={() => setTab('disponible')}
        >
          Disponibles ({conteo.disponible})
        </button>
        <button
          role="tab"
          aria-selected={tab === 'vendido'}
          className={tab === 'vendido' ? 'tab active' : 'tab'}
          onClick={() => setTab('vendido')}
        >
          Vendidos ({conteo.vendido})
        </button>
      </div>

      <div className="search-bar">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nombre o descripción…"
          aria-label="Buscar productos"
        />
        {query && (
          <button type="button" className="secondary" onClick={() => setQuery('')}>
            Limpiar
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : visibles.length === 0 ? (
        <div className="card">
          <p>
            {tab === 'disponible'
              ? 'No hay productos disponibles.'
              : 'Todavía no hay ventas.'}
          </p>
        </div>
      ) : (
        <ul className="product-list">
          {visibles.map((producto) => {
            const owner = producto.created_by === session?.user.id
            const puedeEditar = isAdmin || owner

            return (
              <li key={producto.id}>
                <button className="product-row" onClick={() => void abrirDetalle(producto)}>
                  <span className="product-row-name">{producto.nombre}</span>
                  <span className="product-row-price">
                    {tab === 'vendido'
                      ? money(producto.precio_venta)
                      : money(producto.precio)}
                  </span>
                  <span className="product-row-meta">
                    {tab === 'vendido'
                      ? `${producto.metodo_pago ?? '—'} · ${new Date(
                          producto.sold_at ?? producto.updated_at,
                        ).toLocaleDateString('es-MX')}`
                      : new Date(producto.created_at).toLocaleDateString('es-MX')}
                  </span>
                  <span className="chevron" aria-hidden>
                    ›
                  </span>
                </button>

                {puedeEditar && tab === 'disponible' && (
                  <Link
                    className="row-edit"
                    to={`/productos/${producto.id}/editar`}
                    title="Editar"
                  >
                    Editar
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {detalle && (
        <div className="modal-backdrop" onClick={() => setDetalle(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>{detalle.nombre}</h2>
              <button className="link" onClick={() => setDetalle(null)} aria-label="Cerrar">
                ✕
              </button>
            </div>

            {detalleImagen ? (
              <img className="detail-img" src={detalleImagen} alt={detalle.nombre} />
            ) : (
              <div className="detail-img placeholder">Sin imagen</div>
            )}

            {detalle.descripcion && <p>{detalle.descripcion}</p>}

            <dl className="detail-grid">
              <dt>Precio</dt>
              <dd>{money(detalle.precio)}</dd>
              <dt>Estado</dt>
              <dd>{detalle.estado}</dd>
              {detalle.estado === 'vendido' && (
                <>
                  <dt>Cobrado</dt>
                  <dd>{money(detalle.precio_venta)}</dd>
                  <dt>Método</dt>
                  <dd>{detalle.metodo_pago ?? '—'}</dd>
                  <dt>Fecha de venta</dt>
                  <dd>
                    {detalle.sold_at
                      ? new Date(detalle.sold_at).toLocaleString('es-MX')
                      : '—'}
                  </dd>
                </>
              )}
            </dl>

            <div className="row wrap">
              {detalle.estado === 'disponible' && (
                <button onClick={() => setVenta(detalle)}>Vender</button>
              )}
              {detalle.estado === 'vendido' && (
                <button className="secondary" onClick={() => void devolver(detalle)}>
                  Devolver
                </button>
              )}
              {(isAdmin || detalle.created_by === session?.user.id) &&
                detalle.estado === 'disponible' && (
                  <Link className="button ghost" to={`/productos/${detalle.id}/editar`}>
                    Editar
                  </Link>
                )}
            </div>
          </div>
        </div>
      )}

      {venta && (
        <div className="modal-backdrop" onClick={() => setVenta(null)}>
          <div className="modal small" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>Cobrar “{venta.nombre}”</h2>
              <button className="link" onClick={() => setVenta(null)} aria-label="Cerrar">
                ✕
              </button>
            </div>

            <p className="muted">
              Importe: <strong>{money(venta.precio)}</strong>
            </p>

            <div className="row wrap">
              <button disabled={vendiendo} onClick={() => void vender(venta, 'efectivo')}>
                Efectivo
              </button>
              <button disabled={vendiendo} onClick={() => void vender(venta, 'tarjeta')}>
                Tarjeta
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
