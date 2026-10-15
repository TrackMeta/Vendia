-- Vendia — Actualización Bloque 19: la lectura de Meta guarda métricas y gasto en un solo paso
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Lectura de Meta en un solo paso (Bloque 19)
--  · Antes se borraban las métricas y el gasto de esos días y después se guardaban los nuevos,
--    en pasos separados: si se cortaba en el medio, esos días quedaban sin gasto (y la utilidad
--    se veía más alta). Ahora se reemplaza todo en una sola transacción: o queda todo o nada.
--  · Solo el servidor (lectura de Meta) la usa.
-- =====================================================================

create or replace function public.replace_meta_sync(
  p_store_id uuid,
  p_ad_account_id text,
  p_since date,
  p_until date,
  p_insights jsonb,
  p_account_campaigns text[],
  p_campaigns text[],
  p_expenses jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1. Métricas diarias de la cuenta: se reemplaza el rango (si un anuncio quedó en 0, desaparece)
  delete from public.meta_insights_daily
  where store_id = p_store_id and ad_account_id = p_ad_account_id and date between p_since and p_until;

  insert into public.meta_insights_daily (store_id, ad_account_id, date, ad_id, adset_id, campaign_id, spend, spend_pen, impressions, reach, clicks, results, updated_at)
  select p_store_id, p_ad_account_id, r.date, r.ad_id, r.adset_id, r.campaign_id,
         coalesce(r.spend, 0), coalesce(r.spend_pen, 0), coalesce(r.impressions, 0), coalesce(r.reach, 0), coalesce(r.clicks, 0), coalesce(r.results, 0), now()
  from jsonb_to_recordset(coalesce(p_insights, '[]'::jsonb)) as r(
    date date, ad_id text, adset_id text, campaign_id text, spend numeric, spend_pen numeric,
    impressions bigint, reach bigint, clicks bigint, results integer
  );

  -- 2. Gasto por campaña y día: se borra lo leído antes (también campañas que hoy quedaron en 0)
  if coalesce(array_length(p_account_campaigns, 1), 0) > 0 then
    delete from public.expenses
    where store_id = p_store_id and source = 'meta_sync' and campaign_id = any (p_account_campaigns)
      and expense_date between p_since and p_until;
  end if;
  -- El CSV importado de esos días queda reemplazado por la lectura (evita contar dos veces)
  if coalesce(array_length(p_campaigns, 1), 0) > 0 then
    delete from public.expenses
    where store_id = p_store_id and source = 'import' and category = 'meta_ads' and campaign_id = any (p_campaigns)
      and expense_date between p_since and p_until;
  end if;

  insert into public.expenses (store_id, expense_date, category, description, amount, currency, exchange_rate, igv_rate, campaign_id, campaign_name, product_id, source, import_key)
  select p_store_id, e.expense_date, 'meta_ads'::public.expense_category, e.description, e.amount, e.currency, e.exchange_rate, e.igv_rate,
         e.campaign_id, e.campaign_name, e.product_id, 'meta_sync', e.import_key
  from jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) as e(
    expense_date date, description text, amount numeric, currency text, exchange_rate numeric, igv_rate numeric,
    campaign_id text, campaign_name text, product_id uuid, import_key text
  )
  on conflict (store_id, import_key) do update set
    expense_date = excluded.expense_date,
    category = excluded.category,
    description = excluded.description,
    amount = excluded.amount,
    currency = excluded.currency,
    exchange_rate = excluded.exchange_rate,
    igv_rate = excluded.igv_rate,
    campaign_id = excluded.campaign_id,
    campaign_name = excluded.campaign_name,
    product_id = excluded.product_id,
    source = excluded.source,
    updated_at = now();
end;
$$;
revoke all on function public.replace_meta_sync(uuid, text, date, date, jsonb, text[], text[], jsonb) from public, anon, authenticated;
grant execute on function public.replace_meta_sync(uuid, text, date, date, jsonb, text[], text[], jsonb) to service_role;
