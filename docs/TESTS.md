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

**Résultat : 62 vérifications, 62 conformes.**

Deux exécutions, sur deux bases différentes :

- **36 vérifications contre la base Supabase réelle**, avant l'arrivée de la
  reco. C'est la mesure de référence historique.
- **62 vérifications contre un PostgreSQL 16 local**, après l'ajout des six
  points portant sur `recommendations` et `recommendation_wants`, puis des
  vingt de l'espace nounou. Les migrations du dépôt y sont rejouées depuis une
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

110 tests unitaires Vitest, sur de la logique pure. Aucun réseau, aucune base :
c'est le propre de ces tests, et c'est aussi leur limite.

| Fichier | Tests | Ce qu'il couvre |
| --- | --- | --- |
| `tests/unit/recurrence.test.ts` | 17 | Expansion RRULE, changements d'heure, fin par date ou par compte, relecture d'une règle en français |
| `tests/unit/ingredients.test.ts` | 25 | Analyse « 2 kg de pommes », normalisation, ligatures, conversions d'unités, agrégation, rayons |
| `tests/unit/childcare.test.ts` | 20 | Heures prévues et réalisées, ajustements, tarifs datés, bilan mensuel |
| `tests/unit/google-mapping.test.ts` | 20 | Conversion Google ↔ MyFamily, empreintes de comparaison, droit d'écriture par agenda |
| `tests/unit/exports.test.ts` | 3 | Nom de fichier d'export : ligatures, accents, séparateurs |
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

## 5. Parcours en navigateur — **NON JOUÉ**

Huit fichiers Playwright, 34 tests, couvrant la création d'un foyer et
l'invitation, le calendrier et les récurrences, les tâches et les courses, les
repas et la génération de la liste, les gardes et le bilan mensuel, les
recommandations et leurs envies, l'étanchéité vue depuis l'interface, et
l'honnêteté de l'écran Google.

Ils se chargent et se listent correctement (`npx playwright test --list` →
34 tests dans 8 fichiers), mais **ils n'ont pas été exécutés**.

**Pourquoi.** La politique réseau de l'environnement de développement refuse
les connexions vers `*.supabase.co`. Vérifié, et pas supposé :

```
CONNECT tunnel failed, response 403
host: <votre-projet>.supabase.co:443
detail: gateway answered 403 to CONNECT (policy denial)
```

L'application démarre, mais aucune requête vers la base n'aboutit ; un parcours
joué dans ces conditions échouerait sur la connexion, pas sur le produit. C'est
d'ailleurs pour cette raison que la vérification d'étanchéité passe par SQL :
ce chemin-là, lui, est disponible.

**Pour les jouer**, sur un poste dont le réseau atteint Supabase :

```bash
npm run dev
npm run test:e2e
```

Il faut `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local` — uniquement pour
fabriquer les comptes de test et leurs liens de connexion. Sans elle, chaque
fichier s'annonce comme ignoré **en disant ce qui manque** ; aucun ne passe à
vide.

Tant que ces parcours n'ont pas tourné, les critères d'acceptation de
[`FONCTIONNALITES.md`](FONCTIONNALITES.md) marqués « fait, non vérifié en
navigateur » restent à confirmer. Ils sont écrits pour être vérifiables à la
main en quelques minutes si vous préférez commencer par là.

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
| Étanchéité, reco et espace nounou compris | PostgreSQL 16 local, migrations rejouées ; schéma prouvé identique à la production par empreinte | **62/62** |
| Effacement d'un compte : couverture des 18 colonnes | Audit du catalogue + exécution sur base | **complète après `0017`** |
| Migration `0016` appliquée en production | Empreinte du SQL enregistré = celle du fichier testé | **conforme** |
| Fidélité des migrations `0014`/`0015` reconstituées | Empreinte MD5 du corps = celle du journal Supabase | **exacte** |
| Conseillers Supabase après `0016` | Service réel | **aucun signalement nouveau dû à la reco** |
| Invitations : expiration, révocation, rejeu, jeton inventé | Base réelle | **conforme** |
| Élévation de privilège dans son propre foyer | Base réelle | **bloquée** |
| Jetons Google invisibles au navigateur | Base réelle | **conforme** |
| Conseillers de sécurité Supabase | Service réel | **2 signalements, tous deux assumés et expliqués** |
| Récurrences, ingrédients, gardes, conversion Google, exports, recommandations | Tests unitaires | **110/110** |
| Types et compilation | `tsc` et `next build` | **sans erreur** |
| Parcours en navigateur | Playwright | **écrits (34), non joués — réseau bloqué** |
| Google Agenda de bout en bout | — | **non joué — aucun identifiant OAuth** |
