-- 0007: el administrador también es proveedor y vendedor
--
-- El modelo acordado dice que un admin puede hacer todo lo de los otros roles,
-- pero el selector de proveedor solo lista usuarios con rol `proveedor`. Al
-- no tenerlo, los productos que creó el admin quedaban sin proveedor visible.
--
-- Idempotente: no duplica roles existentes.

insert into public.user_roles (user_id, rol, granted_by)
select ur.user_id, r.rol, ur.user_id
  from public.user_roles ur
  join public.profiles pr on pr.id = ur.user_id
  cross join (values ('proveedor'), ('vendedor')) as r(rol)
 where ur.rol = 'admin'
   and pr.activo
   and not exists (
       select 1 from public.user_roles x
       where x.user_id = ur.user_id and x.rol = r.rol
   )
on conflict do nothing;
