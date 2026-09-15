# Ce qui a été vérifié, et comment

Le cahier des charges demandait de **distinguer clairement les vérifications
faites avec des simulations de celles faites avec les services réels**. Ce
document tient cette distinction, ligne par ligne. Rien n'y est présenté comme
vérifié si ça ne l'est pas.

Trois catégories, et une quatrième qu'on préférerait vide mais qui ne l'est
pas :

| | Signification |
| --- | --- |
| **Réel** | Exécuté contre le service véritable — la base Supabase du projet, ou le code de production |
| **Simulé** | Exécuté sur de la logique pure, avec des données fabriquées, sans réseau |
| **Non joué** | Écrit, mais pas exécutable depuis l'environnement de développement — la raison est donnée |

---

## 1. Étanchéité entre foyers — **RÉEL**

C'est la vérification la plus importante du projet, et c'est celle qui est la
mieux tenue : elle s'exécute contre la vraie base Postgres, avec les vraies
politiques RLS.

**Comment.** Le script `supabase/tests/isolation.sql` se fait passer pour un
utilisateur connecté (`set local role authenticated` accompagné de
`request.jwt.claims`), exactement comme PostgREST le fait pour une requête
venue du navigateur. Les politiques s'appliquent donc à l'identique — ce n'est
pas une imitation de la sécurité, c'est la sécurité elle-même.

**Ce qui a été tenté**, par un membre d'un autre foyer :

- lire les événements, enfants, tâches, nounous, recommandations, envies de
  recommandation, pièces jointes, membres, invitations, et le foyer lui-même ;
- lire la table des jetons Google, en entier ;
- lire les objets de stockage rangés sous l'identifiant du foyer visé ;
- modifier et supprimer chacune de ces lignes ;
- insérer des lignes portant l'identifiant du foyer visé ;
- s'ajouter comme administrateur de ce foyer ;
- déposer un fichier dans son espace de stockage ;
- accrocher une « envie » de recommandation à la fiche d'un autre foyer, sous
  son propre identifiant de foyer ;
- et, en tant qu'adulte non-administrateur de son **propre** foyer :
  se promouvoir, modifier la fiche d'un autre membre, exclure l'administrateur,
  déclarer une envie de recommandation **au nom d'un autre membre** ;
- accepter une invitation expirée, révoquée, déjà utilisée, ou inventée.

**Résultat : 67 vérifications, 67 conformes.**

Deux exécutions, sur deux bases différentes :

- **36 vérifications contre la base Supabase réelle**, avant l'arrivée de la
  reco. C'est la mesure de référence historique.
- **67 vérifications contre un PostgreSQL 16 local**, après l'ajout des six
  points portant sur `recommendations`, des vingt de l'espace nounou et des
  cinq des check-lists. Les migrations du dépôt y sont rejouées depuis une
  base vide, sur un échafaudage
  reconstituant ce que Supabase fournit d'office (rôles `anon`,
  `authenticated`, `service_role`, schémas `auth` et `storage`, `auth.jwt()`,
  publication `supabase_realtime`).

**Pourquoi le résultat local vaut pour la production.** Une réplique ne prouve
rien si elle diverge de l'original. Les deux schémas ont donc été comparés
après application de `0016`, par empreinte du catalogue plutôt que de visu :
les **141 politiques** de `public` — nom, table, action, rôles, clauses
`using` et `with check` — donnent la **même empreinte `125d9c04…`** des deux
côtés, de même que les colonnes des deux tables de reco et le corps de
`delete_user_data`. Les politiques éprouvées en local sont, à l'octet près,
celles qui tournent en production.

Le script n'a volontairement **pas** été joué contre la base du projet : il
insère dans `auth.users` avant de tout annuler, et la commodité ne justifiait
pas d'écrire, même temporairement, dans la table des comptes réels. Pour le
jouer malgré tout : `psql "$SUPABASE_DB_URL" -f supabase/tests/isolation.sql`.

Depuis la migration `0013`, le script fait intervenir **deux fournisseurs
d'authentification à la fois** : Camille et Alex arrivent par Supabase Auth,
Chloé par une identité au format Clerk (`user_2abc…`) qui n'existe dans aucune
table `auth.users`. Elle crée son profil et son foyer, puis se heurte au foyer
d'à côté sur les dix tables et le stockage. C'est la vérification qui compte
le plus : elle prouve que le découplage n'a pas ouvert de porte.

