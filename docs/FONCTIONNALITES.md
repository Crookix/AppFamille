# MyFamily — fonctionnalités et critères d'acceptation

Ce document dit, pour chaque partie du produit, **ce qu'elle fait** et **à quoi
on reconnaît qu'elle marche**. Les critères sont écrits pour être vérifiables :
chacun se lit comme une manipulation qu'on peut faire dans l'application et dont
on peut constater le résultat.

L'état de chaque lot est donné en tête de section :

- **Fait** — implémenté, et vérifié comme indiqué dans [`TESTS.md`](TESTS.md)
- **Fait, non vérifié en navigateur** — le code est complet, mais le parcours
  n'a pas pu être joué dans un vrai navigateur depuis l'environnement de
  développement (voir « Ce qui n'a pas pu être vérifié ici » dans `TESTS.md`)
- **Bloqué** — demande une action externe, décrite au même endroit

---

## Se déplacer dans l'application — *fait ; géométrie vérifiée en navigateur*

### Ce que ça fait

- La barre du bas porte **cinq destinations**, et rien d'autre : **Accueil**,
  **Calendrier**, **Listes**, **Repas**, **Reco**. Ce sont les cinq endroits où
  l'on va faire quelque chose, plusieurs fois par jour.
- **« Plus » n'est pas une destination** : c'est le tiroir des réglages —
  enfants, nounous, notifications, Google, foyer, paramètres. Sur téléphone il
  se rejoint depuis n'importe quel écran par la **pastille d'identité** en haut
  à droite. Sur grand écran, la colonne latérale le garde en clair : 256 px
  n'ont aucune rareté à arbitrer.
- L'entête de téléphone porte aussi le **nom du foyer**, visible partout et non
  plus seulement sur « Plus » — qui appartient à deux foyers voit lequel il
  regarde.
- Une **puce** sur la pastille signale des notifications non lues.
- Les **check-lists** sont le troisième onglet de « Listes », à côté de
  « Tâches » et « Courses ». Les trois tiennent côte à côte à 375 px, sans
  défilement : un onglet qu'il faut faire défiler pour découvrir n'existe pas
  pour qui ignore qu'il est là.

**Le principe.** La barre appartient aux destinations. Tant que « Plus » y
occupait une place sur cinq, toute fonctionnalité nouvelle tombait dans le
tiroir — c'est ce qui était arrivé à la reco.

### Critères d'acceptation

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 0.1 | Afficher n'importe quel écran à 375 px | Cinq onglets lisibles, aucun libellé coupé, aucun défilement horizontal |
| 0.2 | Afficher « Listes » à 375 px | Les trois onglets visibles d'un coup, « Check-lists » compris |
| 0.3 | Appuyer sur la pastille depuis le calendrier | On arrive sur « Plus » |
| 0.4 | Avoir une notification non lue | Une puce sur la pastille ; elle s'éteint une fois la notification lue |
| 0.5 | Afficher l'application sur ordinateur | La colonne latérale porte les cinq destinations **et** « Plus » ; l'entête de téléphone disparaît |
| 0.6 | Chercher la reco | Elle est dans la barre, pas dans « Plus » |

**Ce qui a été vérifié, et comment.** Les critères 0.1, 0.2, 0.5 et 0.6 ont été
constatés dans un vrai navigateur, à 375 px, 360 px et 1024 px, en clair et en
sombre — mais sur une page d'aperçu montée pour l'occasion, sans base de
données, parce que la pile Supabase locale demande Docker et que celui-ci
n'était pas disponible. La géométrie est donc prouvée ; les déplacements, non.
Les critères 0.3 et 0.4 sont couverts par `tests/e2e/10-navigation.spec.ts`,
**qui n'a jamais été exécuté** : voir [`TESTS.md`](TESTS.md).

---

## 1. Comptes, foyer et invitations — *fait*

Un adulte crée un foyer, y invite l'autre parent, et déclare les enfants.

### Ce que ça fait

- Connexion par **lien magique** envoyé par e-mail (aucun mot de passe à
  retenir, donc aucun mot de passe à perdre) ou avec un **compte Google**.
- Création d'un foyer : un nom, un fuseau horaire, et l'auteur devient
  administrateur.
- Invitation d'un adulte par un lien à usage unique, valable sept jours,
  révocable à tout moment.
- Un adulte peut appartenir à plusieurs foyers (famille recomposée, second
  logement) et bascule de l'un à l'autre.
- Fiches enfants : prénom, date de naissance, couleur, allergies, notes,
  activités récurrentes. Un enfant se range dans les archives plutôt que de
  disparaître.
- Deux rôles : **administrateur** (gère les membres et le foyer) et **adulte**
  (fait tout le reste).

### Critères d'acceptation

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 1.1 | Saisir son adresse, ouvrir le lien reçu, créer un foyer | On arrive sur l'accueil, administrateur de son foyer |
| 1.2 | Générer un lien d'invitation | Le lien s'affiche une seule fois, avec sa date d'expiration ; la base ne stocke que son condensat |
| 1.3 | Ouvrir le lien avec un autre compte | Un aperçu montre le nom du foyer et l'auteur de l'invitation — **et rien d'autre** du foyer |
| 1.4 | Accepter | Le second adulte voit immédiatement les données du foyer |
| 1.5 | Rouvrir le même lien | « Cette invitation a déjà été utilisée » |
| 1.6 | Ouvrir un lien vieux de plus de sept jours | « Cette invitation a expiré » |
| 1.7 | Ouvrir un lien révoqué | « Cette invitation a été annulée » |
| 1.8 | Inventer un jeton au hasard | « Lien d'invitation invalide », sans indiquer si un foyer existe |
| 1.9 | Un adulte non-administrateur tente de se promouvoir | Refusé : « Seul un administrateur du foyer peut changer un rôle » |
| 1.10 | Le dernier administrateur tente de se retirer ce rôle | Refusé — un foyer garde toujours au moins un administrateur |
| 1.11 | Archiver un enfant | Il disparaît des listes courantes, ses données restent, il peut être restauré |

---

## 2. Calendrier, déplacements et pièces jointes — *fait*

Le calendrier partagé du foyer, avec ce qui manque habituellement : qui
récupère l'enfant, et le billet de train en pièce jointe.

### Ce que ça fait

- Vues **jour**, **semaine**, **mois** et **liste**, navigables au doigt.
- Un événement porte un titre, une description, un lieu, une catégorie de
  couleur, des participants (adultes et enfants), et des rappels.
- Trois natures d'événement : **standard**, **déplacement** (avec départ,
  arrivée, moyen de transport, numéro de réservation) et **garde**.
