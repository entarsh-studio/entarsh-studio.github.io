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
