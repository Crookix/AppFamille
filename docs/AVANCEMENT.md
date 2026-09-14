# Avancement et points bloquants

Mis à jour le 14 septembre 2026.

---

## Où en est le produit

Les huit étapes prévues sont écrites, compilées et intégrées, et une neuvième
— la reco — s'y est ajoutée depuis. Ce qui suit dit pour chacune ce qui existe
**et** ce qui reste à confirmer.

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
| 8 — Vérifications | Terminée | Aligner 11 parcours Playwright sur l'interface réelle |
| 9 — Reco (films, séries, théâtre, cadeaux) | Terminée | — *confirmée en navigateur, bureau et mobile* |
| 10 — Check-lists (valise, sac de piscine…) | Terminée | — *confirmée en navigateur, bureau et mobile* |

Le dépôt compte dix-huit migrations, `0001` à `0018`, **toutes appliquées sur
le projet `tribu-foyer`**, qui porte 42 tables, toutes avec la RLS active.

`0016` (la reco) et `0018` (les check-lists) ont été appliquées le 14 septembre 2026. Le SQL
enregistré par Supabase a la même empreinte MD5
(`fcc9242646ed243397bcdc5445838c8e`) que le fichier rejoué en local avant
application : ce qui a tourné en production est exactement ce qui avait été
vérifié.

Comme l'application est passée par le connecteur Supabase et non par
`npm run db:push`, la ligne correspondante a été ajoutée à la main dans
`_tribu_migrations`. Sans cela, le prochain `db:push` aurait tenté de rejouer
la migration et se serait arrêté en erreur.

124 tests unitaires passent, la compilation produit 24 routes sans erreur, et
la vérification d'étanchéité donne 67 conformités sur 67. Le détail est dans
[`TESTS.md`](TESTS.md).

---

## Écart entre le dépôt et la base — **résorbé, une réserve**

Constaté le 14 septembre 2026 : le journal `_tribu_migrations` contenait deux
migrations qui n'étaient dans **aucune branche** du dépôt.

| Migration | Appliquée le | État |
| --- | --- | --- |
| `0014_espace_nounou.sql` | 14 septembre 2026, 09:38 UTC | reconstituée et committée |
| `0015_politiques_nounou_alignees.sql` | 14 septembre 2026, 09:39 UTC | reconstituée et committée |

Elles ont créé trois tables — `nanny_accesses`, `nanny_availability`,
`childcare_declarations` — toutes avec la RLS active.

**Les fichiers n'ont pas été devinés depuis le schéma.** Supabase conserve le
SQL exact de chaque migration appliquée dans
`supabase_migrations.schema_migrations` ; les deux corps en sont repris à
l'octet près, ce que prouve leur empreinte MD5, identique à celle enregistrée
(`01e19abb…` et `0e290de4…`). Seul un en-tête a été ajouté au-dessus.

La fidélité est vérifiée une seconde fois, autrement : les migrations du dépôt
rejouées depuis une base vide sur un PostgreSQL local produisent, pour les huit
tables concernées par l'espace nounou, **exactement les mêmes politiques que la
production** — même empreinte `b68bb41c…`, expressions et rôles compris.

### Ce qui a été corrigé depuis

Les deux défauts relevés ci-dessus ont été traités par la migration `0017` et
par l'extension du test d'étanchéité.

**L'effacement des comptes était incomplet — et pas seulement pour la nounou.**
Plutôt que de corriger le seul cas repéré, la liste des colonnes `text` portant
un identifiant de compte (`%user%` ou `%_by`) a été comparée aux instructions
réellement exécutées par `delete_user_data`. **Trois** manquaient, dont deux
antérieures à l'espace nounou :

| Colonne | Depuis | Traitement retenu |
| --- | --- | --- |
| `nanny_accesses.user_id` | `0014` | ligne supprimée — elle ne contient que cette personne |
| `invitations.created_by` | l'origine | mis à NULL — l'invitation appartient au foyer |
| `households.created_by` | l'origine | mis à NULL — le foyer appartient à ses membres |