- Récurrences complètes (RRULE) : quotidienne, hebdomadaire sur jours choisis,
  mensuelle, annuelle, avec fin par date ou par nombre d'occurrences.
- Modification d'une seule occurrence ou de toute la série ; une occurrence
  supprimée peut être rétablie.
- Responsable, dépose et récupération : trois personnes distinctes si besoin.
- Pièces jointes (billets, ordonnances, autorisations) stockées dans un espace
  privé, accessibles par un lien signé de courte durée.

### Critères d'acceptation

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 2.1 | Créer un événement à 9 h aujourd'hui | Il apparaît au bon endroit dans les quatre vues |
| 2.2 | Créer « tous les mardis à 17 h » | Les occurrences tombent tous les mardis, y compris après le changement d'heure |
| 2.3 | Déplacer une seule occurrence | Les autres ne bougent pas |
| 2.4 | Supprimer une occurrence puis la rétablir | Elle réapparaît à sa place d'origine |
| 2.5 | Fixer une fin « après 5 occurrences » | Il y en a exactement cinq |
| 2.6 | Créer un déplacement | Le formulaire refuse une arrivée antérieure au départ |
| 2.7 | Joindre un fichier | Il s'ouvre depuis l'événement, par une adresse qui expire |
| 2.8 | Copier cette adresse et la rouvrir plus tard | Elle ne fonctionne plus |
| 2.9 | Deux adultes ouvrent le calendrier, l'un crée un événement ou change les participants | L'autre le voit apparaître sans recharger |

---

## 3. Tâches et courses — *fait*

### Ce que ça fait

- Tâches avec échéance, priorité, personne responsable, enfant concerné,
  récurrence, et notes.
- Une tâche récurrente cochée réapparaît à sa prochaine échéance ; l'historique
  des réalisations est conservé.
- Plusieurs listes de courses (« Courses », « Bricolage », « Pharmacie »).
- Saisie rapide : « 2 kg de pommes » se range tout seul au rayon fruits et
  légumes, avec sa quantité et son unité.
- Les articles fréquents sont proposés en un geste.
- Cases cochées regroupées en bas, effaçables d'un coup.

