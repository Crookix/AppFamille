# Avancement et points bloquants

Mis à jour le 10 septembre 2026.

---

## Où en est le produit

Les huit étapes prévues sont écrites, compilées et intégrées. Ce qui suit dit
pour chacune ce qui existe **et** ce qui reste à confirmer.

| Étape | État | Reste à faire |
| --- | --- | --- |
| 0 — Socle technique | Terminée | — |
| 0b — Schéma SQL et RLS | Terminée | — |
| 1 — Comptes, foyer, invitations, enfants | Terminée | Confirmer en navigateur |
| 2 — Calendrier, déplacements, pièces jointes | Terminée | Confirmer en navigateur |
| 3 — Tâches et courses | Terminée | Confirmer en navigateur |
| 4 — Repas et génération des courses | Terminée | Confirmer en navigateur |
| 5 — Nounous, heures, bilans | Terminée | Confirmer en navigateur |
| 6 — Google Agenda | Écrite | **Demande une configuration externe** — voir plus bas |
| 7 — Notifications, PWA, mode démo | Terminée | Confirmer sur un vrai téléphone |
| 8 — Vérifications | Terminée | Jouer les parcours Playwright |

Douze migrations sont appliquées sur le projet Supabase. La base compte
35 tables, toutes protégées par la RLS. 82 tests unitaires passent, la
compilation produit 23 routes sans erreur, et la vérification d'étanchéité
donne 36 conformités sur 36. Le détail est dans [`TESTS.md`](TESTS.md).

---

## Hébergement

Le projet Vercel existe : **`tribu`**, sur l'équipe « Adri's projects », relié à
`Crookix/AppFamille`. Chaque push sur la branche de production redéploie
automatiquement.

- Adresse publique : <https://tribu-umber.vercel.app>
- Tableau de bord : <https://vercel.com/adris-projects-cf9c71fa/tribu>

Le premier déploiement est en ligne et se comporte comme prévu : faute de
variables d'environnement, il affiche « Installation à terminer » et la marche
à suivre — pas une pile d'erreurs. C'est le comportement voulu, mais l'appli ne
sera utilisable qu'une fois les variables renseignées (étape 1 ci-dessous).

**À savoir : le dépôt GitHub est public.** Aucun secret n'y figure — c'est
vérifié — mais le code, les migrations et cette documentation sont visibles de
tous. Si ce n'est pas voulu, passez le dépôt en privé ; Vercel continuera de
déployer.

---

## Ce qui vous attend

Trois choses ne peuvent pas être faites depuis l'environnement de
développement. Elles sont classées de la plus courte à la plus longue.

### 1. Renseigner les variables d'environnement — 5 minutes

**Sur Vercel** (Settings › Environment Variables), pour les trois
environnements. Les deux premières sont publiques par construction — la
sécurité repose sur la RLS, pas sur leur secret :

```
NEXT_PUBLIC_SUPABASE_URL       = https://<votre-projet>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  = sb_publishable_…
NEXT_PUBLIC_SITE_URL           = https://tribu-umber.vercel.app
NEXT_PUBLIC_ENABLE_DEMO        = 1
SUPABASE_SERVICE_ROLE_KEY      = …            (secret)
TOKEN_ENCRYPTION_KEY           = …            (secret)
```

`NEXT_PUBLIC_SITE_URL` compte : c'est elle qui fabrique les liens d'invitation
et l'URI de retour Google. Laissée sur `localhost`, les invitations envoyées
depuis la production pointeraient vers le poste de développement.

**En local**, `.env.local` contient déjà l'URL et la clé publiable. Deux
valeurs restent vides :

```bash
# Dashboard Supabase > Project Settings > API > service_role
SUPABASE_SERVICE_ROLE_KEY=

# Générer avec :  openssl rand -base64 32
TOKEN_ENCRYPTION_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` est nécessaire à l'acceptation d'invitation, au
mode démonstration et aux parcours Playwright. `TOKEN_ENCRYPTION_KEY` chiffre
les jetons Google ; sans elle, l'autorisation d'agenda refuse de démarrer
plutôt que de stocker un jeton en clair.

Il faudra aussi ajouter `SUPABASE_DB_URL` (Dashboard > Connect) si vous voulez
appliquer les migrations depuis votre poste avec `npm run db:push`.

