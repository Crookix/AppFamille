# MyFamily — repères pour travailler sur ce dépôt

MyFamily est une application de gestion du foyer : le calendrier familial, les
tâches, les courses, les repas, les heures de garde et les recommandations de
la famille au même endroit, sur téléphone comme sur ordinateur.

L'application s'appelait **Tribu** jusqu'en septembre 2026. Le nom visible a
changé partout, mais **quatre identifiants techniques gardent l'ancien** parce
que les renommer casserait des données en place : la valeur `'tribu'` du type
`event_origin`, les cookies `tribu_foyer`, `tribu_invitation` et
`tribu_google_state`, la clé de thème `tribu-theme` dans le navigateur, et la
table de journal `_tribu_migrations`. Les rencontrer n'est pas un oubli de
renommage.

Ce fichier dit **comment on travaille ici** : les commandes, les conventions,
et les quelques règles qu'on ne contourne pas. Le détail des fonctionnalités
est dans [`docs/FONCTIONNALITES.md`](docs/FONCTIONNALITES.md), l'état des
vérifications dans [`docs/TESTS.md`](docs/TESTS.md), l'intégration Google dans
[`docs/GOOGLE.md`](docs/GOOGLE.md).

---

## Commandes

| Commande | Ce qu'elle fait |
| --- | --- |
| `npm run dev` | Serveur de développement sur `http://localhost:3000` |
| `npm run build` | Compilation de production (échoue sur la moindre erreur TypeScript) |
| `npm start` | Sert la compilation de production |
| `npm run typecheck` | `tsc --noEmit` — plus rapide que `build` pour une boucle de travail |
| `npm test` | Tests unitaires Vitest (logique pure : récurrence, gardes, ingrédients, Google) |
| `npm run test:watch` | Les mêmes, en continu |
| `npm run test:e2e` | Parcours navigateur Playwright — demande une application qui tourne |
| `npm run db:push` | Applique les migrations SQL manquantes sur la base Supabase |

`npm run db:push` lit `SUPABASE_DB_URL` dans `.env.local`, applique les fichiers
de `supabase/migrations` dans l'ordre alphabétique, chacun dans sa propre
transaction, et note les fichiers appliqués dans `_tribu_migrations`. Une
migration déjà appliquée n'est jamais rejouée.

**Avant de pousser du code : `npm run typecheck && npm test && npm run build`.**

---

## Mise en route

1. `npm install`
2. `cp .env.example .env.local`, puis renseigner les valeurs. Le fichier
   `.env.example` explique où trouver chacune. **Aucun secret réel ne doit
   entrer dans un fichier suivi par git** — `.env.local` est ignoré, vérifiez-le
   avec `git check-ignore .env.local` si un doute subsiste.
3. `npm run db:push` pour créer le schéma.
4. `npm run dev`.

Sans variables Supabase, l'application démarre quand même et affiche un écran
d'explication plutôt qu'une pile d'erreurs. Sans variables Google, tout
fonctionne sauf la synchronisation d'agenda, qui s'annonce comme non configurée.

---

## Architecture

```
src/
  app/
    (app)/            écrans connectés (accueil, calendrier, listes, repas, reco, plus)
    api/google/       connexion, retour d'autorisation, synchronisation, révocation
    auth/callback/    retour d'authentification Supabase
    bienvenue/        création ou choix du foyer
    connexion/        lien magique Supabase, ou Clerk s'il est configuré
    invitation/[token]/  aperçu et acceptation d'une invitation
  components/         composants d'interface, groupés par domaine
  lib/
    actions/          Server Actions — tout ce qui écrit passe par là
    data/             lectures composées, appelées par les Server Components
    google/           OAuth, client API, correspondance et synchronisation
    supabase/         quatre clients : navigateur, serveur, middleware, admin
    auth.ts           utilisateur connecté (Clerk ou Supabase), foyer actif
    clerk.ts          détection de Clerk, domaine de l'instance
    recurrence.ts     RRULE, expansion des occurrences
    childcare.ts      heures de garde et bilans mensuels
    recommendations.ts vocabulaire par genre, liens, prix, tri des recos
    ingredients.ts    normalisation et agrégation des ingrédients
supabase/
  migrations/         schéma et RLS, numérotés, jamais modifiés après coup
  tests/isolation.sql vérification d'étanchéité entre foyers
tests/unit/           tests Vitest
```

