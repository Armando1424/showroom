import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useProveedor } from '../proveedor/ProveedorProvider'
import { supabase } from '../lib/supabase'
import type { ResumenPeriodo, ResumenVendedor, VentaDetalle } from '../types'

type Rango = 'day' | 'week' | 'month'

const RANGOS: { id: Rango; label: string }[] = [
  { id: 'day', label: 'Hoy' },
  { id: 'week', label: 'Esta semana' },
  { id: 'month', label: 'Este mes' },
]

function money(value: number | null | undefined): string {
  return (value ?? 0).toFixed(2)
}

function inicioDe(rango: Rango): Date {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (rango === 'week') {
    const day = (start.getDay() + 6) % 7 // lunes = 0
    start.setDate(start.getDate() - day)
  } else if (rango === 'month') {
    start.setDate(1)
  }
  return start
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function Dinero() {
  const { isAdmin, isProveedor } = useAuth()
  const { proveedorId, requiereSeleccion } = useProveedor()

  const [rango, setRango] = useState<Rango>('day')
  const [detalle, setDetalle] = useState<VentaDetalle[]>([])
  const [periodos, setPeriodos] = useState<ResumenPeriodo[]>([])
  const [vendedores, setVendedores] = useState<ResumenVendedor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const desde = inicioDe(rango)
    const hasta = new Date()
    const params = {
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
      p_proveedor: proveedorId,
    }

    const [detalleRes, resumenRes] = await Promise.all([
      supabase.rpc('reporte_ventas', params),
      supabase.rpc('resumen_ventas', { ...params, p_granularidad: rango }),
    ])

    if (detalleRes.error) {
      setError(detalleRes.error.message)
      setLoading(false)
      return
    }

    setDetalle((detalleRes.data ?? []) as VentaDetalle[])
    setPeriodos((resumenRes.data ?? []) as ResumenPeriodo[])

    if (isAdmin || isProveedor) {
      const { data: porVendedor } = await supabase.rpc('ventas_por_vendedor', params)
      setVendedores((porVendedor ?? []) as ResumenVendedor[])
    } else {
      setVendedores([])
    }

    setLoading(false)
  }, [rango, proveedorId, isAdmin, isProveedor])

  useEffect(() => {
    if (requiereSeleccion) {
      setLoading(false)
      return
    }
    void load()
  }, [load, requiereSeleccion])

  const activas = useMemo(() => detalle.filter((venta) => !venta.devuelta), [detalle])
  const devueltas = useMemo(() => detalle.filter((venta) => venta.devuelta), [detalle])

  const totales = useMemo(
    () => ({
      efectivo: activas
        .filter((venta) => venta.metodo_pago === 'efectivo')
        .reduce((sum, venta) => sum + Number(venta.monto), 0),
      tarjeta: activas
        .filter((venta) => venta.metodo_pago === 'tarjeta')
        .reduce((sum, venta) => sum + Number(venta.monto), 0),
      ventas: activas.length,
    }),
    [activas],
  )

  function descargarCsv() {
    const header = ['Fecha', 'Producto', 'Vendedor', 'Metodo', 'Monto', 'Devuelta']
    const rows = detalle.map((venta) => [
      new Date(venta.fecha).toLocaleString('es-MX'),
      venta.producto,
      venta.vendedor,
      venta.metodo_pago,
      Number(venta.monto).toFixed(2),
      venta.devuelta ? 'sí' : 'no',
    ])

    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ventas-${rango}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (requiereSeleccion) {
    return (
      <section>
        <h1>Dinero</h1>
        <div className="card">
          <p>Elige un proveedor en la barra superior para ver sus ventas.</p>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Dinero</h1>
          <p className="muted">
            {isAdmin
              ? 'Totales del proveedor seleccionado.'
              : isProveedor
                ? 'Totales de tus productos y de tus vendedores.'
                : 'Solo tus ventas.'}
          </p>
        </div>
        <div className="row">
          <button className="secondary" onClick={descargarCsv} disabled={detalle.length === 0}>
            Descargar CSV
          </button>
          <button onClick={() => void load()} className="secondary">
            Refrescar
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="tabs" role="tablist">
        {RANGOS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={rango === item.id}
            className={rango === item.id ? 'tab active' : 'tab'}
            onClick={() => setRango(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          <div className="totales">
            <div className="total-card">
              <span className="muted small">Tarjeta</span>
              <strong>{money(totales.tarjeta)}</strong>
            </div>
            <div className="total-card">
              <span className="muted small">Efectivo</span>
              <strong>{money(totales.efectivo)}</strong>
            </div>
            <div className="total-card highlight">
              <span className="muted small">Total ({totales.ventas} ventas)</span>
              <strong>{money(totales.tarjeta + totales.efectivo)}</strong>
            </div>
          </div>

          {rango !== 'day' && periodos.length > 0 && (
            <div className="card">
              <h2>Por {rango === 'week' ? 'semana' : 'mes'}</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Periodo</th>
                    <th>Ventas</th>
                    <th>Tarjeta</th>
                    <th>Efectivo</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {periodos.map((periodo) => (
                    <tr key={periodo.periodo}>
                      <td>{new Date(periodo.periodo).toLocaleDateString('es-MX')}</td>
                      <td>{periodo.num_ventas}</td>
                      <td>{money(periodo.total_tarjeta)}</td>
                      <td>{money(periodo.total_efectivo)}</td>
                      <td>{money(periodo.total_general)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <h2>Productos vendidos</h2>
            {detalle.length === 0 ? (
              <p className="muted">No hay ventas en este periodo.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>Vendedor</th>
                    <th>Método</th>
                    <th>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.map((venta) => (
                    <tr key={venta.venta_id} className={venta.devuelta ? 'muted' : undefined}>
                      <td>{new Date(venta.fecha).toLocaleString('es-MX')}</td>
                      <td>{venta.producto}</td>
                      <td>{venta.vendedor}</td>
                      <td>{venta.metodo_pago}</td>
                      <td>
                        {money(venta.monto)}
                        {venta.devuelta && <span className="badge danger">devuelta</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Total efectivo</td>
                    <td>{money(totales.efectivo)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4}>Total tarjeta</td>
                    <td>{money(totales.tarjeta)}</td>
                  </tr>
                  <tr className="strong">
                    <td colSpan={4}>Suma</td>
                    <td>{money(totales.efectivo + totales.tarjeta)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
            {devueltas.length > 0 && (
              <p className="muted small">
                {devueltas.length} venta(s) devuelta(s) no cuentan en los totales.
              </p>
            )}
          </div>

          {(isAdmin || isProveedor) && (
            <div className="card">
              <h2>Por vendedor</h2>
              {vendedores.length === 0 ? (
                <p className="muted">Sin ventas por vendedor en este periodo.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th>Ventas</th>
                      <th>Tarjeta</th>
                      <th>Efectivo</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendedores.map((vendedor) => (
                      <tr key={vendedor.vendedor_id}>
                        <td>{vendedor.nombre}</td>
                        <td>{vendedor.num_ventas}</td>
                        <td>{money(vendedor.total_tarjeta)}</td>
                        <td>{money(vendedor.total_efectivo)}</td>
                        <td>{money(vendedor.total_general)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
