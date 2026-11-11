-- Verificación de 0003_admin_devolucion.sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('devolver_producto', 'eliminar_producto')
order by 1;

select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conname = 'audit_log_accion_check';
