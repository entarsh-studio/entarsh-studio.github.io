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
  music       text not null default '',
  music_name  text not null default '',
  volume      smallint not null default 70 check (volume between 0 and 100),
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

-- =====================================================================
-- Catégories + cloud (ajouté en novembre 2026)
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

-- ---------- Tâches « Tout le monde » cochables par tous (novembre 2026) ----------
-- On retient qui a terminé la tâche
alter table public.tasks add column if not exists done_by uuid references public.profiles on delete set null;

-- Tâche attribuée à quelqu'un : seule cette personne peut la cocher.
-- Tâche pour « Tout le monde » : n'importe quel membre connecté peut la cocher.
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
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if t.assignee is not null and auth.uid() <> t.assignee then
    raise exception 'Seule la personne concernée peut cocher cette tâche';
  end if;
  update public.tasks
     set done_at = case when done_at is null then now() else null end,
         done_by = case when done_at is null then auth.uid() else null end
   where id = tid;
end;
$$;
revoke all on function public.toggle_done(uuid) from public, anon;
grant execute on function public.toggle_done(uuid) to authenticated;


-- =====================================================================
-- Forge — mise à jour : travail d'équipe
-- (Activité, Discussion + commentaires, Planning, Wiki, Bugs, Idées,
--  couleurs des icônes et échéances des tâches)
-- À coller UNE SEULE FOIS dans Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------- Couleurs et échéances ----------
alter table public.tasks add column if not exists color text not null default '';
alter table public.tasks add column if not exists due_date date;
alter table public.lists add column if not exists color text not null default '';

-- ---------- Discussion (par projet) et commentaires (par tâche) ----------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles on delete cascade,
  category_id uuid references public.categories on delete cascade,
  task_id     uuid references public.tasks on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);

-- ---------- Planning ----------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles on delete cascade,
  category_id uuid references public.categories on delete restrict,
  title       text not null check (char_length(title) between 1 and 120),
  kind        text not null default 'jalon' check (kind in ('jalon','reunion','sortie','autre')),
  day         date not null,
  time        text not null default '',
  note        text not null default '' check (char_length(note) <= 2000),
  created_at  timestamptz not null default now()
);