**L'espace nounou est le cas limite du produit.** Partout ailleurs, une seule
règle suffit : on voit le foyer dont on est membre. Les migrations `0014` et
`0015` introduisent le premier accès accordé à quelqu'un qui n'en est **pas**
membre — c'est donc le premier endroit où « membre » et « autorisé à lire »
cessent de coïncider, et il est couvert depuis. Chloé accepte un lien d'accès
par le vrai chemin applicatif (`accept_nanny_access`, pas une écriture
directe), puis on vérifie les deux côtés de la règle :

- ce qu'elle doit voir — sa fiche nounou, le foyer qui l'emploie, la garde
  qu'on lui confie, l'enfant qu'elle garde, et sa propre indisponibilité
  qu'elle peut déclarer ;
- ce qu'elle ne doit pas voir — le calendrier, les tâches, les courses, les
  recommandations, les pièces jointes, la liste des membres, le foyer d'à
  côté, et **l'enfant du foyer qu'elle ne garde pas**. Ce dernier point est le
  plus instructif : il distingue une politique correctement restreinte aux
  enfants effectivement confiés d'une politique qui ouvrirait tout le foyer.

Elle ne peut ni renommer le foyer, ni y créer un événement.

Les lignes marquées « TÉMOIN » comptent autant que les autres. Sans elles, une
session inerte renverrait zéro partout et l'on conclurait à tort à
l'étanchéité. Les témoins montrent que les mêmes requêtes, faites par quelqu'un
qui y a droit, renvoient bien les données — y compris pour le stockage, et y
compris juste après l'acceptation d'une invitation valide.

Le script s'exécute dans une transaction annulée à la fin : il crée ses comptes
et ses foyers, les interroge, et ne laisse rien derrière lui. Vérifié après
coup : la base est revenue à zéro compte, zéro foyer, zéro objet.

