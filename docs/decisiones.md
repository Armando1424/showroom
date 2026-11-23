# Decisiones — Showroom

Última actualización: 2026-11-22

Decisiones de producto, datos y operación, con el motivo. La descripción
funcional está en [`roles-proveedores-ventas.md`](roles-proveedores-ventas.md) y
el modelo en [`modelo-datos.md`](modelo-datos.md).

---

## D1. Jerarquía admin > proveedor > vendedor, con alcance por proveedor

**Contexto.** Varios proveedores comparten la app y cada uno tiene sus productos
y sus vendedores.

**Decisión.** Todo dato se filtra por `proveedor_id`: el admin elige proveedor
antes de entrar a Productos o Dinero; el proveedor ve lo suyo; el vendedor ve lo
de su proveedor.

**Alternativa descartada.** Un solo espacio compartido con visibilidad por
producto (`product_visibility`), que ya existía y se mantiene solo como
compatibilidad.

**Consecuencia.** El admin necesita un paso extra (elegir proveedor) y la UI tiene
un selector persistido en `localStorage`.

---

## D2. La venta vive en `public.ventas`, no en la fila del producto

**Contexto.** Hoy cada producto se vende una vez, pero el negocio puede cambiar.

**Decisión.** Registrar cada venta en `ventas` (producto, proveedor, vendedor,
método, monto, fecha, devolución) desde el principio; la fila del producto guarda
solo un espejo del último estado.

**Consecuencia.** Para permitir varias ventas del mismo artículo basta con quitar
el índice único parcial sobre ventas activas; no hay que migrar datos.

---

## D3. Un índice único parcial impide dos ventas activas del mismo producto

**Contexto.** El modelo admite varias ventas, pero el negocio actual es 1:1.

**Decisión.** `unique (producto_id) where devuelta_at is null`. Una devolución
libera el producto para volver a venderse.

**Consecuencia.** El error de “ya vendido” lo da la base, no la UI.

---

## D4. Devolver cierra la venta, no la borra

**Decisión.** `devuelta_at` + `devuelta_por` en `ventas`; el producto vuelve a
`disponible` y se limpian sus campos de venta.

**Consecuencia.** El historial se conserva y los reportes pueden excluir
devoluciones sin perderlas.

---

## D5. El vendedor ve dinero, pero solo lo suyo

**Contexto.** El requisito decía primero “que no vea la sección” y después “en
dinero solo ve lo que él vendió”.

**Decisión.** Se aplica la segunda: la sección existe para todos, y las RPC
filtran por `vendedor_id` cuando el usuario no es admin ni proveedor.

**Consecuencia.** Si mañana se quiere ocultar, es una condición en el menú.

---

## D6. Las migraciones las aplica el sistema, con registro

**Contexto.** El operador no quiere tocar la base a mano y las migraciones se
aplicaban con un workflow manual que reejecutaba el archivo indicado.

**Decisión.** `scripts/apply_migrations.py` + workflow `migrate-auto.yml`: lleva
un registro en `private.applied_migrations`, marca 0001–0003 como línea base y
aplica solo lo nuevo, deteniéndose en el primer error.

**Alternativa descartada.** Supabase CLI (`supabase db push`), que exige el CLI y
un token con más permisos.

**Consecuencia.** Un `push` a `main` aplica lo pendiente. Las migraciones deben
ser **idempotentes** porque un fallo deja parte aplicada.

---

## D7. El método de pago es obligatorio al vender

**Decisión.** `metodo_pago` con check `('efectivo','tarjeta')` y `precio_venta`;
las ventas anteriores se migraron asumiendo efectivo.

**Consecuencia.** El resumen siempre puede separar tarjeta y efectivo; una venta
sin método es imposible por restricción.

---

## D8. Roles por defecto: proveedor + vendedor

**Contexto.** Un usuario nuevo normalmente es ambas cosas; el caso “solo
vendedor” exige proveedor asignado.

**Decisión.** La UI crea con ambos roles por defecto y obliga a elegir proveedor
si se marca solo vendedor. Si no hay proveedor asignado, las RPC rechazan la
operación con un mensaje claro.

**Consecuencia.** No existen vendedores huérfanos operando.

---

## D9. El admin también recibe los roles proveedor y vendedor

**Contexto.** El selector de proveedor solo lista usuarios con rol `proveedor`;
el admin no lo tenía y sus productos quedaban invisibles.

**Decisión.** Migración `0007`: añadir ambos roles a los administradores activos
(idempotente).

**Consecuencia.** El admin puede seleccionarse a sí mismo como proveedor y ver lo
que creó.

---

## D10. El vendedor no puede editar productos por REST

**Contexto.** La política de `UPDATE` de 0004 dejaba que cualquier usuario del
proveedor modificara sus productos directamente.

**Decisión.** `0006` limita el `UPDATE` directo a admin y proveedor dueño; vender
y devolver van por RPC `security definer`.

**Consecuencia.** Un vendedor no puede cambiar precios ni nombres, solo operar.
