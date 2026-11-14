-- ---------------------------------------------------------------------------
-- 0021 — Notifications d'ajout : nouveaux types, réglages, compteur
--
-- POURQUOI
-- --------
-- On veut prévenir le foyer quand quelqu'un ajoute une reco, ou quelque chose
-- sur une liste (courses, tâches, check-lists). Trois choses manquent à la
-- table des notifications pour cela :
--
--  * deux types : `reco_ajoutee` et `liste_ajout`. Un seul type « ajout »
--    aurait mélangé deux réglages que l'on veut pouvoir couper séparément ;
--  * deux réglages par adulte, `reco_added` et `list_items_added`, activés
--    par défaut — comme les autres : le réglage est un retrait ;
--  * un compteur, `group_count`. Quelqu'un qui tape huit articles à la suite
--    ne doit pas déclencher huit notifications : l'écriture regroupe (voir
--    0022) et le compteur sert à dire « a ajouté 8 éléments ».
--
-- PRÉCAUTION
-- ----------
-- Une valeur d'énumération ajoutée ne peut pas être utilisée avant la fin de
-- la transaction qui l'a ajoutée. Ce fichier n'ajoute que les valeurs ; la
-- fonction qui les emploie est dans 0022, donc dans une transaction à part.
--
-- CE QUI A ÉTÉ ÉCARTÉ
-- -------------------
-- Un déclencheur sur chaque table de liste aurait évité de toucher au code
-- applicatif, mais il n'aurait pas su distinguer un ajout à la main d'un
-- ajout en masse (ingrédients d'un repas, copie de semaine) : ceux-là ne
-- doivent pas notifier.
-- ---------------------------------------------------------------------------

alter type public.notification_kind add value if not exists 'reco_ajoutee';
alter type public.notification_kind add value if not exists 'liste_ajout';

alter table public.notification_preferences
  add column if not exists reco_added       boolean not null default true,
  add column if not exists list_items_added boolean not null default true;

alter table public.notifications
  add column if not exists group_count integer not null default 1
    check (group_count between 1 and 1000);
