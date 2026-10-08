-- =====================================================================
-- Vendia — Estadísticas por cliente (CRM básico)
-- security_invoker: la vista respeta el RLS de customers/orders.
-- =====================================================================

create view public.customer_stats
with (security_invoker = true)
as
select
  c.id,
  c.store_id,
  c.first_name,
  c.last_name,
  c.phone,
  c.whatsapp,
  c.dni,
  c.address,
  c.reference,
  c.district_code,
  dist.name as district_name,
  prov.name as province_name,
  dep.name as department_name,
  c.created_at,
  count(o.id)::int as orders_count,
  (count(o.id) filter (where o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')))::int as delivered_count,
  (count(o.id) filter (where o.status = 'cancelled'))::int as cancelled_count,
  (count(o.id) filter (where o.status in ('failed_delivery', 'returned')))::int as failed_count,
  coalesce(sum(o.total) filter (where o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')), 0)::numeric(12, 2) as revenue,
  max(o.created_at) as last_order_at
from public.customers c
left join public.orders o on o.customer_id = c.id
left join public.ubigeo_districts dist on dist.code = c.district_code
left join public.ubigeo_provinces prov on prov.code = dist.province_code
left join public.ubigeo_departments dep on dep.code = prov.department_code
group by c.id, dist.name, prov.name, dep.name;

revoke all on public.customer_stats from anon, authenticated;
grant select on public.customer_stats to authenticated;