### Critères d'acceptation

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 3.1 | Créer une tâche pour demain | Elle apparaît sur l'accueil dans « à venir » |
| 3.2 | Cocher une tâche hebdomadaire | Elle se recrée sept jours plus tard, et la réalisation est enregistrée |
| 3.3 | Taper « 2 kg de pommes » | Quantité 2, unité kg, libellé « pommes », rayon « Fruits et légumes » |
| 3.4 | Ajouter « pommes » alors que « 2 kg de pommes » y est déjà | Les deux lignes fusionnent au lieu de se doubler |

**3.3 et 3.4 sont tenus depuis le 15 septembre 2026.** Ils ne l'étaient pas :
la saisie rapide enregistrait « 2 kg de pommes » comme un libellé entier, et
chaque ajout créait une ligne de plus. L'arbitrage a été de compléter le
produit plutôt que de réécrire les critères à la baisse.

Ce que fait l'analyse, et surtout ce qu'elle refuse de faire :

- Seul un nombre **en tête** compte. « Coca 33cl » reste un libellé entier : le
  nombre y désigne le produit. Analyser aussi la fin transformerait un nom de
  produit en mesure, ce qui est pire que de ne rien analyser.
- Le mot qui suit le nombre n'est une unité que s'il est **reconnu**. « 3
  citrons » donne trois citrons, pas trois « citrons » de quelque chose.
- Si le libellé se viderait, on n'analyse rien : « 1664 » est une bière.
- Les trois champs restent, et **l'emportent** quand ils sont remplis : une
  devinette faite sur une phrase ne contredit jamais une saisie explicite.

La fusion ne touche que les lignes **saisies à la main** et **non cochées**.
Une ligne venue des repas porte son repas d'origine : la régénération du menu
la supprime, et emporterait avec elle ce qu'on y aurait ajouté. Deux lignes
valent mieux qu'une ligne qui disparaît toute seule. Et deux unités
inconciliables (« 1 kg » et « 1 L ») restent deux lignes, plutôt qu'une
addition fausse.

Limite connue et assumée : « 2 en 1 » devient une quantité 2 et un libellé
« en 1 ». Aucune règle générale ne distingue ce cas de « 2 citrons » ; il est
rare, et la correction se fait en deux frappes.
| 3.5 | Cocher trois articles puis « effacer les articles cochés » | Seuls ces trois disparaissent |
| 3.6 | Deux adultes sur la même liste, l'un coche | L'autre voit la case se cocher |

---

## 4. Repas et génération des courses — *fait*

### Ce que ça fait

- Planning de la semaine, deux services par jour (midi et soir).
- Un repas est soit un texte libre, soit une recette du foyer.
- Recettes : ingrédients avec quantités, portions, temps, notes, favoris.
- Glisser un repas d'un jour à l'autre ; copier toute une semaine.
- **Génération des courses** : à partir des repas d'une période, la liste des
  ingrédients manquants, agrégés par produit et convertis quand c'est possible
  (500 g + 0,5 kg = 1 kg), rangés par rayon. Un aperçu précède l'ajout.

### Critères d'acceptation

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 4.1 | Planifier une recette mardi soir | Elle s'affiche à cette case |
| 4.2 | Glisser ce repas au mercredi | Il change de jour, mardi se vide |
| 4.3 | Copier la semaine vers la suivante | Les sept jours sont repris |
| 4.4 | Générer les courses sur deux recettes partageant un ingrédient | L'aperçu montre une seule ligne, quantités additionnées |
| 4.5 | Deux recettes utilisant « 500 g » et « 0,5 kg » de farine | Une ligne : 1 kg |
| 4.6 | Une recette avec « 2 cuillères à soupe » et une autre avec « 30 g » du même produit | Deux lignes — on ne convertit pas ce qui n'est pas convertible |
| 4.7 | Une recette avec « Œufs », une autre avec « oeufs » | Une seule ligne |
| 4.8 | Confirmer l'aperçu | Les articles arrivent dans la liste, marqués comme venant des repas |
| 4.9 | Deux adultes sur le planning, l'un ajoute un repas | L'autre le voit apparaître sans recharger |

---

## 5. Nounous, heures et bilans — *fait*

### Ce que ça fait

- Fiches nounou : nom, couleur, contact, notes, archivage.
- Tarifs horaires **datés** : un tarif change à une date donnée, sans réécrire
  le passé.
- Séances de garde : prévues (avec horaires théoriques), puis réalisées (heures
  effectives), puis confirmées.
