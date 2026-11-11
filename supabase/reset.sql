-- =====================================================================
-- Reset del proyecto DESECHABLE.
-- Borra todas las tablas y funciones de la migración showroom.
-- No borra usuarios de auth.users; bórralos desde el Dashboard si hace falta.
-- Ejecutar como postgres en el SQL Editor.
-- =====================================================================

drop trigger if exists on_auth_user_created on auth.users;
drop schema if exists private cascade;

drop table if exists public.audit_log cascade;
drop table if exists public.product_visibility cascade;
drop table if exists public.productos cascade;
drop table if exists public.user_roles cascade;
drop table if exists public.profiles cascade;

-- Verificación: no debe devolver filas.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'user_roles', 'productos', 'product_visibility', 'audit_log');
