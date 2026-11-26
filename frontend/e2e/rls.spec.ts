import { expect, test, type APIRequestContext } from '@playwright/test'

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'https://tojdcyzdeigiynvvvrwz.supabase.co'
const ANON = process.env.SUPABASE_ANON_KEY

const PASSWORDS = {
  admin: process.env.E2E_ADMIN_PASSWORD,
  will: process.env.E2E_WILL_PASSWORD,
  cristian: process.env.E2E_CRISTIAN_PASSWORD,
}

const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
const hasta = new Date().toISOString()

async function login(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<{ token: string; userId: string }> {
  const response = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: ANON!, 'Content-Type': 'application/json' },
      data: { email, password },
    },
  )
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json()
  return { token: body.access_token, userId: body.user.id }
}

async function rest(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<any[]> {
  const response = await request.get(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${token}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function rpc(
  request: APIRequestContext,
  token: string,
  name: string,
  data: Record<string, unknown>,
): Promise<any[]> {
  const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: {
      apikey: ANON!,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data,
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

test.describe('RLS y RPC read-only', () => {
  test.beforeEach(() => {
    test.skip(
      !ANON || !PASSWORDS.admin || !PASSWORDS.will || !PASSWORDS.cristian,
      'Faltan SUPABASE_ANON_KEY o contraseñas E2E',
    )
  })

  test('el admin ve todo y los RPC responden', async ({ request }) => {
    const { token, userId } = await login(
      request,
      'local.administrator@showroom.local',
      PASSWORDS.admin!,
    )

    const productos = await rest(
      request,
      token,
      'productos?select=id,nombre,proveedor_id,created_by,estado&limit=1000',
    )
    const perfiles = await rest(
      request,
      token,
      'profiles?select=id,nombre,email,activo,proveedor_id&limit=1000',
    )
    const roles = await rest(
      request,
      token,
      'user_roles?select=user_id,rol&limit=1000',
    )

    expect(Array.isArray(productos)).toBe(true)
    expect(perfiles.length).toBeGreaterThanOrEqual(3)
    expect(roles.length).toBeGreaterThanOrEqual(3)
    expect(perfiles.some((perfil) => perfil.id === userId)).toBe(true)

    // El admin debe operar sobre un proveedor concreto, igual que en la app.
    const proveedor =
      perfiles.find((perfil) => perfil.id !== userId && perfil.activo)?.id ?? userId

    const resumen = await rpc(request, token, 'resumen_ventas', {
      p_desde: desde,
      p_hasta: hasta,
      p_proveedor: proveedor,
      p_granularidad: 'month',
    })
    expect(Array.isArray(resumen)).toBe(true)

    const vendedores = await rpc(request, token, 'ventas_por_vendedor', {
      p_desde: desde,
      p_hasta: hasta,
      p_proveedor: proveedor,
    })
    expect(Array.isArray(vendedores)).toBe(true)
  })

  test('Will (admin) ve todo', async ({ request }) => {
    const { token, userId } = await login(
      request,
      'will@showroom.local',
      PASSWORDS.will!,
    )

    const perfiles = await rest(
      request,
      token,
      'profiles?select=id,nombre,email,activo,proveedor_id&limit=1000',
    )
    const roles = await rest(
      request,
      token,
      'user_roles?select=user_id,rol&limit=1000',
    )

    expect(perfiles.length).toBeGreaterThanOrEqual(3)
    expect(roles.length).toBeGreaterThanOrEqual(3)
    expect(roles.some((rol) => rol.user_id === userId && rol.rol === 'admin')).toBe(true)
  })

  test('Cristian (proveedor) solo ve su ámbito', async ({ request }) => {
    const { token, userId } = await login(
      request,
      'cristian@showroom.local',
      PASSWORDS.cristian!,
    )

    const perfiles = await rest(
      request,
      token,
      'profiles?select=id,nombre,email,activo,proveedor_id&limit=1000',
    )
    for (const perfil of perfiles) {
      expect(perfil.activo).toBe(true)
    }

    const roles = await rest(
      request,
      token,
      'user_roles?select=user_id,rol&limit=1000',
    )
    for (const rol of roles) {
      expect(rol.user_id).toBe(userId)
    }
    expect(roles.map((rol) => rol.rol).sort()).toEqual(['proveedor', 'vendedor'])

    const productos = await rest(
      request,
      token,
      'productos?select=id,nombre,proveedor_id,created_by,estado&limit=1000',
    )
    for (const producto of productos) {
      expect(
        producto.proveedor_id === userId || producto.created_by === userId,
      ).toBe(true)
    }

    const resumen = await rpc(request, token, 'resumen_ventas', {
      p_desde: desde,
      p_hasta: hasta,
      p_proveedor: userId,
      p_granularidad: 'month',
    })
    expect(Array.isArray(resumen)).toBe(true)

    const vendedores = await rpc(request, token, 'ventas_por_vendedor', {
      p_desde: desde,
      p_hasta: hasta,
      p_proveedor: userId,
    })
    expect(Array.isArray(vendedores)).toBe(true)
  })
})
