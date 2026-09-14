-- ---------------------------------------------------------------------------
-- 0015 — Les politiques de l'espace nounou visent explicitement `authenticated`
--
-- FICHIER RECONSTITUÉ — À RELIRE PAR SON AUTEUR
-- --------------------------------------------
-- Appliquée sur le projet Supabase le 14 septembre 2026 à 09:39 UTC, une
-- minute après `0014`, et absente du dépôt elle aussi. Corps repris à
-- l'octet près du journal des migrations ; empreinte MD5
-- `0e290de4fc6226d177da5bba94196c12`, identique à celle enregistrée. Seul
-- cet en-tête a été ajouté.
--
-- CE QUE FAIT CETTE MIGRATION
-- ---------------------------
-- Les politiques de `0014` avaient été créées sans clause `to`, ce qui les
-- applique à `public` — donc aussi au rôle `anon`. Toutes les politiques du
-- reste du produit visent explicitement `authenticated` (voir `0003`). Cette
-- migration les réaligne, une par une.
--
-- Elle en profite pour resserrer « acces nounou: la nounou lit le sien » :
-- la clause `using` exige désormais un accès accepté et non révoqué.
-- ---------------------------------------------------------------------------

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

alter policy "acces nounou: la nounou lit le sien"
  on public.nanny_accesses
  using (
    user_id = (select auth.jwt() ->> 'sub')
    and accepted_at is not null
    and revoked_at is null
  );