### Les quatre clients Supabase

| Fichier | Rôle | Précaution |
| --- | --- | --- |
| `supabase/client.ts` | navigateur | clé publiable, RLS active |
| `supabase/server.ts` | Server Components et Server Actions | clé publiable, session de l'utilisateur, RLS active |
| `supabase/middleware.ts` | rafraîchissement de session | ne fait que ça |
| `supabase/admin.ts` | `service_role`, **contourne la RLS** | serveur uniquement, et seulement là où c'est indispensable |

Côté navigateur, `useSupabase()` est le seul point d'entrée — jamais
`createClient()` directement. La seule exception est l'écran de connexion, qui
ne touche que `supabase.auth`, avant toute session. Avec Clerk, le jeton ne
vient plus des cookies, et un client mal outillé partirait en anonyme — la RLS
ne renverrait rien et l'écran s'afficherait vide, sans erreur. C'est le genre de
panne qu'on met une heure à diagnostiquer.

`admin.ts` est réservé aux routes Google (`connect`, `callback`, `sync`,
`disconnect`), qui agissent pour le compte d'un utilisateur absent et écrivent
les jetons. Le foyer de démonstration, lui, n'en a pas besoin : il est créé avec
les droits ordinaires de la personne connectée, RLS comprise. **Toute nouvelle
utilisation doit être justifiée par un commentaire et précédée d'un contrôle
d'appartenance explicite.**

---

## Conventions

### Langue

**Tout ce que voit l'utilisateur est en français**, sans exception : libellés,
messages d'erreur, dates, formats de nombres. Les commentaires de code et les
messages de commit aussi. Les identifiants techniques (noms de tables, de
colonnes, de variables) restent en anglais.

Le tutoiement est proscrit ; l'application vouvoie. Pas de jargon technique dans
les messages : « Ce lien a expiré » et non « invalid token ».

### Écritures : toujours par une Server Action

Aucun composant n'écrit directement dans Supabase depuis le navigateur. Toute
mutation est une Server Action de `src/lib/actions/`, et suit le même patron :

```ts
'use server';

export async function renommerFoyerAction(input: unknown): Promise<ActionResult> {
  const parsed = Schema.safeParse(input);          // 1. valider avec Zod
  if (!parsed.success) return fail('…');

  const guard = await requireActiveHousehold();     // 2. contrôler l'appartenance
  if (!guard.ok) return guard;

  const { error } = await guard.data.supabase…      // 3. écrire (la RLS re-vérifie)
  if (error) return fail(humanizeDbError(error));

  revalidatePath('/plus/foyer');                    // 4. rafraîchir
  return ok();
}
```

Les quatre étapes sont toutes obligatoires. Le contrôle d'appartenance n'est pas
redondant avec la RLS : il produit un message clair là où la base produirait une
erreur opaque, et il couvre les rares chemins qui empruntent le client admin.

Toutes les actions renvoient le même `ActionResult`, ce qui permet un affichage
d'erreur homogène côté interface.

### Performance : compter les allers-retours, pas les requêtes

Les fonctions Vercel tournent à **Paris** (`cdg1`, fixé dans `vercel.json`),
au plus près de la base (`eu-west-3`). Elles étaient à Washington au départ :
chaque requête traversait l'Atlantique, deux fois. Si la base est un jour
déplacée, déplacer la région avec elle.

Ce qui coûte cher n'est pas le nombre de requêtes mais le nombre de **vagues
successives** : dix requêtes groupées dans un `Promise.all` coûtent un
aller-retour, deux requêtes enchaînées en coûtent deux. Grouper dès que les
requêtes ne dépendent pas l'une de l'autre.

`getUser()` ne fait **aucun** appel réseau : `auth()` lit le jeton déjà présent
dans la requête. C'est `getUserWithProfile()` qui interroge l'API de Clerk pour
le nom et l'adresse — à n'appeler que là où ces champs servent vraiment, soit
la création du profil et l'écran de bienvenue.

### Lectures

