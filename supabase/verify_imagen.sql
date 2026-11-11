-- Verificación de 0002_imagen.sql
select column_name, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'productos' and column_name = 'imagen_path';

select id, public from storage.buckets where id = 'productos';

select policyname
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'productos_storage_%'
order by 1;

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('private', 'public')
  and p.proname in ('try_uuid', 'product_exists', 'actualizar_imagen_producto')
order by 1;
