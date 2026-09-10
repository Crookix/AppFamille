# Tribu

L'organisation du foyer au même endroit : le calendrier de la famille, les
tâches, les courses, les repas et les heures de garde. Sur téléphone comme sur
ordinateur, à deux adultes ou plus, dans un foyer qui ne voit que ses propres
données.

---

## Démarrer

```bash
npm install
cp .env.example .env.local     # puis renseigner les valeurs
npm run db:push                # crée le schéma sur votre projet Supabase
npm run dev
```

`http://localhost:3000`

Sans variables Supabase, l'application démarre quand même et affiche un écran
d'explication. Sans variables Google, tout fonctionne sauf la synchronisation
d'agenda, qui s'annonce comme non configurée — et jamais comme réussie.

Il reste **deux valeurs à renseigner** avant de pouvoir tout utiliser ; elles
sont listées dans [`docs/AVANCEMENT.md`](docs/AVANCEMENT.md).

---

## Ce qu'il y a dedans

- **Calendrier** — vues jour, semaine, mois et liste ; récurrences complètes ;
  déplacements avec départ, arrivée et numéro de réservation ; qui dépose et
  qui récupère ; pièces jointes privées.
- **Tâches** — échéances, priorités, récurrences, attribution.
- **Courses** — plusieurs listes, saisie qui devine la quantité et le rayon,
  fusion des doublons.
- **Repas** — planning de la semaine, recettes, et génération de la liste de
  courses à partir des repas planifiés.
- **Gardes** — nounous, tarifs datés, heures prévues et réalisées, bilan
  mensuel imprimable et exportable.
- **Google Agenda** — synchronisation bidirectionnelle, incrémentale, avec
  détection de conflit. Distincte de la connexion avec Google.
- **PWA** — installable sur téléphone, avec un écran hors connexion.

Tout est en français, y compris les messages d'erreur.

---

## Sécurité

Les données d'un foyer ne sortent pas de ce foyer. Ce n'est pas une intention,
c'est vérifié : `supabase/tests/isolation.sql` tente, depuis un compte
extérieur, de lire, modifier, supprimer et insérer dans un autre foyer, de
télécharger ses pièces jointes, de s'y ajouter comme membre, de lire les jetons
Google, et d'accepter des invitations expirées ou déjà utilisées. Dernière exécution : **34 vérifications, 34 conformes**, avec deux
fournisseurs d'authentification en présence.

Aucun secret n'atteint le navigateur : la clé `service_role`, la clé de
chiffrement et les jetons Google vivent dans des modules marqués `server-only`,
ce qui fait échouer la compilation si un composant client les importe.

---

## Documentation

| Fichier | Ce qu'on y trouve |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Conventions, commandes, architecture, règles à ne pas contourner |
| [`docs/FONCTIONNALITES.md`](docs/FONCTIONNALITES.md) | Fonctionnalités et critères d'acceptation vérifiables |
| [`docs/TESTS.md`](docs/TESTS.md) | Ce qui a été vérifié, réellement ou en simulation — et ce qui ne l'a pas été |
| [`docs/AVANCEMENT.md`](docs/AVANCEMENT.md) | État d'avancement, points bloquants, décisions prises |
| [`docs/GOOGLE.md`](docs/GOOGLE.md) | Mise en place et comportement de l'intégration Google Agenda |

---

## Commandes

| Commande | |
| --- | --- |
| `npm run dev` | Développement |
| `npm run build` | Compilation de production |
| `npm run typecheck` | Vérification des types |
| `npm test` | Tests unitaires |
| `npm run test:e2e` | Parcours en navigateur |
| `npm run db:push` | Applique les migrations SQL |

---

## Hébergement

En ligne sur Vercel : **<https://tribu-umber.vercel.app>**, redéployé à chaque
push. Tant que les variables d'environnement ne sont pas renseignées dans les
réglages du projet Vercel, l'application affiche « Installation à terminer » et
la marche à suivre — c'est voulu, pas une panne.

La liste exacte des variables, et l'URI de redirection à déclarer côté Google
et côté Supabase, sont dans [`docs/AVANCEMENT.md`](docs/AVANCEMENT.md).
