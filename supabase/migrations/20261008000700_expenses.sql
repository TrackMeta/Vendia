-- =====================================================================
-- Vendia — Gastos
-- Regla de utilidad (sin doble conteo):
--   · El costo de producto y de envío se toma de CADA PEDIDO (snapshot).
--   · Las categorías 'product', 'courier' y 'shipping' se registran como
--     referencia de caja y NO se restan otra vez en la utilidad.
--   · Gasto publicitario = meta_ads + tiktok_ads + google_ads.
--   · Otros gastos = todas las demás categorías.
-- =====================================================================

create type public.expense_category as enum (
  'meta_ads',
  'tiktok_ads',
  'google_ads',
  'product',
  'courier',
  'shipping',
  'returns',
  'releasit',
  'whatsapp',
  'software',
  'commissions',
  'other'
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  expense_date date not null,
  category public.expense_category not null,
  description text check (description is null or char_length(description) <= 300),
  amount numeric(12, 2) not null check (amount >= 0 and amount <= 10000000),
  currency char(3) not null default 'PEN' check (currency = 'PEN'),
  -- ID de campaña de la plataforma (ej: Meta campaign_id) para CPA por campaña
  campaign_id text check (campaign_id is null or char_length(campaign_id) <= 64),
  campaign_name text check (campaign_name is null or char_length(campaign_name) <= 255),
  product_id uuid,
  source text not null default 'manual' check (source in ('manual', 'import')),
  -- Evita duplicar filas al reimportar el mismo reporte
  import_key text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, store_id) references public.products (id, store_id) on delete set null (product_id),
  unique (store_id, import_key)
);
create index expenses_store_date_idx on public.expenses (store_id, expense_date desc);
create index expenses_campaign_idx on public.expenses (store_id, campaign_id);
create index expenses_product_idx on public.expenses (store_id, product_id);

create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

alter table public.expenses enable row level security;
revoke all on public.expenses from anon, authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

create policy "expenses: miembros leen" on public.expenses
  for select to authenticated using (public.is_store_member(store_id));
create policy "expenses: miembros crean" on public.expenses
  for insert to authenticated with check (public.is_store_member(store_id));
create policy "expenses: miembros editan" on public.expenses
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));
create policy "expenses: miembros eliminan" on public.expenses
  for delete to authenticated using (public.is_store_member(store_id));

-- Totales de gastos por rango de fechas (fechas calendario de Lima, ambos inclusive).
create or replace function public.get_expense_totals(p_store_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'ad_spend', coalesce(sum(e.amount) filter (where e.category in ('meta_ads', 'tiktok_ads', 'google_ads')), 0),
      'meta_spend', coalesce(sum(e.amount) filter (where e.category = 'meta_ads'), 0),
      'other_expenses', coalesce(sum(e.amount) filter (where e.category not in ('meta_ads', 'tiktok_ads', 'google_ads', 'product', 'courier', 'shipping')), 0),
      'reference_only', coalesce(sum(e.amount) filter (where e.category in ('product', 'courier', 'shipping')), 0),
      'by_category', coalesce((
        select jsonb_object_agg(c.category, c.total)
        from (
          select x.category, sum(x.amount) as total
          from public.expenses x
          where x.store_id = p_store_id and x.expense_date between p_from and p_to
          group by x.category
        ) c
      ), '{}'::jsonb)
    )
    from public.expenses e
    where e.store_id = p_store_id and e.expense_date between p_from and p_to
  );
end;
$$;
grant execute on function public.get_expense_totals(uuid, date, date) to authenticated;
