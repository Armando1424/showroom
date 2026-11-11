-- =====================================================================
-- Verificación después de ejecutar 0001_init.sql.
-- Todas las consultas deben devolver lo indicado en los comentarios.
-- =====================================================================

-- 1. Tablas: 5 filas.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'user_roles', 'productos', 'product_visibility', 'audit_log')
order by table_name;

-- 2. log_audit: UNA sola fila, con p_entidad_id uuid.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as argumentos
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
  and p.proname = 'log_audit'
order by argumentos;

-- 3. entidad_id debe ser uuid.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'audit_log'
  and column_name = 'entidad_id';

-- 4. RLS habilitado en las 5 tablas (rowsecurity = true).
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'user_roles', 'productos', 'product_visibility', 'audit_log')
order by tablename;

-- 5. Triggers (deben aparecer los 12 esperados + on_auth_user_created).
select n.nspname as esquema, c.relname as tabla, t.tgname as trigger
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and (
    (n.nspname = 'public' and c.relname in ('profiles', 'user_roles', 'productos', 'product_visibility'))
    or (n.nspname = 'auth' and c.relname = 'users')
  )
order by 1, 2, 3;

-- 6. Políticas: 12.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 7. Funciones SECURITY DEFINER: 23.
select count(*) as funciones_security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('private', 'public')
  and p.prosecdef;
