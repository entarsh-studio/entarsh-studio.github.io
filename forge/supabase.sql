-- =====================================================================
-- Forge — base de données Supabase
-- À coller UNE SEULE FOIS dans Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------- Tables ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  pseudo      text not null default '' check (char_length(pseudo) <= 30),
  icon        text not null default 'gamedesign',
  color       text not null default '#ff4d4d',
  photo       text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.lists (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  icon        text not null default 'liste',
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles on delete cascade,
  list_id     uuid references public.lists on delete set null,
  title       text not null check (char_length(title) between 1 and 120),
  icon        text not null default 'liste',
  diff        smallint not null default 1 check (diff between 1 and 3),
  urg         smallint not null default 2 check (urg between 1 and 3),
  assignee    uuid references public.profiles on delete set null,
  files       jsonb not null default '[]'::jsonb,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------- Accès des personnes connectées aux tables ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.lists, public.tasks to authenticated;

-- ---------- Sécurité : seules les personnes connectées voient les données ----------
alter table public.profiles enable row level security;
alter table public.lists    enable row level security;
alter table public.tasks    enable row level security;

-- Profils : tout le monde (connecté) les lit, chacun ne modifie que le sien
create policy "profils_lecture"  on public.profiles for select to authenticated using (true);
create policy "profils_creation" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profils_modif"    on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Listes : tout le monde les lit, seul le créateur modifie / supprime
create policy "listes_lecture"   on public.lists for select to authenticated using (true);
create policy "listes_creation"  on public.lists for insert to authenticated with check (owner = auth.uid());
create policy "listes_modif"     on public.lists for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "listes_suppr"     on public.lists for delete to authenticated using (owner = auth.uid());

-- Tâches : tout le monde les lit, seul le créateur modifie / supprime
create policy "taches_lecture"   on public.tasks for select to authenticated using (true);
create policy "taches_creation"  on public.tasks for insert to authenticated with check (owner = auth.uid());
create policy "taches_modif"     on public.tasks for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "taches_suppr"     on public.tasks for delete to authenticated using (owner = auth.uid());

-- ---------- Cocher / décocher : seulement la personne attribuée (ou le créateur si personne) ----------
create or replace function public.toggle_done(tid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = tid;
  if not found then raise exception 'Tâche introuvable'; end if;
  if auth.uid() is null or auth.uid() <> coalesce(t.assignee, t.owner) then
    raise exception 'Seule la personne concernée peut cocher cette tâche';
  end if;
  update public.tasks
     set done_at = case when done_at is null then now() else null end
   where id = tid;
end;
$$;
revoke all on function public.toggle_done(uuid) from public, anon;
grant execute on function public.toggle_done(uuid) to authenticated;

-- ---------- Temps réel (les changements apparaissent chez tout le monde) ----------
alter publication supabase_realtime add table public.profiles, public.lists, public.tasks;

-- ---------- Pièces jointes et photos de profil ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('pieces-jointes', 'pieces-jointes', false, 52428800)  -- 50 Mo par fichier
on conflict (id) do nothing;

create policy "pj_lecture" on storage.objects for select to authenticated
  using (bucket_id = 'pieces-jointes');
create policy "pj_envoi" on storage.objects for insert to authenticated
  with check (bucket_id = 'pieces-jointes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pj_suppr" on storage.objects for delete to authenticated
  using (bucket_id = 'pieces-jointes' and (storage.foldername(name))[1] = auth.uid()::text);
