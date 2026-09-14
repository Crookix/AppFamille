/**
 * Vocabulaire et tri des recommandations du foyer.
 *
 * La base ne connaît que trois états (`idee`, `en_cours`, `fait`) pour les
 * cinq genres. C'est ici que chaque genre retrouve ses mots : on ne dit pas
 * « fait » d'un film, on dit « vu » ; une idée cadeau n'est pas « en cours »,
 * elle est « réservée ». Un enum par genre aurait multiplié les colonnes et
 * les filtres pour un gain nul côté données.
 *
 * Tout ce fichier est pur : aucune dépendance à Supabase, à React ou à la
 * requête en cours. C'est ce qui le rend testable directement.
 */

import type { RecoKind, RecoStatus, RecommendationRow } from '@/lib/database.types';
import { expandLigatures } from '@/lib/ingredients';
import { formatEuros } from '@/lib/utils';

export type RecoKindMeta = {
  key: RecoKind;
  /** Au singulier, tel qu'affiché sur une fiche. */
  label: string;
  /** Au pluriel, pour les onglets et les titres de section. */
  plural: string;
  /** Ce que l'on demande dans le second champ du formulaire. */
  authorLabel: string;
  authorPlaceholder: string;
  titlePlaceholder: string;
  /** Libellés des trois états, adaptés au genre. */
  statuses: Record<RecoStatus, string>;
};

/**
 * L'ordre de ce tableau est celui des onglets à l'écran : les deux genres les
 * plus courants d'abord, « autre » en dernier puisqu'il sert de fourre-tout.
 */
export const RECO_KINDS: readonly RecoKindMeta[] = [
  {
    key: 'film',
    label: 'Film',
    plural: 'Films',
    authorLabel: 'Réalisation',
    authorPlaceholder: 'Céline Sciamma',
    titlePlaceholder: 'Petite maman',
    statuses: { idee: 'À voir', en_cours: 'En cours', fait: 'Vu' },
  },
  {
    key: 'serie',
    label: 'Série',
    plural: 'Séries',
    authorLabel: 'Plateforme ou chaîne',
    authorPlaceholder: 'Arte',
    titlePlaceholder: 'Le Bureau des légendes',
    statuses: { idee: 'À voir', en_cours: 'En cours', fait: 'Terminée' },
  },
  {
    key: 'theatre',
    label: 'Théâtre',
    plural: 'Théâtre',
    authorLabel: 'Salle ou compagnie',
    authorPlaceholder: 'Théâtre de la Ville',
    titlePlaceholder: 'Le Malade imaginaire',
    statuses: { idee: 'À voir', en_cours: 'Places prises', fait: 'Vu' },
  },
  {
    key: 'cadeau',
    label: 'Idée cadeau',
    plural: 'Idées cadeaux',
    authorLabel: 'Où le trouver',
    authorPlaceholder: 'Librairie du coin',
    titlePlaceholder: 'Microscope pour enfant',
    statuses: { idee: 'Idée', en_cours: 'Réservé', fait: 'Offert' },
  },
  {
    key: 'autre',
    label: 'Autre',
    plural: 'Autres',
    authorLabel: 'De qui, ou où',
    authorPlaceholder: 'Restaurant, livre, podcast…',
    titlePlaceholder: 'Une envie à garder',
    statuses: { idee: 'À découvrir', en_cours: 'En cours', fait: 'Fait' },
  },
] as const;

export const RECO_STATUSES: readonly RecoStatus[] = ['idee', 'en_cours', 'fait'] as const;

const FALLBACK_KIND = RECO_KINDS[RECO_KINDS.length - 1];

/** Métadonnées d'un genre. Un genre inconnu retombe sur « autre ». */
export function recoKind(kind: RecoKind | string): RecoKindMeta {
  return RECO_KINDS.find((k) => k.key === kind) ?? FALLBACK_KIND;
}

export function recoKindLabel(kind: RecoKind | string): string {
  return recoKind(kind).label;
}

/** « Vu », « Offert », « Places prises »… selon le genre. */
export function recoStatusLabel(kind: RecoKind | string, status: RecoStatus): string {
  return recoKind(kind).statuses[status] ?? status;
}

/** Les idées cadeaux ont des champs à elles : destinataire, occasion, prix. */
export function isGift(kind: RecoKind | string): boolean {
  return kind === 'cadeau';
}

/* -------------------------------------------------------------------------- */
/* Liens                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Complète un lien saisi à la main.
 *
 * On colle rarement une URL complète depuis un téléphone : « allocine.fr/... »
 * arrive sans schéma, et un `href` sans schéma est lu comme un chemin relatif
 * — le lien resterait dans l'application au lieu de sortir. On préfixe donc
 * en `https://`, sans toucher à ce qui en a déjà un.
 *
 * Renvoie `null` si rien d'exploitable ne reste : la colonne accepte le vide.
 */
