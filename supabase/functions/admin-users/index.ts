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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function normalizarUsername(value: string): string {
  return value.trim().toLowerCase()
}

function usernameDesdeNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 24)
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

  const token = authorization.slice('Bearer '.length)

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(token)

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
    return json({ error: 'Solo un administrador puede gestionar usuarios' }, 403)
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(payload.action ?? 'create')

  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Activar/desactivar. Al activar se confirma el correo en Auth para que el
  // login quede válido, incluso si el usuario nació sin confirmar.
  if (action === 'set-active') {
    const userId = String(payload.user_id ?? '').trim()
    const activo = payload.activo === true || payload.activo === 'true'

    if (!isUuid(userId)) {
      return json({ error: 'Usuario inválido' }, 400)
    }

    // Se actualiza con el JWT del admin para que apliquen RLS y el trigger
    // que protege al último administrador activo.
    const { data: updated, error: updateError } = await userClient
      .from('profiles')
      .update({ activo })
      .eq('id', userId)
      .select('id, activo')

    if (updateError) {
      return json({ error: updateError.message }, 400)
    }

    if (!updated || updated.length === 0) {
      return json({ error: 'No se pudo actualizar el usuario.' }, 400)
    }

    if (activo) {
      const { error: confirmError } = await adminClient.auth.admin.updateUserById(userId, {
        email_confirm: true,
      })
      if (confirmError) {
        return json(
          {
            error:
              'Perfil activado, pero no se pudo confirmar el correo: ' + confirmError.message,
          },
          502,
        )
      }
    }

    return json({ ok: true, activo })
  }

  // Cambiar la contraseña de un usuario (solo admin).
  if (action === 'set-password') {
    const userId = String(payload.user_id ?? '').trim()
    const password = String(payload.password ?? '')

    if (!isUuid(userId)) {
      return json({ error: 'Usuario inválido' }, 400)
    }

    if (password.length < 6 || password.length > 256) {
      return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400)
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    })

    if (updateError) {
      return json({ error: updateError.message }, 400)
    }

    return json({ ok: true })
  }

  if (action !== 'create') {
    return json({ error: 'Acción no permitida' }, 400)
  }

  const email = String(payload.email ?? '').trim().toLowerCase()
  const nombre = String(payload.nombre ?? '').trim() || 'Usuario'
  const password = payload.password ? String(payload.password) : ''
  const username = normalizarUsername(String(payload.username ?? ''))

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'Correo inválido' }, 400)
  }

  if (username && !/^[a-z0-9._-]{2,30}$/.test(username)) {
    return json(
      {
        error:
          'El usuario debe tener entre 2 y 30 caracteres: letras, números, punto, guion o guion bajo.',
      },
      400,
    )
  }

  const usernameDerivado = usernameDesdeNombre(nombre)
  const usernameFinal = username || (usernameDerivado.length >= 2 ? usernameDerivado : '')
  const metadata = { nombre, ...(usernameFinal ? { username: usernameFinal } : {}) }

  async function usernameCreado(userId: string | null): Promise<string | null> {
    if (!userId) return null
    const { data: createdProfile } = await adminClient
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle()
    return createdProfile?.username ?? null
  }

  if (password) {
    if (password.length < 6) {
      return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400)
    }

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    })

    if (error) return json({ error: error.message }, 400)

    return json({
      ok: true,
      mode: 'password',
      user_id: data.user?.id ?? null,
      username: await usernameCreado(data.user?.id ?? null),
    })
  }

  const redirectTo = Deno.env.get('SITE_URL') ?? 'https://armando1424.github.io/showroom/'
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: metadata,
    redirectTo,
  })

  if (error) return json({ error: error.message }, 400)

  return json({
    ok: true,
    mode: 'invite',
    user_id: data.user?.id ?? null,
    username: await usernameCreado(data.user?.id ?? null),
  })
})
