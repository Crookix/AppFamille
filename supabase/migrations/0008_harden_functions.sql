-- ===========================================================================
-- Tribu — 0008 — Durcissement des privilèges d'exécution
--
-- Postgres accorde EXECUTE à PUBLIC sur toute fonction nouvellement créée, et
-- Supabase expose le schéma `public` en RPC sur `/rest/v1/rpc/<fonction>`.
-- Résultat : sans révocation explicite, chaque fonction SECURITY DEFINER est
-- appelable depuis internet, y compris sans être connecté.
--
-- Aucune de ces fonctions n'était exploitable en l'état — celles qui comptent
-- vérifient `auth.uid()` et refusent un appel anonyme — sauf
-- `invitation_preview`, qui révélait le nom d'un foyer à qui présentait un
-- jeton valable sans être connecté. On referme ici l'ensemble de la surface
-- plutôt que ce seul cas.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Fonctions de déclencheur : jamais appelées directement.
--
-- Un déclencheur s'exécute sans que l'appelant ait besoin du droit EXECUTE :
-- on peut donc les fermer complètement.
-- ---------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.guard_household_member_update() from public, anon, authenticated;
revoke all on function public.guard_last_admin() from public, anon, authenticated;
revoke all on function public.bump_event_revision() from public, anon, authenticated;
revoke all on function public.sync_task_completion() from public, anon, authenticated;
revoke all on function public.sync_shopping_item_checked() from public, anon, authenticated;
revoke all on function public.sync_childcare_flags() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fonctions d'appartenance : appelées par les policies RLS.
--
-- Une expression de policy est évaluée avec les droits de l'utilisateur
-- courant : le rôle `authenticated` doit donc conserver EXECUTE. Le rôle
-- `anon`, lui, n'a aucune raison de les appeler.
-- ---------------------------------------------------------------------------

revoke all on function public.is_household_member(uuid) from public, anon;
revoke all on function public.is_household_admin(uuid) from public, anon;
revoke all on function public.current_member_id(uuid) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_admin(uuid) to authenticated;
grant execute on function public.current_member_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Opérations métier : réservées aux personnes connectées.
-- ---------------------------------------------------------------------------

revoke all on function public.create_household(text, text, text) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.invitation_preview(text) from public, anon;
grant execute on function public.create_household(text, text, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.invitation_preview(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Utilitaires en SECURITY INVOKER : ils n'élèvent aucun privilège, mais
-- n'ont rien à faire dans l'API publique non plus.
-- ---------------------------------------------------------------------------

revoke all on function public.nanny_rate_at(uuid, date) from public, anon;
revoke all on function public.safe_uuid(text) from public, anon;
revoke all on function public.storage_household_id(text) from public, anon;
grant execute on function public.nanny_rate_at(uuid, date) to authenticated;
grant execute on function public.safe_uuid(text) to authenticated;
grant execute on function public.storage_household_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Toute fonction créée ensuite hérite du même défaut fermé.
-- ---------------------------------------------------------------------------

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
