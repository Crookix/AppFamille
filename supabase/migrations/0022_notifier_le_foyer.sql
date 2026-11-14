-- ---------------------------------------------------------------------------
-- 0022 — notify_household : prévenir les autres adultes d'un ajout
--
-- POURQUOI UNE FONCTION, ET PAS UN INSERT DEPUIS L'APPLICATION
-- ------------------------------------------------------------
-- La notification d'attribution d'une tâche lit le réglage du destinataire
-- avant d'écrire. Or la politique de `notification_preferences` ne laisse lire
-- que **ses propres** réglages : la requête ne renvoie jamais rien pour
-- quelqu'un d'autre, et l'absence de ligne vaut « activé ». Le réglage du
-- destinataire n'est donc, en pratique, jamais respecté. Pour les ajouts,
-- qui touchent tous les adultes du foyer, on ne reproduit pas l'erreur : le
-- tri par réglage se fait ici, côté base, là où toutes les lignes sont
-- visibles.
--
-- CE QUE FAIT LA FONCTION
-- -----------------------
--  * refuse un appelant qui n'est pas membre du foyer (42501) ;
--  * n'accepte que les deux types d'ajout : elle ne sert pas à fabriquer une
--    notification « invitation acceptée » ou « garde à confirmer » ;
--  * notifie les autres membres, jamais l'auteur, et saute ceux qui ont
--    coupé ce réglage ;
--  * regroupe : si le destinataire a déjà une notification non lue du même
--    type, pour le même lien et le même auteur, créée il y a moins de dix
--    minutes, elle est mise à jour (compteur, texte) au lieu d'être doublée.
--
-- Le texte « pluriel » contient `{n}`, remplacé ici par le compteur. On
-- n'utilise pas `format()` : le texte contient le nom d'une liste saisi par
-- un utilisateur, et un `%` dedans ferait échouer l'appel.
--
-- SECURITY DEFINER est nécessaire (écrire pour d'autres, lire leurs
-- réglages). Le contrôle d'appartenance est donc fait à la main, en tête.
-- ---------------------------------------------------------------------------

create or replace function public.notify_household(
  p_household_id uuid,
  p_kind         public.notification_kind,
  p_title        text,
  p_body         text,
  p_body_many    text,
  p_link         text,
  p_count        integer default 1
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  text := public.current_user_id();
  v_n     integer := least(greatest(coalesce(p_count, 1), 1), 1000);
  v_title text := left(coalesce(p_title, ''), 200);
  r       record;
  v_rows  integer;
begin
  if v_user is null or not public.is_household_member(p_household_id) then
    raise exception 'Vous n''êtes pas membre de ce foyer.' using errcode = '42501';
  end if;

  if p_kind not in ('reco_ajoutee', 'liste_ajout') then
    raise exception 'Type de notification non autorisé.' using errcode = '22023';
  end if;

  -- Un lien interne seulement : jamais d'adresse extérieure dans une alerte.
  if p_link is not null and p_link !~ '^/[A-Za-z0-9/_?=&%.-]*$' then
    raise exception 'Lien non autorisé.' using errcode = '22023';
  end if;

  for r in
    select hm.user_id
    from public.household_members hm
    left join public.notification_preferences np
           on np.household_id = hm.household_id and np.user_id = hm.user_id
    where hm.household_id = p_household_id
      and hm.user_id <> v_user
      and case p_kind
            when 'reco_ajoutee' then coalesce(np.reco_added, true)
            else coalesce(np.list_items_added, true)
          end
  loop
    update public.notifications n
       set group_count = least(n.group_count + v_n, 1000),
           body        = replace(left(coalesce(p_body_many, p_body), 500), '{n}',
                                 least(n.group_count + v_n, 1000)::text),
           created_at  = now()
     where n.id = (
       select id from public.notifications
       where household_id = p_household_id
         and user_id = r.user_id
         and kind = p_kind
         and actor_user_id = v_user
         and link is not distinct from p_link
         and read_at is null
         and created_at > now() - interval '10 minutes'
       order by created_at desc
       limit 1
     );

    get diagnostics v_rows = row_count;

    if v_rows = 0 then
      insert into public.notifications
        (household_id, user_id, kind, title, body, link, actor_user_id, group_count)
      values (
        p_household_id, r.user_id, p_kind, v_title,
        case when v_n > 1
             then replace(left(coalesce(p_body_many, p_body), 500), '{n}', v_n::text)
             else left(p_body, 500) end,
        p_link, v_user, v_n
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.notify_household(uuid, public.notification_kind, text, text, text, text, integer)
  from public, anon;
grant execute on function public.notify_household(uuid, public.notification_kind, text, text, text, text, integer)
  to authenticated;
