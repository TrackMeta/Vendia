-- =====================================================================
-- Vendia — Storage
-- Bucket público de lectura (imágenes de landings/productos).
-- Ruta obligatoria: {store_id}/...  → solo miembros de esa tienda escriben.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-assets',
  'store-assets',
  true,
  5242880, -- 5 MB
  array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif', 'image/x-icon', 'image/svg+xml']
)
on conflict (id) do nothing;

create or replace function public.storage_path_store_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function public.storage_path_store_id(text) to authenticated;

create policy "store-assets: miembros suben"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)));

create policy "store-assets: miembros actualizan"
  on storage.objects for update to authenticated
  using (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)))
  with check (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)));

create policy "store-assets: miembros eliminan"
  on storage.objects for delete to authenticated
  using (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)));

create policy "store-assets: miembros listan"
  on storage.objects for select to authenticated
  using (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)));
