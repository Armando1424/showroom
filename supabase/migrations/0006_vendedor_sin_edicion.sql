-- 0006: el vendedor no edita productos, solo los vende
--
-- La política de UPDATE de 0004 permitía a cualquier usuario del proveedor
-- modificar sus productos por REST. Vender y devolver van por RPC
-- (security definer), así que la edición directa puede quedarse en admin y
-- proveedor dueño.

drop policy if exists productos_update on public.productos;

create policy productos_update on public.productos
for update to authenticated
using (
    (select private.is_admin())
    or (
        deleted_at is null
        and (select private.has_role('proveedor'))
        and proveedor_id = auth.uid()
    )
)
with check (
    (select private.is_admin())
    or (
        (select private.has_role('proveedor'))
        and proveedor_id = auth.uid()
    )
);
