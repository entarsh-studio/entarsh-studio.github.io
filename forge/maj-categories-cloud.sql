-- =====================================================================
-- Forge — mise à jour : catégories + cloud de fichiers
-- À coller UNE SEULE FOIS dans Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------- Catégories (ex. « Helper ») ----------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  icon        text not null default 'idee',
  color       text not null default '#ff4d4d',
  created_at  timestamptz not null default now()
);

alter table public.categories add column if not exists image text not null default '';

-- Les listes et les tâches sont rangées dans une catégorie (vide = « Général »).
-- Une catégorie qui contient encore quelque chose ne peut pas être supprimée.
alter table public.lists add column if not exists category_id uuid references public.categories on delete restrict;
alter table public.tasks add column if not exists category_id uuid references public.categories on delete restrict;

-- ---------- Cloud : dossiers et fichiers, un cloud par catégorie ----------
create table if not exists public.cloud_items (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles on delete cascade,
  category_id uuid references public.categories on delete restrict,
  parent_id   uuid references public.cloud_items on delete restrict,
  kind        text not null check (kind in ('folder', 'file')),
  name        text not null check (char_length(name) between 1 and 120),
  path        text not null default '',
  mime        text not null default '',
  size        bigint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Droits ----------
grant select, insert, update, delete on public.categories, public.cloud_items to authenticated;

alter table public.categories  enable row level security;
alter table public.cloud_items enable row level security;

-- Tout le monde (connecté) voit tout ; chacun ne modifie / supprime que ce qu'il a créé
create policy "cat_lecture"   on public.categories for select to authenticated using (true);
create policy "cat_creation"  on public.categories for insert to authenticated with check (owner = auth.uid());
create policy "cat_modif"     on public.categories for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "cat_suppr"     on public.categories for delete to authenticated using (owner = auth.uid());

create policy "cloud_lecture"  on public.cloud_items for select to authenticated using (true);
create policy "cloud_creation" on public.cloud_items for insert to authenticated with check (owner = auth.uid());
create policy "cloud_modif"    on public.cloud_items for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "cloud_suppr"    on public.cloud_items for delete to authenticated using (owner = auth.uid());

-- ---------- Temps réel ----------
alter publication supabase_realtime add table public.categories, public.cloud_items;

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
