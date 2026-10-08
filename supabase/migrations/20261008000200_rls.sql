-- =====================================================================
-- Vendia — Row Level Security
-- Regla: un usuario solo accede a filas de tiendas donde es miembro.
-- Los visitantes anónimos NO leen ni escriben tablas directamente:
-- usan funciones con permisos acotados (landing pública, crear pedido).
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.store_settings enable row level security;
alter table public.ubigeo_departments enable row level security;
alter table public.ubigeo_provinces enable row level security;
alter table public.ubigeo_districts enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_offers enable row level security;
alter table public.landing_pages enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_attribution enable row level security;

-- Por defecto, nadie (anon/authenticated) tiene privilegios; se otorgan explícitamente.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------
grant select, update (full_name) on public.profiles to authenticated;
create policy "profiles: ver el propio" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: editar el propio" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- platform_admins: sin acceso desde el cliente (solo service role).

-- ---------------------------------------------------------------------
-- Tiendas
-- ---------------------------------------------------------------------
grant select, update (name) on public.stores to authenticated;
create policy "stores: miembros ven su tienda" on public.stores
  for select to authenticated using (public.is_store_member(id));
create policy "stores: miembros editan nombre" on public.stores
  for update to authenticated using (public.is_store_member(id)) with check (public.is_store_member(id));

grant select on public.store_members to authenticated;
create policy "store_members: ver miembros de mi tienda" on public.store_members
  for select to authenticated using (public.is_store_member(store_id));

grant select, update (
  logo_path, favicon_path, whatsapp, phone, email, address,
  shipping_lima, shipping_province, advance_amount, payment_methods,
  confirmation_message, purchase_trigger_status
) on public.store_settings to authenticated;
create policy "store_settings: miembros" on public.store_settings
  for select to authenticated using (public.is_store_member(store_id));
create policy "store_settings: miembros editan" on public.store_settings
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- ---------------------------------------------------------------------
-- Ubigeo: lectura pública
-- ---------------------------------------------------------------------
grant select on public.ubigeo_departments, public.ubigeo_provinces, public.ubigeo_districts to anon, authenticated;
create policy "ubigeo_departments: lectura" on public.ubigeo_departments for select to anon, authenticated using (true);
create policy "ubigeo_provinces: lectura" on public.ubigeo_provinces for select to anon, authenticated using (true);
create policy "ubigeo_districts: lectura" on public.ubigeo_districts for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- Catálogo y landings: CRUD para miembros de la tienda
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.products, public.product_images, public.product_offers to authenticated;
grant select, insert, delete on public.landing_pages to authenticated;
-- published_content / status / published_at solo cambian vía publish_landing_page()
grant update (product_id, slug, title, content, settings) on public.landing_pages to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'product_images', 'product_offers', 'landing_pages'] loop
    execute format(
      'create policy "%1$s: miembros leen" on public.%1$I for select to authenticated using (public.is_store_member(store_id))', t);
    execute format(
      'create policy "%1$s: miembros crean" on public.%1$I for insert to authenticated with check (public.is_store_member(store_id))', t);
    execute format(
      'create policy "%1$s: miembros editan" on public.%1$I for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id))', t);
    execute format(
      'create policy "%1$s: miembros eliminan" on public.%1$I for delete to authenticated using (public.is_store_member(store_id))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Clientes y pedidos
-- Los pedidos se crean SOLO con create_cod_order() (servidor).
-- Los estados cambian SOLO con change_order_status().
-- ---------------------------------------------------------------------
grant select, update (first_name, last_name, whatsapp, dni, address, reference) on public.customers to authenticated;
create policy "customers: miembros leen" on public.customers
  for select to authenticated using (public.is_store_member(store_id));
create policy "customers: miembros editan" on public.customers
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

grant select, update (shipping_cost, internal_notes, address, reference, delivery_method) on public.orders to authenticated;
create policy "orders: miembros leen" on public.orders
  for select to authenticated using (public.is_store_member(store_id));
create policy "orders: miembros editan campos permitidos" on public.orders
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

grant select on public.order_items, public.order_status_history, public.order_attribution to authenticated;
create policy "order_items: miembros leen" on public.order_items
  for select to authenticated using (public.is_store_member(store_id));
create policy "order_status_history: miembros leen" on public.order_status_history
  for select to authenticated using (public.is_store_member(store_id));
create policy "order_attribution: miembros leen" on public.order_attribution
  for select to authenticated using (public.is_store_member(store_id));
