-- =====================================================================
-- Forge — mise à jour : tâches « Tout le monde » cochables par tous
-- À coller une fois dans Supabase > SQL Editor > New query > Run
-- =====================================================================

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