-- ---------- Wiki ----------
create table if not exists public.docs (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles on delete cascade,
  category_id uuid references public.categories on delete restrict,
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null default '' check (char_length(body) <= 100000),
  updated_by  uuid references public.profiles on delete set null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- ---------- Bugs ----------
create table if not exists public.bugs (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles on delete cascade,
  category_id uuid references public.categories on delete restrict,
  title       text not null check (char_length(title) between 1 and 160),
  body        text not null default '' check (char_length(body) <= 20000),
  severity    smallint not null default 2 check (severity between 1 and 4),
  status      text not null default 'nouveau' check (status in ('nouveau','en_cours','corrige','verifie')),
  assignee    uuid references public.profiles on delete set null,
  files       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Idées et votes ----------
create table if not exists public.ideas (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles on delete cascade,
  category_id uuid references public.categories on delete restrict,
  title       text not null check (char_length(title) between 1 and 160),
  body        text not null default '' check (char_length(body) <= 5000),
  created_at  timestamptz not null default now()
);
create table if not exists public.idea_votes (
  idea_id     uuid not null references public.ideas on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles on delete cascade,
  value       smallint not null check (value in (-1, 1)),
  primary key (idea_id, user_id)
);

-- ---------- Activité (remplie automatiquement) ----------
create table if not exists public.activity (
  id          bigint generated always as identity primary key,
  actor       uuid references public.profiles on delete set null,
  category_id uuid references public.categories on delete cascade,
  kind        text not null,
  label       text not null default '',
  ref         uuid,
  created_at  timestamptz not null default now()
);

-- ---------- Droits ----------
grant select, insert, update, delete on public.messages, public.events, public.docs, public.bugs, public.ideas, public.idea_votes to authenticated;
grant select on public.activity to authenticated;

alter table public.messages   enable row level security;
alter table public.events     enable row level security;
alter table public.docs       enable row level security;
alter table public.bugs       enable row level security;
alter table public.ideas      enable row level security;
alter table public.idea_votes enable row level security;
alter table public.activity   enable row level security;

-- Messages : tout le monde lit, chacun écrit et supprime les siens
create policy "msg_lecture"  on public.messages for select to authenticated using (true);
create policy "msg_envoi"    on public.messages for insert to authenticated with check (owner = auth.uid());
create policy "msg_suppr"    on public.messages for delete to authenticated using (owner = auth.uid());

-- Planning : chacun gère ses événements
create policy "evt_lecture"  on public.events for select to authenticated using (true);
create policy "evt_creation" on public.events for insert to authenticated with check (owner = auth.uid());
create policy "evt_modif"    on public.events for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "evt_suppr"    on public.events for delete to authenticated using (owner = auth.uid());

-- Wiki : tout le monde peut modifier une page, seul son créateur peut la supprimer
create policy "doc_lecture"  on public.docs for select to authenticated using (true);
create policy "doc_creation" on public.docs for insert to authenticated with check (owner = auth.uid());
create policy "doc_modif"    on public.docs for update to authenticated using (true) with check (true);
create policy "doc_suppr"    on public.docs for delete to authenticated using (owner = auth.uid());

-- Bugs : tout le monde peut faire avancer un bug, seul son auteur peut le supprimer
create policy "bug_lecture"  on public.bugs for select to authenticated using (true);
create policy "bug_creation" on public.bugs for insert to authenticated with check (owner = auth.uid());
create policy "bug_modif"    on public.bugs for update to authenticated using (true) with check (true);
create policy "bug_suppr"    on public.bugs for delete to authenticated using (owner = auth.uid());

-- Idées : chacun gère les siennes ; chacun gère son propre vote
create policy "idee_lecture"  on public.ideas for select to authenticated using (true);
create policy "idee_creation" on public.ideas for insert to authenticated with check (owner = auth.uid());
create policy "idee_modif"    on public.ideas for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "idee_suppr"    on public.ideas for delete to authenticated using (owner = auth.uid());
create policy "vote_lecture"  on public.idea_votes for select to authenticated using (true);
create policy "vote_envoi"    on public.idea_votes for insert to authenticated with check (user_id = auth.uid());
create policy "vote_modif"    on public.idea_votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "vote_suppr"    on public.idea_votes for delete to authenticated using (user_id = auth.uid());

-- Activité : lecture seule (écrite par la base elle-même)
create policy "act_lecture"  on public.activity for select to authenticated using (true);

-- ---------- Journal d'activité automatique ----------
create or replace function public.forge_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare k text; lbl text; cid uuid; rid uuid;
begin
  if TG_TABLE_NAME = 'tasks' then
    if TG_OP = 'INSERT' then k := 'task_new'; lbl := new.title; cid := new.category_id; rid := new.id;
    elsif TG_OP = 'UPDATE' then
      if new.done_at is not null and old.done_at is null then k := 'task_done';
      elsif new.done_at is null and old.done_at is not null then k := 'task_reopen';
      else return new; end if;
      lbl := new.title; cid := new.category_id; rid := new.id;
    else k := 'task_del'; lbl := old.title; cid := old.category_id; rid := old.id;
    end if;
  elsif TG_TABLE_NAME = 'lists' then k := 'list_new'; lbl := new.name; cid := new.category_id; rid := new.id;
  elsif TG_TABLE_NAME = 'cloud_items' then
    k := case when new.kind = 'folder' then 'folder_new' else 'file_new' end; lbl := new.name; cid := new.category_id; rid := new.id;
  elsif TG_TABLE_NAME = 'bugs' then
    if TG_OP = 'INSERT' then k := 'bug_new';
    elsif new.status is distinct from old.status then k := 'bug_' || new.status;
    else return new; end if;
    lbl := new.title; cid := new.category_id; rid := new.id;
  elsif TG_TABLE_NAME = 'ideas' then k := 'idea_new'; lbl := new.title; cid := new.category_id; rid := new.id;
  elsif TG_TABLE_NAME = 'docs' then k := 'doc_new'; lbl := new.title; cid := new.category_id; rid := new.id;
  elsif TG_TABLE_NAME = 'events' then k := 'event_new'; lbl := new.title; cid := new.category_id; rid := new.id;
  else
    if TG_OP = 'DELETE' then return old; else return new; end if;
  end if;
  insert into public.activity(actor, category_id, kind, label, ref) values (auth.uid(), cid, k, left(coalesce(lbl, ''), 160), rid);
  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists forge_log_tasks on public.tasks;
create trigger forge_log_tasks after insert or update or delete on public.tasks for each row execute function public.forge_log();
drop trigger if exists forge_log_lists on public.lists;
create trigger forge_log_lists after insert on public.lists for each row execute function public.forge_log();
drop trigger if exists forge_log_cloud on public.cloud_items;
create trigger forge_log_cloud after insert on public.cloud_items for each row execute function public.forge_log();
drop trigger if exists forge_log_bugs on public.bugs;
create trigger forge_log_bugs after insert or update on public.bugs for each row execute function public.forge_log();
drop trigger if exists forge_log_ideas on public.ideas;
create trigger forge_log_ideas after insert on public.ideas for each row execute function public.forge_log();
drop trigger if exists forge_log_docs on public.docs;
create trigger forge_log_docs after insert on public.docs for each row execute function public.forge_log();
drop trigger if exists forge_log_events on public.events;
create trigger forge_log_events after insert on public.events for each row execute function public.forge_log();

-- ---------- Temps réel ----------
alter publication supabase_realtime add table public.messages, public.events, public.docs, public.bugs, public.ideas, public.idea_votes, public.activity;
