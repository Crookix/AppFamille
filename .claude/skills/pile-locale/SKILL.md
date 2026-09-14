---
name: pile-locale
description: Monter une pile Supabase locale pour MyFamily et y jouer les parcours navigateur, sans toucher au projet réel. À utiliser quand il faut vérifier un écran pour de vrai, exécuter Playwright, ou rejouer les migrations depuis une base vide.
---

# Pile locale MyFamily

Ce dépôt se vérifie mal sur la seule lecture : les deux défauts les plus graves
trouvés jusqu'ici — l'application qui plante sans Clerk, trois colonnes
oubliées à l'effacement — ne se voyaient qu'en exécutant. Cette procédure monte
de quoi exécuter, sans écrire une ligne dans le projet Supabase réel.

## Quand s'en servir

- vérifier un écran dans un vrai navigateur ;
- jouer `npm run test:e2e` ;
- s'assurer qu'une migration s'applique depuis une base vide.

**Ne jamais pointer `.env.local` sur le projet Supabase de production pour
essayer quelque chose.** C'est une base avec de vraies données de famille.

## Monter la pile

```bash
npx supabase start
```

Cela donne Postgres, GoTrue, PostgREST, Realtime, Storage et Kong, et applique
les migrations du dépôt.

**Écueil connu** : `supabase start` échoue sur `0010`, parce que
`_tribu_migrations` est créée par `scripts/db-push.mjs` et non par une
migration. Deux sorties :

- la plus simple — laisser `supabase start` échouer, puis
  `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:push`,
  qui crée le journal lui-même et applique tout dans l'ordre du dépôt ;
- ou créer la table à la main avant de relancer.

Pour une vérification de schéma sans Docker, `supabase/tests/echafaudage.sql`
sur un PostgreSQL nu suffit, puis `npm run db:push`.

## `.env.local`

`npx supabase start` imprime les clés à la fin. Elles sont **les mêmes sur
toute installation locale** : ce ne sont pas des secrets.

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY imprimée>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY imprimée>
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
E2E_BASE_URL=http://127.0.0.1:3000
```

`SUPABASE_SERVICE_ROLE_KEY` n'est là que pour les tests : ils s'en servent pour
fabriquer des comptes et des liens de connexion, ce qu'aucune interface ne
permet. Vérifier que le fichier est bien ignoré : `git check-ignore .env.local`.

## Jouer les parcours

```bash
npm run test:e2e
```

Playwright démarre l'application lui-même. Les tests créent leurs comptes,
préfixés `e2e-`, et les suppriment à la fin.

**Écueil connu** : si l'environnement fournit un Chromium plus ancien que celui
qu'attend la version de Playwright du dépôt, ne pas le télécharger — passer
`launchOptions.executablePath` dans une configuration de surcouche qui importe
`playwright.config.ts` et n'en change que ce point.

## Ce que la pile locale ne remplace pas

- les **conseillers Supabase**, qui ne tournent que sur le projet réel ;
- la vérification que les migrations sont bien appliquées **là-bas** : le
  journal qui fait foi est `public._tribu_migrations`, pas celui du CLI.