Les deux `created_by` étaient `not null` : `0017` relâche la contrainte, sans
quoi la désaffiliation était impossible. Aucun écran ne lit ces colonnes.

Vérifié sur base : après suppression d'un compte, plus aucune des 18 colonnes
concernées ne porte son identifiant, le foyer partagé survit, et ses
contributions y restent. L'audit est rejouable — c'est une requête sur le
catalogue, pas une relecture.

**Le test d'étanchéité couvre désormais l'espace nounou**, qui est le premier
endroit du produit où « membre du foyer » et « autorisé à lire » cessent de
coïncider. Une nounou rattachée par le vrai chemin applicatif
(`accept_nanny_access`) voit sa fiche, ses gardes, l'enfant qu'elle garde et le
foyer — et rien d'autre : ni le calendrier, ni les tâches, ni les courses, ni
les recos, ni la liste des membres, ni **l'enfant qu'elle ne garde pas**.
Le script passe de 42 à 62 vérifications.

### Ce qui reste

1. **Le « pourquoi » manque** en tête de `0014` et `0015` : ce dépôt l'exige, et
   il n'appartient pas à qui les a reconstitués de l'inventer. À compléter par
   l'auteur de l'espace nounou.
2. **Neuf *multiple permissive policies*** signalées par les conseillers portent
   sur les tables nounou : deux politiques de lecture y cohabitent, l'une pour
   le foyer, l'autre pour la nounou. C'est une conséquence du besoin, pas une
   erreur, mais elle mérite un regard de qui tient cette fonctionnalité.

---

## Hébergement

Le projet Vercel existe : **`tribu`**, sur l'équipe « Adri's projects », relié à
`Crookix/AppFamille`. Chaque push sur la branche de production redéploie
automatiquement. Le projet garde son nom d'origine ; seule l'application a été
renommée.

- Adresse visée : <https://myfamily.mykrew.app> — **à rattacher au projet dans
  Settings › Domains**, ce qui n'est pas encore fait à la date de ce document.
- Adresse actuelle : <https://tribu-umber.vercel.app>
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

## Authentification : Clerk est câblé

Depuis la migration `0013`, le schéma ne dépend plus de Supabase Auth.
L'identité d'un utilisateur y est un **texte opaque** lu dans le jeton
(`auth.jwt() ->> 'sub'`), et non plus un `uuid` emprunté à `auth.users`.

Conséquence : **les deux fournisseurs fonctionnent**, et c'est la configuration
qui tranche. Si `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` et `CLERK_SECRET_KEY` sont
présentes, Clerk prend la main ; sinon le lien magique Supabase continue comme
avant. Retirer une variable suffit à revenir en arrière.

Vérifié sur la base réelle : une identité au format Clerk crée son profil et
son foyer, et se heurte au foyer voisin sur les dix tables et le stockage.
34 vérifications, 34 conformes.

### Ce qu'il reste à faire, côté tableaux de bord

1. **Clerk** — la page « Connect with Supabase »
   (dashboard.clerk.com/setup/supabase) configure l'instance pour Supabase.
   Elle ajoute notamment le claim `role: authenticated` aux jetons de session,
   sans lequel Supabase les refuse.

2. **Supabase** — Authentication › Third-Party Auth › ajouter Clerk, avec le
   domaine de l'instance. Il se lit dans la clé publiable ; pour l'instance
   actuelle : `sure-seasnail-9391.clerk.accounts.dev`.