**Pour le rejouer :**

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/isolation.sql
```

ou en collant le fichier dans l'éditeur SQL de Supabase.

---

## 2. Schéma, politiques et conseillers Supabase — **RÉEL**

- **Les 40 tables** de `public` portent la RLS active — vérifié par requête sur
  `pg_class`, pas par relecture des migrations. Deux d'entre elles,
  `google_credentials` et `_tribu_migrations`, ont la RLS active **et aucune
  politique** : elles sont donc invisibles à `anon` comme à `authenticated`.
  C'est le verrou voulu pour les jetons Google, pas un oubli.
- Les **conseillers de sécurité Supabase** ont été relancés après la dernière
  migration. Il reste deux familles de signalements, toutes deux examinées et
  assumées :
  - `rls_enabled_no_policy` (niveau *info*) sur les deux tables ci-dessus —
    c'est le verrou, pas un oubli ;
  - six fonctions `SECURITY DEFINER` appelables par un utilisateur connecté.
    Quatre sont des points d'entrée voulus (`create_household`,
    `invitation_preview`, `accept_invitation`, `current_member_id`). Les deux
    autres (`is_household_member`, `is_household_admin`) sont indispensables
    **dans** les politiques RLS : une politique s'évalue avec les droits de
    l'appelant, on ne peut donc pas leur retirer le droit d'exécution. Elles
    ne renvoient qu'un booléen sur l'appartenance de l'appelant lui-même, à un
    foyer qu'il désigne : elles n'apprennent rien à qui les interroge.
- Les **conseillers de performance** ont conduit à la migration `0011` : index
  sur les clés étrangères réellement filtrées ou jointes, et fusion de deux
  paires de politiques permissives redondantes. L'étanchéité a été **revérifiée
  après** cette fusion — c'est la raison pour laquelle les 36 vérifications
  ci-dessus datent d'après `0011`, et non d'avant.
- **Les conseillers ont été relancés sur le projet réel après `0016`**, le
  14 septembre 2026. Aucun signalement nouveau n'est imputable à la reco :
  - *sécurité* — les deux `rls_enabled_no_policy` habituels
    (`google_credentials`, `_tribu_migrations`, les verrous voulus) ; les
    fonctions `SECURITY DEFINER` appelables passent de six à dix, les quatre
    nouvelles venant de l'espace nounou et de `ensure_profile`.
    `sync_recommendation_done` **n'y figure pas** : le `revoke` de `0016` a
    bien produit son effet.
  - *performance* — aucune clé étrangère sans index, aucune politique
    permissive en double, aucun `auth_rls_initplan` sur les deux tables de
    reco. Leurs politiques passent par `is_household_member()` et
    `current_member_id()`, jamais par `auth.<fonction>()` en direct, ce qui
    évite la réévaluation ligne à ligne.
  - Seuls sept *unused index* concernent la reco : les tables viennent d'être
    créées et sont vides. Le signalement disparaîtra à l'usage.
- **L'effacement des comptes a été audité par requête, pas par relecture.** La
  liste des colonnes `text` du schéma portant un identifiant de compte
  (`%user%` ou `%_by`) a été comparée aux instructions réellement exécutées par
  `public.delete_user_data`. Trois des dix-huit n'étaient pas couvertes :
  `nanny_accesses.user_id`, `invitations.created_by` et
  `households.created_by` — les deux dernières depuis l'origine du projet. La
  migration `0017` les traite, et l'audit rejoué ne signale plus rien. Le
  comportement est vérifié en plus sur base : après suppression d'un compte,
  l'identifiant a disparu partout, le foyer partagé survit, et les
  contributions de la personne y restent, désaffiliées.
- Neuf *multiple permissive policies* et une réévaluation `auth_rls_initplan`
  concernent l'**espace nounou** : deux politiques de lecture cohabitent sur
  les mêmes tables, l'une pour le foyer, l'autre pour la nounou. C'est une
  conséquence du besoin, pas une erreur, mais elle revient à qui tient cette
  fonctionnalité — voir `AVANCEMENT.md`.

---

## 3. Logique métier — **SIMULÉ**

124 tests unitaires Vitest, sur de la logique pure. Aucun réseau, aucune base :
c'est le propre de ces tests, et c'est aussi leur limite.

| Fichier | Tests | Ce qu'il couvre |
| --- | --- | --- |
| `tests/unit/recurrence.test.ts` | 17 | Expansion RRULE, changements d'heure, fin par date ou par compte, relecture d'une règle en français |
| `tests/unit/ingredients.test.ts` | 25 | Analyse « 2 kg de pommes », normalisation, ligatures, conversions d'unités, agrégation, rayons |
| `tests/unit/childcare.test.ts` | 20 | Heures prévues et réalisées, ajustements, tarifs datés, bilan mensuel |
| `tests/unit/google-mapping.test.ts` | 20 | Conversion Google ↔ MyFamily, empreintes de comparaison, droit d'écriture par agenda |
| `tests/unit/exports.test.ts` | 3 | Nom de fichier d'export : ligatures, accents, séparateurs |
| `tests/unit/checklists.test.ts` | 14 | Avancement, ordre stable sous le doigt, lecture d'une liste collée (puces, numéros, doublons) |
| `tests/unit/recommendations.test.ts` | 25 | Vocabulaire par genre, complétion et filtrage des liens, prix à la française, recherche sans accent ni ligature, ordre d'affichage |

`npm test`

Quatre bogues réels ont été trouvés **par** ces tests, pas malgré eux :

1. Une fenêtre d'expansion élargie d'un jour de chaque côté laissait passer une
   occurrence hors période.
2. Le `UNTIL` d'une règle était comparé en temps réel alors que l'expansion
   travaille en heure murale : la dernière occurrence disparaissait ou
   apparaissait en trop selon la saison.
3. `new RRule({freq: WEEKLY}).toString()` ajoutait un `BYDAY` déduit de la date
   du jour — une série créée un jeudi devenait « chaque jeudi » même si
   l'événement tombait un mardi.
4. `String.normalize('NFD')` ne décompose pas « œ » : « Œufs » et « oeufs »
   faisaient deux produits distincts dans la liste de courses.

---

## 4. Compilation et types — **RÉEL**

- `npx tsc --noEmit` : sans erreur.
- `npx next build` : sans erreur, **24 routes** compilées.
- Aucun `any` implicite, aucune assertion de type contournant le schéma de la
  base.

Ce n'est pas un test fonctionnel, mais dans ce projet la compilation attrape
une catégorie précise de fautes : `import 'server-only'` fait échouer la
compilation si un composant client importe par mégarde un module qui manipule
la clé `service_role` ou les jetons Google. La barrière secret / navigateur est
donc vérifiée **à la compilation**, pas seulement par relecture.

---

## 5. Parcours en navigateur — **JOUÉS POUR LA PREMIÈRE FOIS**

Huit fichiers Playwright, 34 tests. Ils étaient jusqu'ici **écrits mais jamais
exécutés** : la politique réseau interdit d'atteindre `*.supabase.co`, et sans
projet joignable la suite se déclarait ignorée. (Un neuvième fichier s'y est
ajouté depuis, `10-navigation.spec.ts`, qui n'a pas encore été joué non plus —
voir plus bas.)

**Ce qui a changé.** Une pile Supabase complète tourne maintenant en local
(`supabase start` : Postgres 17, GoTrue, PostgREST, Realtime, Storage, Kong),
sur laquelle les dix-sept migrations du dépôt s'appliquent. `.env.local` pointe
dessus. Aucune écriture n'est faite dans le projet réel.

### Ce que la première exécution a trouvé

**Un défaut grave, corrigé.** Sans Clerk, *tout* écran touchant à Supabase
plantait sur l'écran « Quelque chose a coincé » : `useSupabase()` appelait
`useAuth()` sans condition, or celui-ci lève hors `ClerkProvider` — lequel
n'est pas monté quand Clerk n'est pas configuré. Quatorze composants étaient
concernés. Le correctif choisit la variante au chargement du module ; détail et
raison dans `CLAUDE.md`.

**Des specs qui visaient à côté.** Écrites sans jamais être jouées, elles
échouaient pour trois raisons qu'il faut distinguer — et la première corrige ce
que la version précédente de ce document affirmait :

| Cause | Exemple | Corrigé |
| --- | --- | --- |
| Mauvais rôle ARIA | le sélecteur de vue du calendrier est un `tablist` : `getByRole('tab')`, pas `'button'`. Le mode « Agenda » existe bien | oui |
| Affirmation jamais vraie | le nom du foyer n'est pas sur l'accueil, mais sur « Plus » | oui |
| Champ replié | la répétition d'un événement vit dans la section qu'on déplie | oui |
| Texte approximatif | l'écran Google dit « Configuration à terminer », pas « non configuré » | oui |
| `check()` qui ne retombe pas | cocher déclenche un rafraîchissement ; un clic suivi de l'assertion dit la même chose | oui |

### Le symptôme trompeur, élucidé — ce n'est pas un défaut produit

Une version précédente de ce document annonçait un défaut possible : « un compte
se reconnecte dans un contexte de navigateur neuf et l'application le renvoie
sur *Créons votre foyer* ». **C'était faux, et la cause est maintenant connue.**

`beforeAll` fabrique un compte pour tout le fichier. Or **Playwright jette le
worker après un échec et en démarre un neuf**, pour garantir un environnement
propre aux tests suivants — `beforeAll` est donc rejoué, et fabrique un
**autre** compte, qui n'a évidemment pas de foyer. Tous les tests suivants du
fichier échouaient alors sur l'écran de bienvenue, pour une raison étrangère à
ce qu'ils vérifient.

Établi par instrumentation, pas par raisonnement : en journalisant ce que
`getActiveHousehold()` observe, un fichier de trois tests montrait **trois
identifiants d'utilisateur différents** — le premier avec son foyer
(`lignes:1`), les deux suivants sans (`lignes:0`). Reproduit isolément sur une
pile saine, une session neuve retrouve son foyer sans faute.

La leçon dépasse ce dépôt : un échec en cascade ressemble à s'y méprendre à un
défaut systémique, et j'ai failli en publier un qui n'existait pas.

**Correctif** : les trois fichiers dont les parcours s'enchaînent sont déclarés
`test.describe.serial`. Après un échec, les suivants sont **sautés** au lieu
d'échouer faussement — le rapport dit alors un défaut là où il y en a un.

### Une vraie trouvaille, celle-là

Le parcours « ajouter le même produit fusionne au lieu de doubler » échoue pour
de bon, et il a mis au jour un écart entre le cahier des charges et le produit.

Taper « 2 kg de pommes » dans la saisie rapide enregistre **le libellé entier**,
quantité et unité vides. La saisie rapide a trois champs séparés — Article,
Quantité, Unité — et ne sait pas analyser une phrase. Elle devine le rayon, et
c'est tout. Aucune fusion ne peut donc avoir lieu : quatre lignes « … pommes »
cohabitaient en base.

Les critères **3.3 et 3.4** de [`FONCTIONNALITES.md`](FONCTIONNALITES.md)
décrivent l'inverse. La logique d'analyse existe pourtant et elle est testée
(`parseUnit`, `normalizeLabel`, `aggregateIngredients`) — mais elle n'est câblée
que sur le chemin repas → courses.

À trancher : compléter la saisie rapide, ou corriger le cahier des charges.
Ce n'est pas une décision de test.

Le parcours précédent, « la saisie rapide devine quantité, unité et rayon »,
**passait à vide** : ses assertions cherchaient « pommes » et « 2 kg » à
l'écran, et les trouvaient… dans le libellé brut.

### État actuel, profil bureau

**13 passent, 4 échouent, 2 sautés, 3 jamais joués** — contre 0 avant ce travail.

| Fichier | Passent | Reste |
| --- | --- | --- |
| `08-reco.spec.ts` | **3/3** | — *également 3/3 en profil mobile (375 px)* |
| `09-checklists.spec.ts` | **2/2** | — *également 2/2 en mobile* : coller, cocher, remettre à zéro |
| `01-foyer-invitation.spec.ts` | **2/2** | — |
| `07-google.spec.ts` | **2/2** | — |
| `06-etancheite.spec.ts` | **1/1** | — |
| `03-listes.spec.ts` | 2/3 | le troisième est la vraie trouvaille ci-dessus |
| `02-calendrier.spec.ts` | 1/3 | l'événement créé n'apparaît pas dans les vues — à creuser |
| `04-repas.spec.ts` | 0/1 | la recette ne s'enregistre pas — à creuser |
| `05-nounous.spec.ts` | 0/2 | le parcours décrit un « Ajouter une garde » qui n'existe pas ; les gardes passent par l'ajout rapide |
| `10-navigation.spec.ts` | **0/3 — jamais exécuté** | écrit avec la barre repensée, voir ci-dessous |

Aucun de ces échecs ne provoque d'erreur applicative côté serveur.

### La barre repensée : ce qui est prouvé, et ce qui ne l'est pas

`10-navigation.spec.ts` a été écrit en même temps que la nouvelle barre de
navigation, et **n'a jamais tourné** : la pile Supabase locale demande Docker,
absent de l'environnement où le travail a été fait. Le dépôt a déjà payé cher
de croire qu'une spec écrite prouve quelque chose — elle est donc comptée
0/3 ici, et le restera jusqu'à une exécution réelle.

Ce qui **a** été vérifié dans un vrai navigateur, c'est la géométrie, la seule
chose en cause dans la question qui a déclenché le travail (« je ne vois pas les
check-lists, elles sont où ? »). Une page d'aperçu montée pour l'occasion, sans
base de données, a rendu la barre, l'entête et les onglets de « Listes » à
375 px, 360 px et 1024 px, en clair et en sombre. Mesures relevées dans le
document plutôt que jugées à l'œil :

| Largeur | Onglet de la barre | Onglet de « Listes » | Débordement |
| --- | --- | --- | --- |
| 375 px | 75 px | 109 px | aucun |
| 360 px | 72 px | 104 px | aucun |

Aucun libellé tronqué, « Calendrier » compris, et l'état actif tient sous son
libellé. Ce que cette page ne prouve pas : qu'un appui mène quelque part, ni
que la puce de notification s'éteint une fois la notification lue. Ce sont
précisément les critères 0.3 et 0.4, ceux que la spec non jouée couvre.

### La grille horaire : ce qui est prouvé, et ce qui ne l'est pas

Les vues « Jour » et « Semaine » sont passées d'une liste à une grille
horaire, et la vue « Mois » des pastilles aux titres. Le placement — quelle
tranche de journée occupe un événement, comment se rangent ceux qui se
chevauchent — vit dans `src/lib/calendar-layout.ts`, hors de tout composant :
**15 tests unitaires** le couvrent, séjour à cheval sur trois jours, soirée
qui finit à minuit et dimanche du changement d'heure compris.

Le rendu, lui, a été regardé dans un vrai navigateur, sur le même principe que
la barre de navigation ci-dessus : une page d'aperçu montée pour l'occasion,
sans base de données, rendue à 390 px et 1280 px, en clair et en sombre, avec
une semaine chargée (chevauchements, rendez-vous de vingt minutes, journée
entière, séjour de 7 h 30 à 20 h). Trois gestes ont été rejoués au pilote :
clic sur un événement (il s'ouvre), clic dans une case vide à 15 h (la
création part sur « 15:00 »), activation au clavier (elle part sur « 07:00 »).
Aucune erreur de page dans les deux thèmes.

Ce que cet aperçu ne prouve pas : que la grille affiche les vrais événements
d'un vrai foyer. C'est ce que couvre `02-calendrier.spec.ts`, qui demande une
pile Supabase, et dont l'assertion sur la vue mois — y lire le titre
« Piscine » — ne pouvait pas passer tant que cette vue ne montrait que des
pastilles. Elle reste comptée telle qu'elle a été jouée pour la dernière fois.

### Pour rejouer

```bash
npx supabase start          # pile locale
npm run test:e2e
```

Dans cet environnement, deux écarts à connaître : `supabase start` ne crée pas
`_tribu_migrations` (c'est `db:push` qui s'en charge), donc `0010` échoue sans
une amorce ; et la version de Playwright du dépôt réclame un Chromium plus
récent que celui préinstallé, qu'il faut donc désigner par `executablePath`.

---

## 6. Google Agenda — **NON JOUÉ contre le service réel**

**Ce qui est vérifié :**

- La conversion entre un événement Google et un événement MyFamily, dans les deux
  sens, est couverte par 20 tests unitaires (**simulé**) : dates et journées
  entières, récurrences, exceptions d'occurrence, annulations, empreintes de
  comparaison, et le fait qu'on n'écrit que dans un agenda où l'on est
  propriétaire ou rédacteur.
- Le contrat de l'API a été lu **dans le document de découverte officiel de
  Google Calendar v3** (révision 20260826), récupéré depuis
  `www.googleapis.com`, et non de mémoire : contraintes exactes du `syncToken`,
  paramètres incompatibles avec lui, sémantique du 410, énumération des rôles
  d'accès, forme de `EventDateTime`.
- Les jetons sont chiffrés en AES-256-GCM avant d'entrer en base, dans une
  table sans aucune politique — vérifié par la lecture réelle de la table, qui
  renvoie zéro ligne à un utilisateur connecté quel qu'il soit.

**Ce qui ne l'est pas :** aucun aller-retour n'a été fait avec le vrai service
Google. Ni `accounts.google.com` ni `oauth2.googleapis.com` ne sont joignables
depuis cet environnement, et le projet n'a pas d'identifiants OAuth. La
synchronisation incrémentale, la reprise après un `syncToken` périmé, et la
détection de conflit par `etag` sont **écrites d'après la spécification, non
observées**.

C'est précisément la raison pour laquelle l'écran Google ne prétend jamais
avoir synchronisé : tant que personne n'a fait tourner le vrai flux, une
interface optimiste serait un mensonge. Les étapes pour débloquer
l'intégration sont dans [`GOOGLE.md`](GOOGLE.md).

---

## Récapitulatif

| Domaine | Vérifié comment | État |
| --- | --- | --- |
| Étanchéité entre foyers (Supabase Auth **et** Clerk) | Base Supabase réelle, RLS active | **36/36** |
| Étanchéité, reco, espace nounou et check-lists | PostgreSQL 16 local, migrations rejouées ; schéma prouvé identique à la production par empreinte | **67/67** |
| Effacement d'un compte : couverture des 18 colonnes | Audit du catalogue + exécution sur base | **complète après `0017`** |
| Migration `0016` appliquée en production | Empreinte du SQL enregistré = celle du fichier testé | **conforme** |
| Fidélité des migrations `0014`/`0015` reconstituées | Empreinte MD5 du corps = celle du journal Supabase | **exacte** |
| Conseillers Supabase après `0016` | Service réel | **aucun signalement nouveau dû à la reco** |
| Invitations : expiration, révocation, rejeu, jeton inventé | Base réelle | **conforme** |
| Élévation de privilège dans son propre foyer | Base réelle | **bloquée** |
| Jetons Google invisibles au navigateur | Base réelle | **conforme** |
| Conseillers de sécurité Supabase | Service réel | **2 signalements, tous deux assumés et expliqués** |
| Récurrences, ingrédients, gardes, Google, exports, recos, check-lists, grille horaire | Tests unitaires | **139/139** |
| Types et compilation | `tsc` et `next build` | **sans erreur** |
| Parcours en navigateur, reco | Playwright sur pile Supabase locale | **6/6** (bureau et mobile) |
| Parcours en navigateur, le reste | Playwright sur pile Supabase locale | **13/19 — 1 défaut produit corrigé, 7 specs réparées, 1 écart cahier des charges / produit trouvé** |
| Google Agenda de bout en bout | — | **non joué — aucun identifiant OAuth** |
