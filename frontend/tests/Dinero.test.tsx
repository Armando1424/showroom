import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dinero } from '../src/pages/Dinero'
import type { ResumenPeriodo, ResumenVendedor, VentaDetalle } from '../src/types'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { isAdmin: false, isProveedor: true },
  proveedor: { proveedorId: 'prov1' as string | null, requiereSeleccion: false },
}))

vi.mock('../src/lib/supabase', () => ({
  supabase: { rpc: mocks.rpc },
}))

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('../src/proveedor/ProveedorProvider', () => ({
  useProveedor: () => mocks.proveedor,
}))

const ventas: VentaDetalle[] = [
  {
    venta_id: 'v1',
    fecha: '2026-11-01T10:00:00Z',
    producto: 'Café',
    vendedor: 'Will',
    metodo_pago: 'efectivo',
    monto: 100,
    devuelta: false,
  },
  {
    venta_id: 'v2',
    fecha: '2026-11-02T10:00:00Z',
    producto: 'Taza',
    vendedor: 'Will',
    metodo_pago: 'tarjeta',
    monto: 50,
    devuelta: false,
  },
  {
    venta_id: 'v3',
    fecha: '2026-11-03T10:00:00Z',
    producto: 'Plato',
    vendedor: 'Will',
    metodo_pago: 'efectivo',
    monto: 30,
    devuelta: true,
  },
]

const periodos: ResumenPeriodo[] = [
  {
    periodo: '2026-11-01',
    num_ventas: 2,
    total_efectivo: 100,
    total_tarjeta: 50,
    total_general: 150,
  },
]

const vendedores: ResumenVendedor[] = [
  {
    vendedor_id: 'u1',
    nombre: 'Will',
    num_ventas: 2,
    total_efectivo: 100,
    total_tarjeta: 50,
    total_general: 150,
  },
]

describe('Dinero', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    Object.assign(mocks.auth, { isAdmin: false, isProveedor: true })
    Object.assign(mocks.proveedor, { proveedorId: 'prov1', requiereSeleccion: false })
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'reporte_ventas') return { data: ventas, error: null }
      if (name === 'resumen_ventas') return { data: periodos, error: null }
      if (name === 'ventas_por_vendedor') return { data: vendedores, error: null }
      return { data: [], error: null }
    })
  })

  it('muestra totales, devoluciones, periodos y desglose por vendedor', async () => {
    render(<Dinero />)

    expect(await screen.findByText('Productos vendidos')).toBeInTheDocument()
    expect(screen.getAllByText('150.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('100.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('50.00').length).toBeGreaterThan(0)
    expect(screen.getByText('Por mes')).toBeInTheDocument()
    expect(screen.getAllByText('Will').length).toBeGreaterThan(0)
    expect(screen.getByText('devuelta')).toBeInTheDocument()
    expect(screen.getByText(/1 venta\(s\) devuelta\(s\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descargar CSV' })).toBeEnabled()
  })

  it('cambia a Hoy y descarga el CSV', async () => {
    const user = userEvent.setup()
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<Dinero />)
    await screen.findByText('Productos vendidos')

    await user.click(screen.getByRole('button', { name: 'Descargar CSV' }))
    expect(createObjectUrl).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: 'Hoy' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'resumen_ventas',
        expect.objectContaining({ p_granularidad: 'day' }),
      ),
    )
    await waitFor(() => expect(screen.queryByText('Por mes')).not.toBeInTheDocument())
  })

  it('muestra el error del reporte de ventas', async () => {
    mocks.rpc.mockImplementation((name: string) =>
      name === 'reporte_ventas'
        ? { data: null, error: { message: 'reporte falló' } }
        : { data: [], error: null },
    )

    render(<Dinero />)

    expect(await screen.findByText('reporte falló')).toBeInTheDocument()
  })

  it('pide proveedor al admin y no consulta ventas', async () => {
    mocks.proveedor.requiereSeleccion = true

    render(<Dinero />)

    expect(
      await screen.findByText('Elige un proveedor en la barra superior para ver sus ventas.'),
    ).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('para un vendedor no consulta el desglose por vendedor', async () => {
    Object.assign(mocks.auth, { isAdmin: false, isProveedor: false })

    render(<Dinero />)

    expect(await screen.findByText('Solo tus ventas.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('ventas_por_vendedor', expect.anything())
    expect(screen.queryByText('Por vendedor')).not.toBeInTheDocument()
  })
})
