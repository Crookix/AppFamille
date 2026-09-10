# Parcours de bout en bout

Ces sept fichiers rejouent, dans un vrai navigateur, les parcours qui comptent :
monter un foyer et y inviter quelqu'un, tenir le calendrier, les listes, les
repas, les gardes, et vérifier qu'un foyer ne déborde pas sur un autre.

## Les jouer

```bash
npm run dev          # dans un terminal
npm run test:e2e     # dans un autre
```

Il faut, dans `.env.local` :

- `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — **uniquement** pour fabriquer les comptes de
  test et leurs liens de connexion, ce qu'aucune interface ne permet de faire.
  Elle ne sort jamais du processus de test.

Sans ces variables, chaque fichier s'annonce comme ignoré **en disant ce qui
manque**. Aucun parcours ne « passe » à vide.

## Ce qu'ils font des données

Chaque parcours crée ses propres comptes, préfixés `e2e-` et suffixés d'un
horodatage, puis les supprime à la fin — les foyers partent en cascade avec
eux. Ils ne touchent à aucune donnée existante. Utilisez malgré tout un projet
Supabase de développement, pas celui de la famille.

## Les sélecteurs

Les parcours visent les libellés visibles (« Inviter un adulte », « Ajouter »)
plutôt que des classes CSS ou des attributs de test. C'est plus fragile au
renommage, mais cela vérifie au passage que ces libellés existent, sont en
français, et sont accessibles au lecteur d'écran. Quand un renommage casse un
parcours, la question à se poser est d'abord : le nouveau libellé est-il aussi
clair que l'ancien ?