**Aucune de ces valeurs ne doit entrer dans un fichier suivi par git.**
`.env.local` est ignoré ; `git check-ignore .env.local` le confirme.

### 2. Jouer les parcours en navigateur — 15 minutes

```bash
npm run dev
npm run test:e2e
```

28 parcours, écrits et vérifiés syntaxiquement, jamais exécutés. Ils n'ont pas
pu l'être ici parce que la politique réseau de l'environnement refuse les
connexions vers `*.supabase.co` :

```
CONNECT tunnel failed, response 403 — <votre-projet>.supabase.co:443
```

Ce n'est pas une supposition : c'est la réponse de la passerelle. L'application
démarre, mais aucune requête vers la base n'aboutit.

Les sélecteurs visent des libellés visibles ; certains devront probablement être
ajustés au premier passage. C'est le prix d'un test qui vérifie aussi que
l'interface reste lisible.

### 3. Mettre en place Google Agenda — 30 minutes, dont une attente

C'est le seul lot qui demande une action hors du dépôt. La marche à suivre
complète est dans [`GOOGLE.md`](GOOGLE.md) ; en résumé :

1. Console Google Cloud > créer un projet.
2. Activer l'**API Google Calendar**.
3. Écran de consentement OAuth : type externe, portées
   `calendar.events` et `calendar.calendarlist.readonly`.
4. Créer un **ID client OAuth 2.0** de type « Application Web », avec comme URI
   de redirection autorisé :
   `<NEXT_PUBLIC_SITE_URL>/api/google/callback`
   (soit `http://localhost:3000/api/google/callback` en développement).
5. Reporter `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `.env.local`.
6. Pour la connexion **avec** Google (distincte de l'agenda) : activer le
   fournisseur Google dans Supabase > Authentication > Providers.

Tant que ces variables sont absentes, l'écran « Plus › Google Agenda » affiche
« non configuré » et explique quoi faire. **Il n'affiche jamais une
synchronisation réussie** — c'était une exigence explicite, et c'est vérifié par
un parcours dédié (`tests/e2e/07-google.spec.ts`).

---

## Décisions prises en cours de route

Elles sont notées ici parce qu'elles engagent la suite.

**Un projet Supabase entièrement séparé.** Le cahier des charges demandait un
projet indépendant des autres applications ; c'est le cas, sur un compte
distinct. Aucune table, aucune fonction, aucun compartiment de stockage n'est
partagé avec quoi que ce soit d'autre.

**Un projet existant n'a pas été mis en pause.** Quand la limite du forfait
gratuit a demandé de libérer une place, l'un des projets candidats — Clichy
Triathlon — s'est révélé servir 96 membres, avec du trafic deux minutes plus
tôt. Le mettre en pause aurait coupé un service vivant pour installer un
projet neuf. Un second compte Supabase a été utilisé à la place.

**L'élévation de rôle est bloquée par un déclencheur, pas par une politique.**
Une clause `WITH CHECK` ne voit que la nouvelle ligne : elle ne peut pas
comparer l'ancien rôle au nouveau. Un membre aurait donc pu se promouvoir
administrateur en modifiant sa propre fiche — ce que la politique aurait
autorisé, puisqu'il modifiait bien sa fiche. Le contrôle est un
`BEFORE UPDATE`, et la tentative est vérifiée dans le script d'étanchéité.

**Les suppressions Google passent par une file.** Quand un événement est
supprimé, le lien vers son homologue Google part en cascade avec lui — et avec
lui l'identifiant nécessaire pour prévenir Google. Un déclencheur `BEFORE
DELETE` dépose l'identifiant dans une file avant que la cascade ne l'efface
(migration `0009`).

**Les jetons Google sont dans une table sans aucune politique.** Ce n'est pas
un oubli de politique : c'est la politique. Une table avec RLS active et zéro
politique est invisible à tout rôle non privilégié, ce qui est exactement le
comportement voulu. Le conseiller Supabase la signale, et ce signalement est
assumé.

---

## Ce qui n'est pas prévu

Pour éviter de le chercher : pas de notifications poussées hors application, pas
d'application native, pas de synchronisation Apple ou Outlook, pas de partage
de calendrier hors du foyer, pas de budget familial au-delà des règlements de
garde.
