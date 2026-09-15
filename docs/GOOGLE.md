# Connecter Google Agenda

Tout le code de l'intégration est écrit et testé. Il manque uniquement des
identifiants OAuth, que Google n'accorde qu'au propriétaire du projet : cette
page décrit exactement quoi créer et où le coller.

Tant que ces valeurs ne sont pas renseignées, l'application fonctionne
normalement et l'écran **Plus → Google Agenda** affiche ce qu'il reste à faire.
**Aucune synchronisation n'est simulée** : rien n'est jamais présenté comme
réussi si Google n'a pas répondu.

---

## 1. Créer le projet Google Cloud

1. Ouvrir <https://console.cloud.google.com/> et créer un projet
   (par exemple « MyFamily »).
2. Aller dans **API et services → Bibliothèque**, chercher
   **Google Calendar API**, puis cliquer sur **Activer**.

## 2. Configurer l'écran de consentement

La console a été refondue : ce qui s'appelait « Écran de consentement OAuth »
est maintenant réparti dans **Google Auth Platform**, dont voici la
correspondance.

| Ce qu'il faut régler | Où le trouver |
| --- | --- |
| Nom de l'application, adresse d'assistance, domaines autorisés | **Branding** |
| Type d'utilisateur, utilisateurs tests, publication | **Audience** |
| Portées demandées | **Accès aux données** |
| Identifiants OAuth | **Clients** |

| Champ | Valeur |
| --- | --- |
| Type d'utilisateur | **Externe** |
| Nom de l'application | MyFamily |
| Adresse d'assistance | votre adresse e-mail |
| Domaines autorisés | le domaine de déploiement — ici `mykrew.app` |

Ajouter ces portées, et seulement celles-là :

```
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.calendarlist.readonly
openid
email
profile
```

- `calendar.events` : lire **et** écrire les événements.
- `calendar.calendarlist.readonly` : énumérer les calendriers, sans pouvoir en
  créer ni en modifier les partages.

Tant que l'application reste en mode **Test**, ajoutez chaque adresse Google du
foyer dans **Utilisateurs tests**. C'est suffisant pour un usage familial et
évite la procédure de vérification Google.

## 3. Créer l'identifiant OAuth

**Google Auth Platform → Clients → Créer un client**

- Type : **Application Web**
- Nom : MyFamily
- **URI de redirection autorisés** — la valeur doit correspondre au caractère près :

```
http://localhost:3000/api/google/callback
https://myfamily.mykrew.app/api/google/callback
```

Google affiche ensuite un **ID client** et un **code secret**. Le secret ne se
réaffiche plus après la fermeture de la fenêtre : le copier tout de suite.

Le domaine de la deuxième URI doit être **servi par le projet Vercel** (Settings
› Domains) et être exactement celui de `NEXT_PUBLIC_SITE_URL`. Ces trois valeurs
— URI Google, variable, domaine Vercel — ne tolèrent aucun écart.

