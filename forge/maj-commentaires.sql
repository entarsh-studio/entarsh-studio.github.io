-- =====================================================================
-- Forge — mise à jour : pièces jointes dans les commentaires des tâches
-- (comptes rendus avec fichiers, captures…)
-- À coller dans Supabase > SQL Editor > New query > Run
-- =====================================================================
alter table public.messages add column if not exists files jsonb not null default '[]'::jsonb;
-- un commentaire peut maintenant ne contenir que des fichiers (texte vide autorisé)
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check check (char_length(body) <= 2000);