- Ajustements manuels (retard, majoration) et frais annexes (transport, repas).
- **Bilan mensuel** : heures et montant par nounou, imprimable et exportable en
  CSV lisible par un tableur français.
- Un règlement se marque comme réglé, avec sa date.

### Critères d'acceptation

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 5.1 | Créer une séance 17 h – 19 h | 2 h prévues |
| 5.2 | Saisir 17 h 05 – 19 h 20 | 2 h 15 réalisées ; le prévu reste visible |
| 5.3 | Ajouter un ajustement de +15 min | Le total passe à 2 h 30 |
| 5.4 | Passer le tarif de 12 € à 13 € au 1er du mois | Les séances antérieures restent à 12 € |
| 5.5 | Consulter le bilan du mois | Seules les séances **confirmées** entrent dans le montant dû |
| 5.6 | Exporter en CSV | Point-virgule, décimales à la virgule, accents corrects |
| 5.7 | Imprimer le bilan | Une page propre, sans navigation ni boutons |
| 5.8 | Marquer le mois comme réglé | Le bilan indique « réglé le … » |

---

## 6. Google — connexion et agenda — *deux fonctionnalités distinctes*

Le cahier des charges le demandait explicitement, et le code le respecte : **se
connecter avec Google** et **autoriser l'accès à Google Agenda** sont deux
choses séparées.

### 6a. Connexion avec Google — *fait, non vérifié en navigateur*

Bouton « Continuer avec Google » sur l'écran de connexion, adossé au
fournisseur OAuth de Supabase. N'ouvre **aucun** accès à l'agenda.

### 6b. Autorisation Google Agenda — *fait, non vérifié avec le service réel*

Réglage séparé, dans « Plus › Google Agenda ».

**Ce que ça fait**

- Autorisation demandant deux portées seulement : lire et écrire les événements,
  et lister les agendas auxquels on est abonné.
- Jetons chiffrés en AES-256-GCM avant d'entrer en base, dans une table sans
  aucune politique RLS : le navigateur ne peut littéralement pas les lire.
- Choix explicite des agendas à synchroniser ; aucun n'est activé d'office.
- Synchronisation **incrémentale** par `syncToken`, avec reprise complète
  automatique si Google déclare le jeton périmé (410).
- Synchronisation **bidirectionnelle** : ce qui vient de Google descend, ce qui
  est créé dans MyFamily remonte — mais seulement vers les agendas où l'on a le
  droit d'écrire.
- Trois garde-fous contre les boucles d'écho, documentés en tête de
  `src/lib/google/sync.ts`.
- Conflits détectés par `etag` : en cas de modification simultanée, Google
  refuse l'écriture (412) et l'application le signale au lieu d'écraser.
- Événements « occupé » sans détails pour les agendas qu'on ne veut que voir.
- Déconnexion en deux temps : **révoquer l'accès** (les données familiales
  restent) ou **révoquer et supprimer les événements importés** (action
  explicite, écran de confirmation).

**Critères d'acceptation**

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 6.1 | Se connecter avec Google sans autoriser l'agenda | On est connecté ; « Google Agenda » indique « non autorisé » |
| 6.2 | Autoriser l'agenda | La liste des agendas s'affiche, **aucun** n'est coché |
| 6.3 | Cocher un agenda et synchroniser | Les événements arrivent, marqués comme venant de Google |
| 6.4 | Créer un événement dans MyFamily sur un agenda inscriptible | Il apparaît dans Google Agenda |
| 6.5 | Modifier ce même événement dans Google | La modification redescend, sans créer de doublon |
| 6.6 | Modifier des deux côtés en même temps | L'application signale le conflit ; rien n'est écrasé en silence |
| 6.7 | Synchroniser deux fois de suite sans rien changer | Rien ne bouge, aucun doublon |
| 6.8 | Retirer les variables Google de la configuration | L'écran dit « non configuré » et explique quoi faire — **il n'affiche jamais une synchronisation réussie** |
| 6.9 | Révoquer l'accès Google | Les événements importés restent ; rien n'est supprimé sans demande explicite |
| 6.10 | Révoquer **et** supprimer les événements importés | Seuls ceux venant de Google disparaissent ; ceux créés dans MyFamily restent |

