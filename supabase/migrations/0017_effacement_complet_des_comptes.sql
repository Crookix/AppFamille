-- ---------------------------------------------------------------------------
-- 0017 — `delete_user_data` oubliait trois colonnes
--
-- POURQUOI
-- --------
-- `public.delete_user_data()` (migration `0013`) est le chemin du droit à
-- l'effacement : depuis que le schéma ne dépend plus de `auth.users`, plus
-- aucune cascade ne nettoie derrière un compte supprimé, et c'est cette
-- fonction qui doit le faire, explicitement, table par table.
--
-- « Explicitement, table par table » a un défaut : la liste se périme dès
-- qu'une colonne s'ajoute ailleurs, et rien ne le signale. L'audit du
-- 14 septembre 2026 a comparé la liste des colonnes `text` du schéma qui
-- portent un identifiant de compte (`%user%` ou `%_by`) aux instructions
-- réellement exécutées par la fonction. Trois manquaient :
--
--   * `nanny_accesses.user_id`      — arrivée avec l'espace nounou (`0014`)
--   * `invitations.created_by`      — oubliée depuis l'origine
--   * `households.created_by`       — oubliée depuis l'origine
--
-- Autrement dit : l'identifiant de quelqu'un survivait à la suppression de
-- son compte, dans les foyers qu'il avait fondés, dans les invitations qu'il
-- avait émises, et dans son rattachement de nounou.
--
-- COMMENT CHACUNE EST TRAITÉE
-- ---------------------------
-- La fonction distingue depuis l'origine deux catégories, et les trois
-- colonnes s'y rangent sans exception nouvelle :
--
--   « Ce qui est nominatif disparaît. »
--   `nanny_accesses` est le rattachement d'une personne à une fiche nounou :
--   la ligne ne contient qu'elle — son identifiant, son adresse, le condensat
--   de son lien. Elle est supprimée. La fiche nounou du foyer, ses
--   indisponibilités et ses déclarations d'heures restent : elles pointent
--   vers `nanny_id`, qui appartient au foyer, pas à la personne.
--
--   « Ce qui est collectif reste, mais désaffilié. »
--   Un foyer et ses invitations appartiennent au foyer, pas à qui les a
--   créés. Leur `created_by` est donc mis à NULL, comme l'est déjà celui d'un
--   événement ou d'une tâche.
--
-- CE QUI OBLIGE À TOUCHER AU SCHÉMA
-- ---------------------------------
-- Les deux `created_by` étaient `not null` : impossible de les désaffilier
-- sans relâcher la contrainte. C'est fait ci-dessous. Aucun écran ne lit ces
-- colonnes — l'application ne fait que les écrire à la création — et aucune
-- clé étrangère ne s'y appuie ; la seule conséquence visible est que le type
-- TypeScript correspondant devient `string | null`.
--
-- CE QUI RESTE, ET QUI S'ASSUME
-- -----------------------------
-- Une invitation encore en attente garde l'adresse à laquelle elle a été
-- envoyée, même si son émetteur supprime son compte. Cette adresse est celle
-- de l'invité, pas de l'émetteur : l'effacer reviendrait à effacer la donnée
-- d'un tiers à la demande d'un autre. Elle disparaît avec l'invitation quand
-- celle-ci est révoquée ou que le foyer est supprimé.
-- ---------------------------------------------------------------------------

alter table public.households  alter column created_by drop not null;
alter table public.invitations alter column created_by drop not null;

create or replace function public.delete_user_data(p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_foyers_supprimes int := 0;
  v_foyers_quittes   int := 0;
  r record;
begin
  if nullif(btrim(coalesce(p_user_id, '')), '') is null then
    raise exception 'Identifiant manquant.' using errcode = '22023';
  end if;

  -- Foyers dont cette personne est le seul membre : suppression complète.
  for r in
    select hm.household_id
    from public.household_members hm
    where hm.user_id = p_user_id
      and (select count(*) from public.household_members o
           where o.household_id = hm.household_id) = 1
  loop
    delete from public.households where id = r.household_id;
    v_foyers_supprimes := v_foyers_supprimes + 1;
  end loop;

  -- Foyers partagés : on retire la personne, le contenu reste aux autres.
  delete from public.household_members where user_id = p_user_id;
  get diagnostics v_foyers_quittes = row_count;

  -- Ce qui est nominatif disparaît.
  delete from public.notifications            where user_id = p_user_id;
  delete from public.notification_preferences where user_id = p_user_id;
  delete from public.google_accounts          where user_id = p_user_id;
  -- Le rattachement à une fiche nounou ne contient que cette personne :
  -- son identifiant, son adresse et le condensat de son lien d'accès.
  delete from public.nanny_accesses           where user_id = p_user_id;

  -- Ce qui est collectif reste, mais désaffilié : le contenu du foyer
  -- appartient au foyer, pas à celui qui l'a saisi.
  update public.notifications    set actor_user_id = null where actor_user_id = p_user_id;
  update public.households       set created_by    = null where created_by    = p_user_id;
  update public.events           set created_by    = null where created_by    = p_user_id;
  update public.tasks            set created_by    = null where created_by    = p_user_id;
  update public.shopping_lists   set created_by    = null where created_by    = p_user_id;
  update public.shopping_items   set created_by    = null where created_by    = p_user_id;
  update public.recipes          set created_by    = null where created_by    = p_user_id;
  update public.meals            set created_by    = null where created_by    = p_user_id;
  update public.childcare_sessions set created_by  = null where created_by    = p_user_id;
  update public.recommendations  set created_by    = null where created_by    = p_user_id;
  update public.attachments      set uploaded_by   = null where uploaded_by   = p_user_id;
  update public.invitations      set created_by    = null where created_by    = p_user_id;
  update public.invitations      set accepted_by   = null where accepted_by   = p_user_id;

  delete from public.profiles where id = p_user_id;

  return jsonb_build_object(
    'foyers_supprimes', v_foyers_supprimes,
    'foyers_quittes',   v_foyers_quittes
  );
end;
$$;

-- Jamais appelable depuis le navigateur : elle traverse les foyers et ignore
-- la RLS. Seul le serveur, avec la clé de service, doit pouvoir l'invoquer.
revoke all on function public.delete_user_data(text) from public, anon, authenticated;