export function normalizeRecoUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    // Un lien « javascript: » ou « data: » n'a rien à faire dans un href.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** « allocine.fr » plutôt que l'URL entière, qui déborde sur téléphone. */
export function recoUrlHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Prix                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Lit un prix saisi à la française.
 *
 * On tape « 12,50 » sur un clavier français, pas « 12.50 », et l'on colle
 * parfois « 12,50 € » depuis un site marchand. `Number()` rend `NaN` sur les
 * trois cas. Les espaces de milliers — y compris l'insécable que produisent
 * les sites — sont retirés avant conversion.
 *
 * Renvoie `null` pour un champ vide ou illisible : le prix est facultatif,
 * une saisie approximative ne doit pas bloquer l'enregistrement de l'idée.
 */
export function parseRecoPrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;

  const cleaned = raw
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/[€]/g, '')
    .replace(',', '.');
  if (!cleaned) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;

  // La colonne est en numeric(10, 2) : au-delà, la base refuserait la ligne.
  return Math.round(value * 100) / 100;
}

/** Prix d'une idée cadeau, ou `null` s'il n'a pas été renseigné. */
export function formatRecoPrice(price: number | null | undefined): string | null {
  if (price === null || price === undefined) return null;
  if (!Number.isFinite(price)) return null;
  return formatEuros(price);
}

/* -------------------------------------------------------------------------- */
/* Recherche                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Clé de comparaison : minuscules, sans accent, ligatures décomposées.
 *
 * `normalize('NFD')` ne décompose pas « œ » — sans `expandLigatures`, chercher
 * « oeuf » ne trouverait pas « Œuvre ». Même piège que pour les ingrédients.
 */
export function recoSearchKey(text: string | null | undefined): string {
  if (!text) return '';
  return expandLigatures(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Champs dans lesquels la recherche plein texte va chercher. */
type Searchable = Pick<
  RecommendationRow,
  'title' | 'author' | 'note' | 'recipient_label' | 'occasion'
>;

export function matchesRecoSearch(reco: Searchable, query: string): boolean {
  const needle = recoSearchKey(query);
  if (!needle) return true;

  const haystack = recoSearchKey(
    [reco.title, reco.author, reco.note, reco.recipient_label, reco.occasion]
      .filter(Boolean)
      .join(' '),
  );

  return haystack.includes(needle);
}

/* -------------------------------------------------------------------------- */
/* Tri                                                                        */
/* -------------------------------------------------------------------------- */

/** Le minimum dont le tri a besoin : il s'applique aussi bien à une ligne
 *  brute qu'à une fiche enrichie de ses envies. */
export type SortableReco = {
  status: RecoStatus;
  rating: number | null;
  created_at: string;
  done_at?: string | null;
  wants?: readonly unknown[];
};

/**
 * Ordre d'affichage d'une liste de recommandations.
 *
 * Ce qui reste à faire passe devant ce qui est fait — une liste où « vu » et
 * « à voir » se mélangent ne sert plus à décider. À l'intérieur, le nombre
 * d'envies prime sur la note : trois personnes qui veulent voir le même film
 * en disent plus long que cinq étoiles données par une seule. Les éléments
 * terminés, eux, se lisent du plus récent au plus ancien.
 *
 * Le tri ne modifie pas le tableau reçu : les composants React comparent les
 * références pour décider de se rendre à nouveau.
 */
export function sortRecommendations<T extends SortableReco>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const aDone = a.status === 'fait';
    const bDone = b.status === 'fait';
    if (aDone !== bDone) return aDone ? 1 : -1;

    if (aDone && bDone) {
      return (b.done_at ?? b.created_at).localeCompare(a.done_at ?? a.created_at);
    }

    const wants = (b.wants?.length ?? 0) - (a.wants?.length ?? 0);
    if (wants !== 0) return wants;

    const rating = (b.rating ?? 0) - (a.rating ?? 0);
    if (rating !== 0) return rating;

    return b.created_at.localeCompare(a.created_at);
  });
}

/**
 * Nombre d'éléments encore ouverts par genre, pour les pastilles d'onglet.
 *
 * Ce qui est fait n'est pas compté : la pastille répond à « qu'est-ce qu'il
 * reste ? », pas à « combien en avons-nous saisi ? ».
 */
export function countOpenByKind(
  list: readonly Pick<RecommendationRow, 'kind' | 'status'>[],
): Record<RecoKind, number> {
  const counts = Object.fromEntries(RECO_KINDS.map((k) => [k.key, 0])) as Record<
    RecoKind,
    number
  >;

  for (const reco of list) {
    if (reco.status === 'fait') continue;
    if (reco.kind in counts) counts[reco.kind] += 1;
  }

  return counts;
}
