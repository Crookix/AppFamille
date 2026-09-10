-- ---------------------------------------------------------------------------
-- 0012 — Les participants d'un événement passent aussi en temps réel
--
-- Le calendrier s'actualise chez l'autre parent quand un événement change.
-- Mais ajouter ou retirer un participant ne touche que `event_participants` :
-- la ligne `events`, elle, ne bouge pas. Sans cette publication, « Léa vient
-- finalement avec nous » n'apparaissait pas sur l'autre téléphone.
--
-- Publier une table ne la rend pas lisible : Supabase Realtime applique les
-- mêmes politiques RLS que le reste. Un foyer ne reçoit que ses propres
-- changements.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.event_participants;