Le détail (mise en place, portées, comportement en cas d'erreur) est dans
[`GOOGLE.md`](GOOGLE.md).

---

## 7. Notifications, application mobile et finitions — *fait*

### Ce que ça fait

- Mise à jour en direct des écrans partagés : calendrier, tâches, courses,
  repas et notifications s'actualisent chez l'un quand l'autre modifie quelque
  chose, sans rechargement.
- Notifications dans l'application : invitation acceptée, tâche qui vous est
  attribuée, événement à venir, séance de garde à confirmer.
- Préférences par type de notification, par personne.
- **PWA installable** : manifeste, icônes, service worker, écran hors connexion.
- Thème clair, sombre, ou automatique.
- Mode démonstration : charge un foyer d'exemple complet pour faire le tour du
  produit, et le supprime d'un bouton.
- Accessibilité : navigation au clavier, lien d'évitement, contrastes, zoom
  autorisé, cibles tactiles d'au moins 44 px.

### Critères d'acceptation

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 7.1 | Un adulte accepte une invitation | L'auteur de l'invitation reçoit une notification |
| 7.2 | Désactiver un type de notification | Ce type cesse d'arriver, les autres continuent |
| 7.3 | Ouvrir l'application sur un téléphone | « Ajouter à l'écran d'accueil » est proposé ; l'icône et le nom sont ceux de MyFamily |
| 7.4 | Couper le réseau et rouvrir | Un écran hors connexion s'affiche, pas une erreur du navigateur |
| 7.5 | Basculer en thème sombre | Tout l'écran suit, et le choix survit au rechargement |
| 7.6 | Charger le foyer de démonstration | Calendrier, tâches, courses, repas et gardes sont remplis |
| 7.7 | Parcourir un écran au clavier seul | Le focus reste visible et l'ordre est logique |
| 7.8 | Réduire la fenêtre à 375 px | Rien ne déborde, rien ne se chevauche |

---

## 8. Reco — films, séries, théâtre, idées cadeaux — *fait, vérifié en navigateur*

### Ce que ça fait

- Un espace partagé pour ce que la famille se recommande : **films, séries,
  théâtre, idées cadeaux**, et un genre « autre » pour le reste (un livre, un
  restaurant, un podcast).
- Chaque fiche porte un titre, qui la recommande, **pourquoi**, un lien, et une
  note sur cinq étoiles. C'est le « pourquoi » qui distingue une recommandation
  d'une simple liste de titres.
- Les mots suivent le genre : un film se marque « Vu », un cadeau « Offert »,
  une place de théâtre passe par « Places prises ». La base, elle, n'a que
  trois états.
- **Les envies** : chaque membre peut dire « moi aussi ». Les avatars montrent
  d'un coup d'œil si l'on est seul à vouloir, ou si toute la maison attend.
  Personne ne peut déclarer une envie à la place d'un autre.
- Les idées cadeaux ajoutent leurs propres champs : destinataire (un enfant du
  foyer ou quelqu'un d'autre), occasion et prix.
- Un lien collé sans « https:// » est complété tout seul ; seul le domaine
  s'affiche, pour ne pas déborder sur téléphone.
- Ce qui est fait sort de la liste sans disparaître : un bouton le ramène.

### Critères d'acceptation

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 9.1 | Ajouter un film | Il apparaît « À voir », signé du prénom de qui l'a proposé |
| 9.2 | Ajouter une idée cadeau | Les champs destinataire, occasion et prix apparaissent ; ils restent absents pour un film |
| 9.3 | Marquer un film « Vu », puis un cadeau « Offert » | Le libellé suit le genre ; le bouton « Annuler » revient en arrière |
| 9.4 | Appuyer sur « Envie » depuis deux téléphones | Le compteur monte à deux, les deux avatars s'affichent |
| 9.5 | Appuyer deux fois de suite sur « Envie » | Une seule envie enregistrée, sans erreur |
| 9.6 | Changer le genre d'une fiche de « cadeau » à « film » | Destinataire, occasion et prix sont effacés, pas seulement masqués |
| 9.7 | Coller « allocine.fr/film/12 » | Le lien s'ouvre vers l'extérieur ; la fiche n'affiche que « allocine.fr » |
| 9.8 | Saisir un prix « 25,50 € » | Enregistré comme 25,50, réaffiché « 25,50 € » |
| 8.9 | Chercher « oeuvre » | Trouve « Une Œuvre majeure » |
| 8.10 | Un adulte ajoute une reco | L'autre la voit apparaître sans recharger |

---

## 9. Check-lists — les listes qu'on refait à l'identique — *fait*

### Ce que ça fait

- Des listes **réutilisables** : la valise des enfants, le sac de piscine, ce
  qu'on emporte chez la nounou. On coche, puis on **remet à zéro** pour la fois
  suivante — le contenu reste, seules les coches partent.
- À la création, le contenu s'écrit **ou se colle** : tirets, puces, numéros et
  cases `[ ]` sont retirés, et les doublons écartés. On ne saisit pas une valise
  ligne à ligne, on la reprend d'ailleurs.
- L'avancement se lit sans ouvrir la liste (« 3 sur 6 », et une jauge), et une
  liste entièrement cochée s'annonce **prête**.
- La date de la dernière remise à zéro est affichée, avec qui l'a faite : sans
  elle, on ne sait pas si les coches encore en place datent de ce matin ou du
  voyage précédent.
- Deux adultes qui préparent la même valise voient les coches de l'autre en
  temps réel.

**Ce que ce n'est pas.** Ni échéance, ni responsable, ni récurrence : ce sont
les marques d'une tâche. Une tâche est un engagement ponctuel qui disparaît une
fois faite ; une check-list est un modèle qui survit à son usage. Mélanger les
deux rendrait les deux écrans illisibles.

### Critères d'acceptation

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 9.1 | Créer une check-list en collant « - Doudou / - Pyjama / 1. Brosse à dents » | Trois points, sans les tirets ni le numéro |
| 9.2 | Coller deux fois la même ligne | Un seul point — la valise ne double pas |
| 9.3 | Cocher deux points sur six | L'en-tête affiche « 2 sur 6 », la jauge suit |
| 9.4 | Tout cocher | La liste s'annonce « Prête » |
| 9.5 | Remettre à zéro | Tout est décoché, **le contenu est intact**, et la date du jour s'affiche |
| 9.6 | Une liste que personne n'a cochée | Le bouton « Remettre à zéro » ne se propose pas |
| 9.7 | Deux adultes sur la même liste, l'un coche | L'autre voit la case se cocher |
| 9.8 | Une liste vide | Elle n'est pas annoncée « prête » — une valise sans contenu n'est pas une valise prête |

---

## 10. Étanchéité entre foyers — *fait, vérifié sur la base réelle*

Ce n'est pas une fonctionnalité visible, mais c'est le critère le plus
important du produit : **les données d'un foyer ne sortent pas de ce foyer.**

| # | On fait ceci | On doit obtenir cela |
| --- | --- | --- |
| 8.1 | Un membre du foyer B lit les événements, enfants, tâches, nounous, tarifs, pièces jointes, membres et invitations du foyer A | Zéro ligne, à chaque fois |
| 8.2 | Il tente de modifier ou supprimer l'une de ces lignes | Aucune ligne touchée |
| 8.3 | Il tente d'insérer une ligne portant l'identifiant du foyer A | Refusé par la base |
| 8.4 | Il tente de s'ajouter comme membre du foyer A | Refusé par la base |
| 8.5 | Il tente de lire ou de déposer un fichier dans l'espace de stockage du foyer A | Refusé |
| 8.6 | Il lit la table des jetons Google | Zéro ligne, quelle que soit la requête |
| 8.7 | Un adulte non-administrateur tente de se promouvoir, de modifier la fiche d'un autre membre, ou d'exclure l'administrateur | Refusé les trois fois |
| 8.8 | **Témoins** : les mêmes requêtes, faites par un membre légitime | Elles renvoient bien les données |

Le point 10.8 n'est pas décoratif : sans lui, une session inerte renverrait zéro
partout et l'on conclurait à tort à l'étanchéité.

Ces huit points sont exécutés par `supabase/tests/isolation.sql`, qui couvre
aussi les recommandations et leurs envies depuis la section 8. Le script porte
**67 vérifications**, l'espace nounou et les check-lists compris. Voir [`TESTS.md`](TESTS.md) pour
le détail de ce qui a été joué contre la base réelle et de ce qui l'a été
contre un Postgres local.

---

## Ce que MyFamily ne fait pas

Dit ici pour qu'on ne le cherche pas :

- Pas de notifications poussées sur le téléphone quand l'application est fermée
  (les notifications vivent dans l'application).
- Pas d'application native iOS ou Android : c'est une PWA installable.
- Pas de synchronisation avec Apple Calendrier ni Outlook.
- Pas de partage de calendrier hors du foyer.
- Pas de gestion de budget familial au-delà des règlements de garde.
