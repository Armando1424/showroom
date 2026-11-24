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

function badCredentials(): Response {
  // Mismo mensaje para usuario inexistente y contraseña incorrecta.
  return json({ error: 'Correo/usuario o contraseña incorrectos.' }, 401)
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

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const identifier = String(payload.identifier ?? '').trim()
  const password = String(payload.password ?? '')

  if (!identifier || !password) {
    return json({ error: 'Escribe tu correo o usuario y tu contraseña.' }, 400)
  }

  if (identifier.length > 320 || password.length > 256) {
    return json({ error: 'Datos de acceso inválidos.' }, 400)
  }

  const isEmail = identifier.includes('@')
  let email = identifier.toLowerCase()

  if (!isEmail) {
    // Los usernames se guardan en minúsculas; el login no distingue mayúsculas.
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: profile, error: lookupError } = await admin
      .from('profiles')
      .select('email')
      .eq('username', identifier.toLowerCase())
      .maybeSingle()

    if (lookupError) {
      console.error('login: no se pudo resolver el username', lookupError.message)
      return json({ error: 'No se pudo validar el usuario.' }, 500)
    }

    if (!profile?.email) {
      return badCredentials()
    }

    email = String(profile.email).trim().toLowerCase()
  }

  // La contraseña se envía tal cual: Supabase Auth distingue mayúsculas.
  const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  const authPayload = (await authResponse.json().catch(() => ({}))) as Record<string, unknown>

  if (!authResponse.ok) {
    const detail = String(
      authPayload.error_description ?? authPayload.msg ?? authPayload.error ?? '',
    )

    if (/confirm/i.test(detail)) {
      return json(
        {
          error:
            'Tu correo aún no está confirmado. Pide a un administrador que active tu cuenta.',
        },
        403,
      )
    }

    if (/banned/i.test(detail)) {
      return json({ error: 'Tu cuenta está bloqueada. Contacta a un administrador.' }, 403)
    }

    return badCredentials()
  }

  return json(
    {
      access_token: authPayload.access_token,
      refresh_token: authPayload.refresh_token,
      expires_in: authPayload.expires_in,
      user: authPayload.user,
    },
    200,
  )
})
