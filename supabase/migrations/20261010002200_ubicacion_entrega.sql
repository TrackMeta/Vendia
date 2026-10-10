-- =====================================================================
-- Vendia — Ubicación de entrega del pedido
--  · orders.delivery_location: link de Google Maps (o Waze) o coordenadas «lat, lng».
--    La agrega el equipo al trabajar el pedido (el cliente la manda por WhatsApp)
--    y se exporta a la columna «LINK MAPS O COORDENADAS GPS» de Eva.
-- =====================================================================

alter table public.orders
  add column delivery_location text check (delivery_location is null or char_length(delivery_location) <= 500);

-- La edita cualquier miembro de la tienda (la validación fina está en el servidor)
grant update (delivery_location) on public.orders to authenticated;
