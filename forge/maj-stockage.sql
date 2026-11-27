-- Forge — mise à jour : barre de stockage du site
-- À coller une fois dans Supabase > SQL Editor > New query > Run

-- ---------- Stockage du site (barre de stockage dans Forge) ----------
create or replace function public.storage_usage()
returns bigint
language sql
stable
security definer
set search_path = public, storage
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint
  from storage.objects
  where bucket_id = 'pieces-jointes';
$$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;
