-- ---------------------------------------------------------------------------
-- 0010 — Verrouillage du journal de migrations
--
-- `_tribu_migrations` vit dans le schéma `public`, donc PostgREST l'expose.
-- Ce n'est pas un secret, mais publier la liste des migrations d'une base
-- revient à publier la carte de ses tables : autant ne pas le faire.
--
-- Le verrou est le même que celui de `google_credentials` : RLS activé et
-- AUCUNE politique. Postgres refuse alors toute ligne à `anon` comme à
-- `authenticated` ; seul le rôle de service, qui contourne RLS, y accède.
-- ---------------------------------------------------------------------------

alter table public._tribu_migrations enable row level security;

revoke all on table public._tribu_migrations from anon, authenticated;