Les Server Components lisent directement, via `supabase/server.ts`. Les lectures
un peu composées vivent dans `src/lib/data/`. `getUser()` et
`getActiveHousehold()` sont enveloppés dans `cache()` : les appeler depuis
plusieurs composants d'une même page ne coûte qu'un aller-retour.

Les jointures imbriquées de PostgREST ne sont pas toujours typables ; quand le
type se dérobe, faire deux requêtes simples plutôt que forcer un `as any`.

### Migrations

Un fichier par changement, numéroté (`0012_…sql`), avec un en-tête qui explique
**pourquoi**. Une migration appliquée n'est jamais modifiée : on en ajoute une
autre. Toute nouvelle table part avec :

```sql
alter table public.ma_table enable row level security;
```

et ses politiques dans le même fichier. Une table sans politique est invisible —
c'est le comportement voulu pour `google_credentials` et `_tribu_migrations`,
c'est un oubli partout ailleurs.

Après toute migration, relancer les conseillers Supabase (« advisors ») et le
script `supabase/tests/isolation.sql`.

### Dates et fuseaux

Tout est stocké en `timestamptz`. L'affichage passe par `src/lib/datetime.ts`,
qui formate en français et dans le fuseau du foyer. L'expansion des récurrences
utilise une astuce d'« heure murale » documentée dans `src/lib/recurrence.ts` :
ne pas la simplifier sans lire les tests, elle existe pour survivre aux
changements d'heure.

### Interface

Tailwind v4, jetons de couleur déclarés en `@theme` dans `globals.css`, thèmes
clair et sombre. Ne pas écrire de couleur en dur : utiliser les jetons
sémantiques. Le zoom reste autorisé, les cibles tactiles font au moins 44 px, et
chaque écran doit rester utilisable à 375 px de large.

---

## Règles de sécurité

Ces cinq règles sont la raison d'être d'une bonne partie du code. Elles ne se
négocient pas.

1. **Chaque table porte `household_id` et une politique RLS fondée sur
   `is_household_member()`.** Les données d'un foyer ne sortent jamais de ce
   foyer.
   L'identité de l'appelant est un **texte** lu dans le jeton
   (`auth.jwt() ->> 'sub'`), jamais `auth.uid()` : avec un identifiant Clerk,
   `auth.uid()` ne renvoie pas NULL, il lève `22P02` et fait tomber la
   politique entière. Voir la migration `0013`.
2. **Aucun secret ne franchit la frontière du navigateur.** Seules les variables
   `NEXT_PUBLIC_*` sont publiques. `SUPABASE_SERVICE_ROLE_KEY`,
   `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET` et les jetons Google restent
   côté serveur. Les modules qui les touchent importent `server-only`, ce qui
   fait échouer la compilation si un composant client les importe par mégarde.
3. **Rien de sensible dans les journaux.** On journalise un identifiant
   d'événement, jamais un jeton, un en-tête d'autorisation ni le corps d'une
   réponse Google.
4. **Les invitations sont limitées dans le temps et revérifiées à
   l'acceptation.** Seul le condensat SHA-256 du jeton est stocké ; la base ne
   contient jamais le lien lui-même.
5. **Aucune synchronisation Google ne s'affiche comme réussie si elle ne l'est
   pas.** Une configuration absente se dit ; une erreur se montre.

Les fichiers `src/lib/supabase/admin.ts`, `src/lib/google/crypto.ts` et
`src/lib/google/oauth.ts` sont les points sensibles : toute modification demande
une relecture attentive.

---

## Erreurs déjà commises, à ne pas refaire

- **`with check (household_id = household_id)`** est une tautologie, pas un
  contrôle. Une clause `WITH CHECK` ne voit que la nouvelle ligne : pour
  comparer l'ancienne valeur à la nouvelle (empêcher une auto-promotion en
  administrateur), il faut un déclencheur `BEFORE UPDATE`.
- **`new RRule({freq: WEEKLY}).toString()`** ajoute un `BYDAY` déduit de la date
  du jour. Les chaînes RRULE sont construites à la main dans `recurrence.ts`.
- **`rrulestr()`** invente un `DTSTART` à maintenant ; utiliser
  `RRule.parseString()` pour relire une règle.
