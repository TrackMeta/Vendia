-- =====================================================================
-- Vendia — Logística, integraciones y webhooks
-- Vendia es la fuente de verdad de los pedidos. Las integraciones
-- (couriers, automatizaciones) solo ACTUALIZAN estados vía webhook firmado.
-- =====================================================================

-- Datos de envío en el pedido
alter table public.orders
  add column courier_name text check (courier_name is null or char_length(courier_name) <= 80),
  add column tracking_code text check (tracking_code is null or char_length(tracking_code) <= 120),
  add column external_order_id text check (external_order_id is null or char_length(external_order_id) <= 120),
  add column integration_status text check (integration_status is null or char_length(integration_status) <= 60),
  add column integration_updated_at timestamptz;

grant update (courier_name, tracking_code) on public.orders to authenticated;
create index orders_external_idx on public.orders (store_id, external_order_id) where external_order_id is not null;

-- ---------------------------------------------------------------------
-- Integraciones por tienda
-- ---------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_]{2,40}$'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  config jsonb not null default '{}'::jsonb,
  -- Secretos (API keys del courier) cifrados por la app
  secret_encrypted text,
  -- Secreto para verificar la firma HMAC de los webhooks entrantes (cifrado)
  webhook_secret_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider)
);
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

alter table public.integrations enable row level security;
revoke all on public.integrations from anon, authenticated;
grant select (id, store_id, provider, status, config, created_at, updated_at) on public.integrations to authenticated;
create policy "integrations: miembros leen" on public.integrations
  for select to authenticated using (public.is_store_member(store_id));
-- Crear/editar/rotar secretos: solo el servidor (service role), tras validar la sesión.

create table public.integration_logs (
  id bigint generated always as identity primary key,
  store_id uuid references public.stores (id) on delete cascade,
  provider text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  operation text not null,
  order_id uuid,
  success boolean not null,
  status_code integer,
  message text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index integration_logs_store_idx on public.integration_logs (store_id, created_at desc);
create index integration_logs_errors_idx on public.integration_logs (created_at desc) where not success;

alter table public.integration_logs enable row level security;
revoke all on public.integration_logs from anon, authenticated;
grant select on public.integration_logs to authenticated;
create policy "integration_logs: miembros leen" on public.integration_logs
  for select to authenticated using (store_id is not null and public.is_store_member(store_id));

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  store_id uuid references public.stores (id) on delete cascade,
  external_event_id text not null check (char_length(external_event_id) between 1 and 200),
  signature_valid boolean not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  -- Idempotencia: el mismo evento del proveedor se procesa una sola vez
  unique (provider, store_id, external_event_id)
);
create index webhook_events_store_idx on public.webhook_events (store_id, created_at desc);

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
grant select (id, provider, store_id, external_event_id, signature_valid, processed_at, error, created_at)
  on public.webhook_events to authenticated;
create policy "webhook_events: miembros leen" on public.webhook_events
  for select to authenticated using (store_id is not null and public.is_store_member(store_id));

-- ---------------------------------------------------------------------
-- Cambio de estado desde una integración (solo service role).
-- Busca el pedido por número o por ID externo dentro de la tienda.
-- Si el pedido ya está en ese estado, no hace nada (idempotente).
-- ---------------------------------------------------------------------
create or replace function public.apply_integration_status(
  p_store_id uuid,
  p_order_number integer,
  p_external_order_id text,
  p_to public.order_status,
  p_note text,
  p_tracking_code text default null,
  p_courier_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders o
  where o.store_id = p_store_id
    and ((p_order_number is not null and o.order_number = p_order_number)
      or (p_external_order_id is not null and o.external_order_id = p_external_order_id))
  limit 1;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;

  update public.orders set
    tracking_code = coalesce(p_tracking_code, tracking_code),
    courier_name = coalesce(p_courier_name, courier_name),
    integration_status = p_to::text,
    integration_updated_at = now()
  where id = v_order.id;

  if v_order.status = p_to then
    return jsonb_build_object('order_id', v_order.id, 'changed', false);
  end if;

  perform public.apply_order_status(v_order.id, p_to, 'integration', null, p_note);
  return jsonb_build_object('order_id', v_order.id, 'changed', true);
end;
$$;
revoke all on function public.apply_integration_status(uuid, integer, text, public.order_status, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_integration_status(uuid, integer, text, public.order_status, text, text, text) to service_role;

-- Cambio de estado en lote desde el panel (por ejemplo, marcar 20 pedidos como Enviado)
create or replace function public.change_orders_status(p_order_ids uuid[], p_to public.order_status, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ok integer := 0;
  v_failed integer := 0;
begin
  if array_length(p_order_ids, 1) > 200 then
    raise exception 'Máximo 200 pedidos por vez' using errcode = 'P0001';
  end if;
  foreach v_id in array p_order_ids loop
    begin
      perform public.change_order_status(v_id, p_to, p_note);
      v_ok := v_ok + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('updated', v_ok, 'failed', v_failed);
end;
$$;
grant execute on function public.change_orders_status(uuid[], public.order_status, text) to authenticated;
