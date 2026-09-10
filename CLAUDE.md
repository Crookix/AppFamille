# Tribu — repères pour travailler sur ce dépôt

Tribu est une application de gestion du foyer : le calendrier familial, les
tâches, les courses, les repas et les heures de garde au même endroit, sur
téléphone comme sur ordinateur.

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
| `npm run lint` | ESLint via Next |
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
    (app)/            écrans connectés (accueil, calendrier, listes, repas, plus)
    api/google/       connexion, retour d'autorisation, synchronisation, révocation
    auth/callback/    retour d'authentification Supabase
    bienvenue/        création ou choix du foyer
    connexion/        e-mail + mot de passe, lien magique, Google
    invitation/[token]/  aperçu et acceptation d'une invitation
  components/         composants d'interface, groupés par domaine
  lib/
    actions/          Server Actions — tout ce qui écrit passe par là
    data/             lectures composées, appelées par les Server Components
    google/           OAuth, client API, correspondance et synchronisation
    supabase/         quatre clients : navigateur, serveur, middleware, admin
    auth.ts           utilisateur connecté, foyer actif
    recurrence.ts     RRULE, expansion des occurrences
    childcare.ts      heures de garde et bilans mensuels
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

`admin.ts` est réservé à trois usages : la synchronisation Google (qui agit pour
le compte d'un utilisateur absent), le chargement du foyer de démonstration, et
l'écriture des jetons Google. **Toute nouvelle utilisation doit être justifiée
par un commentaire et précédée d'un contrôle d'appartenance explicite.**

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
