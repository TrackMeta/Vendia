-- Vendia — Actualización Bloque 9: varias cuentas publicitarias de Meta por tienda
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Varias cuentas publicitarias de Meta por tienda
--  · store_meta_accounts: las cuentas que usa cada tienda (moneda y estado de
--    sincronización propios). El token y el Pixel siguen en store_meta_settings;
--    ad_account_id ahí queda como «cuenta principal» (la del Pixel).
--  · meta_entities y meta_insights_daily guardan de qué cuenta viene cada dato,
--    así cada cuenta se sincroniza por separado (si una falla, las demás siguen).
-- =====================================================================

create table public.store_meta_accounts (
  store_id uuid not null references public.stores (id) on delete cascade,
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]{5,25}$'),
  name text check (name is null or char_length(name) <= 200),
  currency char(3),
  enabled boolean not null default true,
  added_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_sync_error text check (last_sync_error is null or char_length(last_sync_error) <= 1000),
  primary key (store_id, ad_account_id)
);

alter table public.store_meta_accounts enable row level security;
revoke all on public.store_meta_accounts from anon, authenticated;
grant select on public.store_meta_accounts to authenticated;
-- Lo ve el dueño; lo escribe el servidor (service role) tras validar al dueño y el token
create policy "store_meta_accounts: dueño lee" on public.store_meta_accounts
  for select to authenticated using (public.is_store_owner(store_id));

-- Las tiendas ya conectadas pasan su cuenta actual a la tabla nueva
insert into public.store_meta_accounts (store_id, ad_account_id, name, currency, added_at, last_sync_at, last_sync_error)
select store_id, ad_account_id, ad_account_name, ad_account_currency, coalesce(connected_at, now()), last_sync_at, last_sync_error
from public.store_meta_settings
where ad_account_id is not null
on conflict do nothing;

-- De qué cuenta viene cada campaña/anuncio y cada métrica diaria
alter table public.meta_entities add column ad_account_id text;
alter table public.meta_insights_daily add column ad_account_id text;
create index meta_insights_account_idx on public.meta_insights_daily (store_id, ad_account_id, date);

update public.meta_entities e set ad_account_id = s.ad_account_id
from public.store_meta_settings s
where s.store_id = e.store_id and e.ad_account_id is null and s.ad_account_id is not null;

update public.meta_insights_daily i set ad_account_id = s.ad_account_id
from public.store_meta_settings s
where s.store_id = i.store_id and i.ad_account_id is null and s.ad_account_id is not null;
