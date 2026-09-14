-- ===========================================================================
-- Effacement d'un compte — la liste de `delete_user_data` est-elle à jour ?
-- ===========================================================================
--
-- POURQUOI CE SCRIPT EXISTE
-- -------------------------
-- Depuis la migration `0013`, le schéma ne dépend plus de `auth.users` : plus
-- aucune cascade ne nettoie derrière un compte supprimé. C'est
-- `public.delete_user_data()` qui doit le faire, explicitement, table par
-- table.
--
-- « Explicitement, table par table » a un défaut : la liste se périme dès
-- qu'une colonne s'ajoute ailleurs, et **rien ne le signale**. Une relecture
-- ne suffit pas — l'audit du 14 septembre 2026 a trouvé trois colonnes
-- oubliées, dont deux dataient de l'origine du projet, sous les yeux de tout
-- le monde depuis des mois.
--
-- Ce script pose la question à Postgres plutôt qu'à un lecteur : il compare
-- les colonnes qui portent un identifiant de compte aux instructions que la
-- fonction exécute réellement.
--
-- COMMENT LE LIRE
-- ---------------
-- Chaque ligne porte un verdict :
--   OK      — la colonne est traitée par la fonction
--   OUBLIÉE — un identifiant de compte y survivrait à la suppression
--
-- CE QU'IL NE VOIT PAS
-- --------------------
-- Il repère les colonnes `text` dont le nom contient « user » ou finit par
-- « _by ». Une colonne qui porterait un identifiant sous un autre nom lui
-- échapperait : la convention de nommage fait partie du garde-fou.
-- Il vérifie qu'une instruction vise la bonne table et cite la bonne colonne,
-- pas que le traitement soit le bon — supprimer ou désaffilier reste un choix
-- à faire en connaissance de cause.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/effacement.sql
-- ===========================================================================

\pset footer off

with fonction as (
  select p.prosrc as corps
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'delete_user_data'
),
-- Le corps, découpé en instructions, commentaires retirés : un nom de table
-- cité dans un commentaire ne prouve rien.
instructions as (
  select btrim(i.instruction) as instruction
  from fonction f,
       lateral (
         select string_agg(l.ligne, E'\n' order by l.ord) as sans_commentaires
         from regexp_split_to_table(f.corps, E'\n') with ordinality as l(ligne, ord)
         where btrim(l.ligne) not like '--%'
       ) net,
       lateral regexp_split_to_table(net.sans_commentaires, ';') as i(instruction)
  where btrim(i.instruction) <> ''
),
-- Les colonnes qui peuvent porter l'identifiant opaque d'un compte.
colonnes as (
  select c.relname as table_, a.attname as colonne
  from pg_attribute a
  join pg_class c     on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attnum > 0
    and not a.attisdropped
    and format_type(a.atttypid, a.atttypmod) = 'text'
    and (a.attname like '%user%' or a.attname like '%\_by')
),
verdicts as (
  select
    col.table_,
    col.colonne,
    exists (
      select 1 from instructions ins
      where ins.instruction ~* ('\m(update|delete\s+from)\s+public\.' || col.table_ || '\M')
        and ins.instruction ~  ('\m' || col.colonne || '\M')
    ) as traitee
  from colonnes col
)
select
  table_ || '.' || colonne as colonne,
  case when traitee then 'OK' else 'OUBLIÉE' end as verdict
from verdicts
order by traitee, table_, colonne;

-- Conclusion : ce que la migration suivante devra corriger, s'il y a lieu.
with fonction as (
  select p.prosrc as corps from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'delete_user_data'
),
instructions as (
  select btrim(i.instruction) as instruction
  from fonction f,
       lateral (
         select string_agg(l.ligne, E'\n' order by l.ord) as sans_commentaires
         from regexp_split_to_table(f.corps, E'\n') with ordinality as l(ligne, ord)
         where btrim(l.ligne) not like '--%'
       ) net,
       lateral regexp_split_to_table(net.sans_commentaires, ';') as i(instruction)
  where btrim(i.instruction) <> ''
),
colonnes as (
  select c.relname as table_, a.attname as colonne
  from pg_attribute a
  join pg_class c     on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0
    and not a.attisdropped
    and format_type(a.atttypid, a.atttypmod) = 'text'
    and (a.attname like '%user%' or a.attname like '%\_by')
),
verdicts as (
  select col.table_, col.colonne,
    exists (
      select 1 from instructions ins
      where ins.instruction ~* ('\m(update|delete\s+from)\s+public\.' || col.table_ || '\M')
        and ins.instruction ~  ('\m' || col.colonne || '\M')
    ) as traitee
  from colonnes col
)
select
  count(*)                                   as colonnes_examinees,
  count(*) filter (where not traitee)         as oubliees,
  case when count(*) = 0 then 'AUDIT INVALIDE — aucune colonne examinée'
       when count(*) filter (where not traitee) = 0 then 'EFFACEMENT COMPLET'
       else 'DES IDENTIFIANTS SURVIVRAIENT' end as conclusion
from verdicts;