Pendant que vous y êtes, **vérifiez le domaine** (*Google Auth Platform →
Vérification du domaine*, ou Search Console). Ce n'est pas nécessaire pour
autoriser un agenda, mais c'est indispensable pour que Google accepte de
prévenir MyFamily quand un calendrier change — voir
[Notifications de Google](#notifications-de-google). Sans cette étape, tout
fonctionne, mais l'agenda ne se met à jour qu'aux passages programmés.

## 4. Renseigner les variables

Dans `.env.local` en développement, et dans les variables d'environnement de
Vercel en production :

```bash
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx

# Chiffrement des jetons stockés en base (AES-256-GCM)
TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Nécessaire pour lire les jetons chiffrés côté serveur
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# Doit correspondre au domaine déclaré dans l'URI de redirection
NEXT_PUBLIC_SITE_URL=https://VOTRE-DOMAINE

# Autorise la synchronisation programmée (voir « Mise à jour automatique »)
CRON_SECRET=$(openssl rand -base64 32)
```

`GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` et `SUPABASE_SERVICE_ROLE_KEY`
ne sont **jamais** préfixées `NEXT_PUBLIC_` : elles restent côté serveur et
n'apparaissent ni dans le navigateur ni dans les journaux.

## 5. Autoriser depuis l'application

**Plus → Google Agenda → Autoriser Google Agenda**, puis cocher les calendriers
à afficher.

---

## Ce que fait la synchronisation

### Quand elle se déclenche

La synchronisation a longtemps été **entièrement manuelle** : tant que personne
n'appuyait sur « Synchroniser », un rendez-vous ajouté depuis Google Agenda
n'existait pas dans MyFamily, et un événement créé dans MyFamily ne remontait
pas chez Google. Ce n'est plus le cas. Quatre déclencheurs coexistent, du plus
rapide au plus lent :

| Déclencheur | Délai | Ce qu'il couvre |
| --- | --- | --- |
| **Notification de Google** | quelques secondes | un calendrier observé a changé ; c'est Google qui appelle MyFamily |
| **Ouverture du calendrier** | immédiat | ce qui date de plus de cinq minutes est rafraîchi à l'ouverture de l'écran |
| **Passage programmé** | 15 minutes | le filet : notification perdue, canal expiré, déploiement en cours |
| **Bouton « Synchroniser »** | immédiat | forcer un passage, et voir le compte rendu |

Leur état réel est affiché sur **Plus → Google Agenda**, ligne par ligne. Un
déclencheur indisponible le dit et explique pourquoi : rien n'est présenté
comme actif s'il ne l'est pas.

#### Notifications de Google

Google appelle `POST /api/google/notifications` dès qu'un calendrier observé
change. Trois conditions, toutes vérifiables sur l'écran Google Agenda :

1. `NEXT_PUBLIC_SITE_URL` est une **adresse publique en HTTPS**. Ni
   `localhost`, ni `http`, ni une adresse IP : Google vérifie que l'adresse
   répond avant d'ouvrir le canal.
2. Le **domaine est vérifié** dans la console Google Cloud
   (*Google Auth Platform → Vérification du domaine*, ou Search Console). Sans
   cette étape, Google refuse l'inscription avec
   `WebHook callback must be HTTPS` ou `unauthorizedWebhookCallbackChannelUrl`,
   même si l'adresse est parfaitement joignable.
3. Le calendrier est **coché** dans MyFamily. Cocher la case demande le canal
   dans la foulée ; la décocher le referme.

Un canal dure quelques jours et Google en fixe lui-même le terme — c'est cette
date-là qui est enregistrée, jamais celle qu'on a demandée. Le passage
programmé les renouvelle 24 heures avant échéance.

Chaque notification est vérifiée avant d'être suivie d'effet : identifiant de
canal, condensat du jeton de vérification (comparé en temps constant) et
identifiant de ressource doivent concorder tous les trois. L'URL est publique,
c'est le jeton qui fait foi — et la base ne contient que son condensat, jamais
le jeton lui-même.

En développement local, rien de tout cela n'est possible : l'écran l'annonce,
et la synchronisation se fait à l'ouverture du calendrier.

#### Passage programmé

Déclaré dans `vercel.json` et appelé par Vercel toutes les quinze minutes :

```json
{ "crons": [{ "path": "/api/google/cron", "schedule": "*/15 * * * *" }] }
```

`CRON_SECRET` est **obligatoire**. Vercel la présente en en-tête
d'autorisation ; sans elle, la route refuse de s'exécuter plutôt que de rester
ouverte à qui connaît son adresse. À déclarer dans les variables
d'environnement du projet Vercel, puis à redéployer.

> Le plan **Hobby** de Vercel limite les crons à **un déclenchement par jour**
> et ignore les planifications plus fines. Sur Hobby, gardez la déclaration
> telle quelle — elle tournera une fois par jour — et comptez sur les
> notifications Google et l'ouverture du calendrier, qui, elles, ne dépendent
> d'aucun plan.

Un passage est borné : vingt calendriers au plus, quarante-cinq secondes au
plus. Les calendriers sont servis **du plus ancien au plus récent**, celui qui
n'a jamais été synchronisé d'abord ; au-delà du budget, les laissés-pour-compte
d'un passage sont les premiers servis au suivant. Un calendrier en erreur
attend une heure avant qu'on réessaie : sans ce recul, un seul compte dont
l'accès a été révoqué consommerait tout le budget à chaque passage.

#### Ouverture du calendrier

L'écran Calendrier demande au serveur de synchroniser ce qui date de plus de
cinq minutes. C'est le serveur qui tranche, pas le navigateur : deux onglets
ouverts ne peuvent donc pas se contredire.

Rien ne s'affiche — ni « en cours », ni « réussi ». Une synchronisation
d'arrière-plan qui annoncerait sa réussite violerait la règle la plus stricte
de l'intégration. Les échecs, eux, restent visibles sur l'écran Google Agenda,
avec leur cause. Et l'écran ne se rafraîchit que si quelque chose a
effectivement changé.

### Deux choses distinctes

Se connecter à MyFamily **avec** Google et **autoriser** l'accès à Google Agenda
sont deux opérations séparées, comme le demande le cahier des charges :

- on peut utiliser MyFamily pendant des mois avec la connexion Google sans avoir
  jamais donné accès à son agenda ;
- retirer l'accès à l'agenda ne fait pas perdre son compte.

Chaque adulte connecte **son propre** agenda. Rien n'est partagé entre les
comptes Google du foyer.

### Par calendrier, trois réglages

| Réglage | Effet |
| --- | --- |
| **Afficher** | les événements de ce calendrier apparaissent dans MyFamily |
| **Ce que le foyer voit** | *Détails complets* ou *Disponibilités seulement* |
| **Calendrier cible** | reçoit les événements créés dans MyFamily (un seul) |

En mode « disponibilités », le titre et la description ne sont pas seulement
masqués : ils **n'entrent pas** dans la base du foyer. Un agenda professionnel
ne se retrouve donc pas recopié dans l'application familiale.

L'écriture n'est proposée que si Google accorde réellement le droit
(`accessRole` valant `owner` ou `writer`). Un calendrier partagé en lecture
reste en lecture, et l'interface le dit.

### Comment les doublons sont évités

Une paire (calendrier Google, identifiant d'événement Google) ne peut
correspondre qu'à **un seul** événement MyFamily — garanti par un index unique en
base, pas par une comparaison approximative de titres.

### Comment les boucles sont cassées

Trois gardes, indépendantes :

1. un événement importé porte `origin = 'google'` et n'est **jamais** réexporté ;
2. un événement MyFamily n'est réexporté que si sa **révision** a changé depuis le
   dernier envoi — révision qu'un déclencheur n'incrémente que sur les champs
   réellement synchronisés ;
3. l'**etag** renvoyé par Google sert d'accusé de réception : s'il n'a pas
   changé, ce qui revient est notre propre écho et rien n'est réécrit.

### Modifications simultanées

Chaque envoi porte l'en-tête `If-Match` avec l'etag connu. Si l'événement a
changé chez Google entre-temps, Google répond **412** et refuse l'écriture :
la version distante n'est jamais écrasée. Le conflit est compté, affiché, et la
version Google est rapatriée à la synchronisation suivante.

### Récurrences

Les séries sont importées telles quelles (`singleEvents=false`), avec leur
RRULE. Une occurrence modifiée arrive comme un événement distinct portant
`recurringEventId` et `originalStartTime` — exactement le modèle de MyFamily
(`recurring_parent_id` + `original_starts_at`), choisi dès la conception. Il
s'agit donc d'une correspondance directe, pas d'une traduction.

Les séries sont traitées avant leurs occurrences : une occurrence dont la série
n'est pas encore importée est laissée pour le passage suivant, plutôt que créée
isolément — ce qui produirait un doublon apparent.

### Fuseaux horaires

Les événements horaires transportent `dateTime` **et** `timeZone`. Les journées
entières utilisent `date`, avec une fin **exclusive** côté Google, convertie à
l'import et à l'export. Un aller-retour ne décale rien : c'est vérifié par les
tests `tests/unit/google-mapping.test.ts`.

### Suppressions

| Situation | Comportement |
| --- | --- |
| Événement **importé** de Google, supprimé chez Google | supprimé dans MyFamily (c'est son miroir) |
| Événement **créé dans MyFamily**, supprimé chez Google | **conservé** ; seule la correspondance est coupée |
| Événement MyFamily supprimé dans l'application | supprimé chez Google au passage suivant |

Une suppression faite dans MyFamily passe par une file d'attente alimentée par un
déclencheur : on peut supprimer hors connexion, la répercussion suivra.

### Reprise après interruption

La synchronisation est incrémentale via `syncToken`. Si Google répond **410
GONE** (jeton périmé), le contrat officiel impose de repartir d'une
synchronisation complète : c'est ce qui est fait, **sans rien effacer**
localement. Les correspondances existantes suffisent à retrouver chaque
événement, donc la reprise ne crée aucun doublon.

Le jeton d'accès est renouvelé automatiquement avant expiration. Si le
renouvellement échoue — accès révoqué depuis le compte Google, par exemple —
l'erreur est enregistrée et **affichée** sur l'écran Google Agenda, avec un
bouton pour réautoriser.

### Pièces jointes

Les documents joints à un événement (billets, ordonnances, réservations)
**restent dans MyFamily**. Ils ne sont jamais transmis à Google, même quand
l'événement est synchronisé, et ne s'ouvrent que par une URL signée délivrée
après vérification de l'appartenance au foyer.

### Déconnexion

Déconnecter Google révoque l'autorisation et efface les jetons. **Les
événements déjà importés restent dans le foyer** : les effacer est une case à
cocher explicite, jamais un effet de bord.

---

## En cas de problème

| Message | Cause | Correction |
| --- | --- | --- |
| `redirect_uri_mismatch` | l'URI ne correspond pas exactement | recopier `NEXT_PUBLIC_SITE_URL` + `/api/google/callback` dans la console Google |
| « La demande d'autorisation n'a pas pu être vérifiée » | l'autorisation a été lancée depuis un autre domaine que `NEXT_PUBLIC_SITE_URL` — le cookie anti-CSRF est posé sur le domaine de départ, Google renvoie sur celui de la variable | relancer depuis le domaine canonique |
| « L'accès à l'agenda n'a pas été accordé » | portée décochée dans la fenêtre de consentement | relancer et cocher Google Agenda |
| « L'autorisation a été révoquée ou a expiré » | accès retiré depuis le compte Google | réautoriser depuis l'écran Google Agenda |
| « TOKEN_ENCRYPTION_KEY absente ou invalide » | clé manquante ou pas 32 octets | `openssl rand -base64 32` |
| `Access blocked: app not verified` | application en mode Test | ajouter l'adresse dans **Utilisateurs tests** |
| « Notifications Google : … WebHook callback must be HTTPS » | le domaine de `NEXT_PUBLIC_SITE_URL` n'est pas vérifié dans Google Cloud | vérifier le domaine, puis attendre le prochain passage programmé |
| « Notifications indisponibles ici » sur l'écran Google Agenda | `NEXT_PUBLIC_SITE_URL` est en `http`, pointe sur `localhost` ou sur une adresse IP | normal en développement ; en production, corriger la variable |
| « Passage régulier — désactivé » | `CRON_SECRET` absente des variables Vercel | la renseigner, puis redéployer |
| L'agenda ne se met à jour qu'au clic | migration `0019` non appliquée, ou aucun calendrier coché | `npm run db:push`, puis cocher un calendrier |
