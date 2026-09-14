---
name: relire-migration
description: Relire une migration SQL de MyFamily avant de l'appliquer, et vérifier après coup. À utiliser dès qu'on ajoute ou modifie un fichier de supabase/migrations, ou avant d'appliquer quoi que ce soit sur le projet Supabase.
---

# Relire une migration

Les règles ci-dessous ne sont pas des préférences de style : chacune vient
d'une panne réelle, consignée dans la section « Erreurs déjà commises » de
`CLAUDE.md`.

## Avant d'écrire

1. **Numéroter d'après la base, pas d'après le dépôt.** Le dépôt peut être en
   retard : le journal qui fait foi est `public._tribu_migrations` sur le
   projet. Il est déjà arrivé que deux migrations soient appliquées sans que
   leurs fichiers soient committés.
2. **Un en-tête qui dit POURQUOI.** Pas ce que fait le SQL — cela se lit — mais
   ce qui a rendu le changement nécessaire, et ce qu'on a écarté.
3. **Ne jamais modifier une migration déjà appliquée.** On en ajoute une autre.

## La liste de contrôle

- [ ] Toute nouvelle table porte `household_id` et
      `alter table … enable row level security`, avec ses politiques **dans le
      même fichier**. Une table sans politique est invisible : c'est voulu pour
      `google_credentials` et `_tribu_migrations`, c'est un oubli ailleurs.
- [ ] Les politiques lisent `auth.jwt() ->> 'sub'`, **jamais `auth.uid()`** —
      qui lève `22P02` sur un identifiant non-UUID et fait tomber la politique
      entière au lieu de refuser l'accès.
- [ ] Les politiques visent explicitement `to authenticated`. Sans clause `to`,
      elles s'appliquent à `public`, donc aussi à `anon`.
- [ ] Toute clé étrangère vers `households` ou `household_members` est indexée :
      sans index, supprimer un foyer ou un membre parcourt toute la table.
- [ ] Une clause `with check` ne voit que la ligne nouvelle. Pour comparer
      l'ancienne valeur à la nouvelle, il faut un déclencheur `BEFORE UPDATE`.
- [ ] **Toute colonne `text` portant un identifiant de compte s'appelle
      `*user*` ou `*_by`**, et est traitée par `delete_user_data`. La
      convention de nommage fait partie du garde-fou : `effacement.sql`
      reconnaît les colonnes à leur nom.
- [ ] Les fonctions déclenchées portent `set search_path = public, pg_temp`, et
      leur droit d'exécution est révoqué (`revoke all … from public, anon,
      authenticated`).

## Vérifier avant d'appliquer

Rejouer **toutes** les migrations depuis une base vide, dans l'ordre
alphabétique de `db:push` — c'est ce qui attrape les dépendances oubliées :

```bash
psql "$LOCAL_DB_URL" -f supabase/tests/echafaudage.sql
SUPABASE_DB_URL="$LOCAL_DB_URL" npm run db:push
psql "$LOCAL_DB_URL" -f supabase/tests/isolation.sql   # attendu : ÉTANCHE
psql "$LOCAL_DB_URL" -f supabase/tests/effacement.sql  # attendu : EFFACEMENT COMPLET
```

Si la migration ajoute une table que quelqu'un d'extérieur au foyer peut lire —
comme l'espace nounou — **étendre `isolation.sql`** : c'est le seul endroit qui
vérifie que « membre du foyer » et « autorisé à lire » ne se désalignent pas.
Un témoin qui réussit compte autant qu'une tentative qui échoue : sans lui, une
session inerte renverrait zéro partout et l'on conclurait à tort à
l'étanchéité.

## Après avoir appliqué

- [ ] Relancer les **conseillers Supabase**, sécurité et performance. Les
      comparer aux signalements déjà assumés (`docs/TESTS.md`) : ce qui compte
      est ce qui est *nouveau*.
- [ ] Rejouer `isolation.sql` et `effacement.sql` sur la base réelle.
- [ ] Si l'application est passée par le connecteur plutôt que par
      `npm run db:push`, **ajouter la ligne à `_tribu_migrations` à la main** —
      sinon le prochain `db:push` rejouera la migration et s'arrêtera en
      erreur.
- [ ] Vérifier que ce qui a tourné est ce qui a été testé : comparer
      l'empreinte du SQL enregistré à celle du fichier.
