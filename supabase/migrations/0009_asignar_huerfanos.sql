-- 0009: asignar productos huérfanos al administrador más antiguo
--
-- Un producto sin proveedor (proveedor_id nulo) no aparece en la sección de
-- dinero de nadie. Se asigna al administrador activo más antiguo, que es el
-- dueño operativo por defecto.
--
-- Si no existe ningún administrador activo, no hace nada.

with admin as (
    select pr.id
      from public.profiles pr
      join public.user_roles ur on ur.user_id = pr.id and ur.rol = 'admin'
     where pr.activo
     order by pr.created_at
     limit 1
)
update public.productos p
   set proveedor_id = (select id from admin)
 where p.proveedor_id is null
   and exists (select 1 from admin);

-- Las ventas heredan el proveedor del producto si quedó desalineado.
update public.ventas v
   set proveedor_id = p.proveedor_id
  from public.productos p
 where v.producto_id = p.id
   and p.proveedor_id is not null
   and v.proveedor_id <> p.proveedor_id;