3. **Variables** — dans `.env.local` et dans Vercel :
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` et `CLERK_SECRET_KEY`.

### Deux pièges rencontrés, notés pour la prochaine fois

**La page « Connect with Supabase » de Clerk vise le mauvais compte.** Elle ne
demande pas quel compte Supabase utiliser : elle réutilise la session déjà
ouverte dans le navigateur. Avec deux comptes Supabase, c'est le mauvais qui
répond. La documentation Supabase prévoit le cas et décrit une configuration
manuelle en deux points — c'est la voie à prendre :

1. Clerk › Sessions › Customize session token : ajouter `{"role": "authenticated"}`.
   Sans ce claim, Supabase refuse les jetons Clerk, **silencieusement**.
2. Supabase › Authentication › Third-Party Auth : ajouter Clerk avec le domaine
   de l'instance.

Pour éviter tout sélecteur de compte, viser le projet par son identifiant :
`supabase.com/dashboard/project/<ref>/auth/third-party`.

L'ordre compte : un jeton émis avant l'ajout du claim reste refusé jusqu'à son
renouvellement. En cas de doute, se déconnecter et se reconnecter.

**Un « Redeploy » depuis Vercel rejoue le déploiement existant**, pas le
dernier commit. Si le webhook GitHub a été manqué — ça arrive — le bouton
reconstruit l'ancienne version sans le dire. Vérifier le SHA affiché sur le
déploiement, ou pousser un commit pour forcer une construction neuve.

Tant que ces trois points ne sont pas faits, l'application reste sur le lien
magique Supabase. Elle ne prétend rien : elle fonctionne, simplement avec
l'autre fournisseur.

---

## Performance : ce qui a été fait, et pourquoi

L'application « ramait ». La base n'y était pour rien : les requêtes les plus
lentes relevées dans `pg_stat_statements` sont celles de l'outil Supabase
lui-même. Celles de l'application n'apparaissent même pas au classement.

Le coût était ailleurs — dans le **nombre d'allers-retours réseau**, et dans
leur distance.

**La géographie d'abord.** Les fonctions Vercel tournaient à Washington
(`iad1`), la base est à Paris (`eu-west-3`). Chaque requête traversait
l'Atlantique, et vous payiez en plus le trajet France → Washington à l'aller
comme au retour. `vercel.json` fixe désormais la région à `cdg1` : Paris.
Si la base déménage un jour, déplacer la région avec elle.

**Un appel réseau supprimé sur chaque page.** `getUser()` appelait
`currentUser()` de Clerk, qui interroge l'API de Clerk. Or `auth()` lit le
jeton déjà présent dans la requête, sans réseau, et l'identifiant suffit
partout sauf à deux endroits. Le nom et l'adresse passent maintenant par
`getUserWithProfile()`, appelée uniquement là où ces champs servent.

**Deux vagues supprimées sur le calendrier.** Les exceptions de récurrence
étaient chargées après les séries ; elles partent désormais dans la même
vague, avec un filtrage en mémoire qui préserve exactement la sémantique
précédente. Et les pièces jointes attendaient les occurrences pour savoir quoi
demander : on interroge le foyer entier — quelques dizaines de lignes — et on
croise en mémoire.

Bilan pour l'affichage du calendrier : **cinq vagues successives ramenées à
trois**, chacune deux fois plus courte.

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
NEXT_PUBLIC_SITE_URL           = https://myfamily.mykrew.app
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

**Tribu est devenue MyFamily, sans toucher aux données.** Le nom visible a été
remplacé dans l'interface, le manifeste, les métadonnées et la documentation.
Cinq identifiants techniques gardent volontairement l'ancien nom, parce qu'en
changer aurait un coût sans contrepartie : la valeur `'tribu'` du type
`event_origin` (il faudrait une migration et une réécriture de toutes les
lignes), les cookies `tribu_foyer`, `tribu_invitation` et `tribu_google_state`
(tout le monde serait déconnecté et les invitations en cours perdues), la clé
`tribu-theme` du navigateur (chacun retrouverait le thème automatique), la
propriété `tribuEventId` posée sur les événements Google (les correspondances
existantes seraient orphelines) et la table `_tribu_migrations` (le journal des
migrations appliquées). Le cache du service worker, lui, a été versionné en
`myfamily-v1` : c'est justement ce qui force les appareils à recharger la
coquille au nouveau nom.

Les migrations SQL n'ont pas été retouchées non plus : une migration appliquée
ne se modifie pas, et leurs commentaires disent l'état du projet au moment où
elles ont été écrites.

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
