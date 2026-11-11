import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return json({ error: 'Método no permitido' }, 405)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !anonKey || !serviceKey) {
    return json({ error: 'Faltan variables de entorno de Supabase' }, 500)
  }

  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) {
    return json({ error: 'No autenticado' }, 401)
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser()

  if (userError || !user) {
    return json({ error: 'Sesión inválida' }, 401)
  }

  const [{ data: profile }, { data: roles }] = await Promise.all([
    userClient.from('profiles').select('activo').eq('id', user.id).maybeSingle(),
    userClient.from('user_roles').select('rol').eq('user_id', user.id),
  ])

  const isAdmin =
    Boolean(profile?.activo) && (roles ?? []).some((row: { rol: string }) => row.rol === 'admin')

  if (!isAdmin) {
    return json({ error: 'Solo un administrador puede crear usuarios' }, 403)
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const email = String(payload.email ?? '').trim().toLowerCase()
  const nombre = String(payload.nombre ?? '').trim() || 'Usuario'
  const password = payload.password ? String(payload.password) : ''

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'Correo inválido' }, 400)
  }

  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (password) {
    if (password.length < 8) {
      return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400)
    }

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    })

    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, mode: 'password', user_id: data.user?.id ?? null })
  }

  const redirectTo = Deno.env.get('SITE_URL') ?? 'https://armando1424.github.io/showroom/'
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { nombre },
    redirectTo,
  })

  if (error) return json({ error: error.message }, 400)
  return json({ ok: true, mode: 'invite', user_id: data.user?.id ?? null })
})
