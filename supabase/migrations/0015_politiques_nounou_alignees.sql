-- ===========================================================================
-- MyFamily — 0015 — Aligner les politiques de l'espace nounou sur la maison
--
-- POURQUOI
--
-- Deux remarques des conseillers Supabase, relevées juste après l'application
-- de la migration 0014. Toutes deux portent sur des politiques que 0014 vient
-- de créer, et aucune ne se corrige en modifiant ce fichier : une migration
-- appliquée ne se modifie jamais, on en ajoute une autre.
--
-- 1. LE RÔLE. Les vingt-et-une politiques écrites depuis 0001 sont portées
--    `to authenticated`. Les vingt-et-une de 0014 ne nommaient aucun rôle,
--    donc PostgreSQL les a attachées à `public`, c'est-à-dire à tous les
--    rôles — `anon` compris.
--
--    Ce n'était pas une fuite : un visiteur anonyme n'a pas de `sub` dans son
--    jeton, `is_household_member()` et `is_linked_nanny()` renvoient donc
--    faux, et aucune ligne ne sort. Mais une politique qui s'applique à un
--    rôle auquel elle n'était pas destinée est une politique qu'on relit mal,
--    et la sécurité de ce projet repose sur des politiques qu'on relit bien.
--
-- 2. LA RÉÉVALUATION PAR LIGNE. `acces nounou: la nounou lit le sien` lisait
--    `auth.jwt() ->> 'sub'` directement : PostgreSQL le réévalue alors pour
--    CHAQUE ligne examinée. Enveloppé dans un `(select …)`, il est calculé
--    une fois pour toute la requête. Les autres politiques de 0014 passent
--    par `is_linked_nanny()`, qui enveloppe déjà correctement.
--
-- `alter policy` suffit : recréer les politiques les ferait disparaître puis
-- réapparaître, et entre les deux instants la table serait grande ouverte ou
-- complètement fermée selon l'ordre. Ici rien ne s'ouvre à aucun moment.
-- ===========================================================================

-- --- 1. Le rôle ------------------------------------------------------------

alter policy "acces nounou: le foyer lit"          on public.nanny_accesses to authenticated;
alter policy "acces nounou: le foyer invite"       on public.nanny_accesses to authenticated;
alter policy "acces nounou: le foyer revoque"      on public.nanny_accesses to authenticated;
alter policy "acces nounou: le foyer supprime"     on public.nanny_accesses to authenticated;
alter policy "acces nounou: la nounou lit le sien" on public.nanny_accesses to authenticated;

alter policy "indispos: le foyer lit"              on public.nanny_availability to authenticated;
alter policy "indispos: la nounou lit les siennes" on public.nanny_availability to authenticated;
alter policy "indispos: la nounou ajoute"          on public.nanny_availability to authenticated;
alter policy "indispos: la nounou modifie"         on public.nanny_availability to authenticated;
alter policy "indispos: la nounou supprime"        on public.nanny_availability to authenticated;

alter policy "declarations: le foyer lit"               on public.childcare_declarations to authenticated;
alter policy "declarations: le foyer tranche"           on public.childcare_declarations to authenticated;
alter policy "declarations: le foyer supprime"          on public.childcare_declarations to authenticated;
alter policy "declarations: la nounou lit les siennes"  on public.childcare_declarations to authenticated;
alter policy "declarations: la nounou declare"          on public.childcare_declarations to authenticated;
alter policy "declarations: la nounou corrige"          on public.childcare_declarations to authenticated;

alter policy "nounous: la nounou lit sa fiche"          on public.nannies to authenticated;
alter policy "gardes: la nounou lit les siennes"        on public.childcare_sessions to authenticated;
alter policy "enfants gardes: la nounou lit les siens"  on public.childcare_session_children to authenticated;
alter policy "enfants: la nounou lit ceux qu'elle garde" on public.children to authenticated;
alter policy "foyers: la nounou lit le sien"            on public.households to authenticated;

-- --- 2. Une seule évaluation de l'identité, pas une par ligne --------------

alter policy "acces nounou: la nounou lit le sien"
  on public.nanny_accesses
  using (
    user_id = (select auth.jwt() ->> 'sub')
    and accepted_at is not null
    and revoked_at is null
  );