- **`String.normalize('NFD')` ne décompose pas « œ ».** Sans
  `expandLigatures()`, « Œufs » et « oeufs » deviennent deux produits distincts
  dans la liste de courses.
- **Un fichier de route Next ne peut exporter que ses gestionnaires HTTP.** Les
  constantes partagées vont dans `src/lib/`.
- **`auth.uid()` n'est pas neutre face à un identifiant non-UUID.** Il lève
  `22P02`, ce qui fait échouer la politique au lieu de simplement refuser
  l'accès. Toute nouvelle politique lit `auth.jwt() ->> 'sub'`.
- **`createServerClient` / `createBrowserClient` de `@supabase/ssr` sont
  incompatibles avec l'option `accessToken`.** Ces clients s'abonnent en
  interne à `onAuthStateChange` pour tenir les cookies à jour, or `accessToken`
  interdit tout accès à `supabase.auth`. Les combiner lève « Supabase Client is
  configured with the accessToken option » **à l'exécution seulement** — la
  compilation passe. Quand un fournisseur tiers tient la session, utiliser
  `createClient` de `@supabase/supabase-js`, sans cookies.
- **Les organisations Clerk bloquent la session tant qu'elles ne sont pas
  réglées.** Instance avec les organisations activées : après connexion, Clerk
  impose un écran « Configurer votre organisation ». Tant qu'il n'est pas
  franchi, la session reste en attente et `auth()` ne renvoie rien au serveur —
  l'application ne voit donc personne, et aucun profil n'est créé. Le symptôme
  trompe : la personne est bien « connectée » selon Clerk, mais l'application se
  comporte comme si elle ne l'était pas. MyFamily n'utilise pas les organisations :
  **les désactiver dans le tableau de bord Clerk.** Et attention, on ne
  reproduit pas le problème depuis un compte qui a déjà franchi l'étape.
- **Un écran qui dépend d'un script distant doit dire quand il ne vient pas.**
  Le formulaire de Clerk est monté côté navigateur : le HTML servi ne contient
  que l'en-tête. Si le script est bloqué — Safari iPhone et les ressources d'un
  domaine tiers, cas le plus fréquent — la page reste figée sur le logo, sans
  bouton ni message, indéfiniment. Toujours prévoir `ClerkLoading` avec un état
  de chargement, puis un aveu et une porte de sortie au-delà de quelques
  secondes.
- **Ne pas surcharger `appearance.elements` de Clerk.** Les noms d'éléments
  changent d'une version à l'autre, et une clé devenue obsolète n'échoue pas :
  elle est ignorée, et l'écran se dégrade en silence. Passer par
  `appearance.variables` (`src/lib/clerk-appearance.ts`), qui est l'interface
  publique. Et surtout : **le thème `shadcn` de `@clerk/ui` ne convient pas
  ici** — il attend `--background`, `--foreground`, `--border`, `--primary`,
  que ce projet ne définit pas. Résultat observé : champs sans cadre, bouton
  sans fond, et l'étiquette d'un champ affichée deux fois parce que le
  placeholder d'un champ devenu invisible se lisait comme du texte.
- **Monter `ClerkProvider` sans clé publiable fait tomber toute
  l'application.** L'absence de Clerk est un état normal : `AuthProvider` rend
  ses enfants tels quels dans ce cas.
- **Le client navigateur des cookies ignore le jeton Clerk.** Onze composants
  appelaient `createClient()` directement plutôt que `useSupabase()`. Sans
  Clerk, rien ne se voyait ; avec lui, leurs requêtes partaient en anonyme :
  canaux temps réel muets, listes vides, réglages qui ne s'enregistraient pas.
  Aucune erreur nulle part — un `update` bloqué par la RLS ne lève rien, il ne
  touche simplement aucune ligne. La règle était écrite, le garde-fou existait,
  il n'était appelé qu'à un seul endroit.
- **« Redeploy » sur Vercel rejoue le déploiement existant, pas le dernier
  commit.** Quand un webhook GitHub est manqué, le bouton reconstruit
  l'ancienne version sans rien signaler. Vérifier le SHA du déploiement avant
  de conclure qu'un réglage est en cause : on cherche une variable manquante
  pendant une heure alors que c'est le code qui n'est pas là.
