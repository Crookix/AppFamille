import { describe, expect, it } from 'vitest';
import {
  RECO_KINDS,
  countOpenByKind,
  formatRecoPrice,
  isGift,
  matchesRecoSearch,
  normalizeRecoUrl,
  parseRecoPrice,
  recoKind,
  recoKindLabel,
  recoStatusLabel,
  recoUrlHost,
  sortRecommendations,
} from '@/lib/recommendations';
import type { RecoKind, RecoStatus } from '@/lib/database.types';

/** Fiche minimale pour les tests de tri et de recherche. */
function reco(
  overrides: Partial<{
    status: RecoStatus;
    rating: number | null;
    created_at: string;
    done_at: string | null;
    wants: string[];
    kind: RecoKind;
    title: string;
    author: string | null;
    note: string | null;
    recipient_label: string | null;
    occasion: string | null;
  }> = {},
) {
  return {
    kind: 'film' as RecoKind,
    status: 'idee' as RecoStatus,
    title: 'Titre',
    author: null,
    note: null,
    recipient_label: null,
    occasion: null,
    rating: null,
    created_at: '2026-01-01T00:00:00.000Z',
    done_at: null,
    wants: [] as string[],
    ...overrides,
  };
}

describe('vocabulaire des genres', () => {
  it('adapte le libellé de l’état au genre', () => {
    expect(recoStatusLabel('film', 'fait')).toBe('Vu');
    expect(recoStatusLabel('cadeau', 'fait')).toBe('Offert');
    expect(recoStatusLabel('cadeau', 'idee')).toBe('Idée');
    expect(recoStatusLabel('theatre', 'en_cours')).toBe('Places prises');
  });

  it('retombe sur « autre » pour un genre inconnu', () => {
    // Une valeur ajoutée à l'enum côté base ne doit pas casser l'affichage.
    expect(recoKind('podcast').key).toBe('autre');
    expect(recoKindLabel('podcast')).toBe('Autre');
    expect(recoStatusLabel('podcast', 'fait')).toBe('Fait');
  });

  it('ne réserve les champs cadeau qu’aux cadeaux', () => {
    expect(isGift('cadeau')).toBe(true);
    expect(isGift('film')).toBe(false);
  });

  it('donne un libellé d’état aux cinq genres', () => {
    for (const kind of RECO_KINDS) {
      for (const status of ['idee', 'en_cours', 'fait'] as const) {
        expect(recoStatusLabel(kind.key, status).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('liens', () => {
  it('complète un lien collé sans schéma', () => {
    expect(normalizeRecoUrl('allocine.fr/film/12')).toBe('https://allocine.fr/film/12');
  });

  it('laisse intact un lien déjà complet', () => {
    expect(normalizeRecoUrl('https://www.arte.tv/fr/')).toBe('https://www.arte.tv/fr/');
    expect(normalizeRecoUrl('http://exemple.fr/')).toBe('http://exemple.fr/');
  });

  it('refuse ce qui n’est pas une page web', () => {
    // Un « javascript: » dans un href serait exécuté au clic.
    expect(normalizeRecoUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeRecoUrl('data:text/html,<script>')).toBeNull();
  });

  it('traite le vide comme une absence de lien', () => {
    expect(normalizeRecoUrl('')).toBeNull();
    expect(normalizeRecoUrl('   ')).toBeNull();
    expect(normalizeRecoUrl(null)).toBeNull();
  });

  it('affiche le domaine, sans « www. »', () => {
    expect(recoUrlHost('https://www.allocine.fr/film/12')).toBe('allocine.fr');
    expect(recoUrlHost('pas une url')).toBeNull();
    expect(recoUrlHost(null)).toBeNull();
  });
});

describe('prix', () => {
  it('lit une virgule décimale française', () => {
    expect(parseRecoPrice('12,50')).toBe(12.5);
    expect(parseRecoPrice('12.50')).toBe(12.5);
  });

  it('supporte un prix collé depuis un site marchand', () => {
    expect(parseRecoPrice('12,50 €')).toBe(12.5);
    expect(parseRecoPrice('1 200,00 €')).toBe(1200);
    // Espace insécable étroit, produit par les sites français.
    expect(parseRecoPrice('1 200,00')).toBe(1200);
  });

  it('rend null sur un champ vide ou illisible', () => {
    expect(parseRecoPrice('')).toBeNull();
    expect(parseRecoPrice(null)).toBeNull();
    expect(parseRecoPrice('gratuit')).toBeNull();
    expect(parseRecoPrice('-5')).toBeNull();
  });

  it('arrondit au centime, comme la colonne numeric(10, 2)', () => {
    expect(parseRecoPrice('12,999')).toBe(13);
    expect(parseRecoPrice('12,004')).toBe(12);
  });

  it('formate en euros, en français', () => {
    // L'espace avant « € » est insécable : on compare sans s'y arrêter.
    expect(formatRecoPrice(25)?.replace(/\s/g, ' ')).toBe('25,00 €');
    expect(formatRecoPrice(null)).toBeNull();
  });
});

describe('recherche', () => {
  it('ignore la casse et les accents', () => {
    const item = reco({ title: 'Amélie Poulain' });
    expect(matchesRecoSearch(item, 'amelie')).toBe(true);
    expect(matchesRecoSearch(item, 'AMÉLIE')).toBe(true);
  });

  it('décompose les ligatures', () => {
    // « œ » ne se décompose pas en NFD : sans expandLigatures, « oeuvre » rate.
    expect(matchesRecoSearch(reco({ title: 'Une œuvre majeure' }), 'oeuvre')).toBe(true);
  });

  it('cherche aussi dans le pourquoi, le destinataire et l’occasion', () => {
    const cadeau = reco({
      kind: 'cadeau',
      title: 'Microscope',
      note: 'Elle adore les sciences',
      recipient_label: 'Mamie',
      occasion: 'Noël',
    });
    expect(matchesRecoSearch(cadeau, 'sciences')).toBe(true);
    expect(matchesRecoSearch(cadeau, 'mamie')).toBe(true);
    expect(matchesRecoSearch(cadeau, 'noel')).toBe(true);
    expect(matchesRecoSearch(cadeau, 'vélo')).toBe(false);
  });

  it('laisse tout passer quand la recherche est vide', () => {
    expect(matchesRecoSearch(reco(), '')).toBe(true);
    expect(matchesRecoSearch(reco(), '   ')).toBe(true);
  });
});

describe('tri', () => {
  it('place ce qui est fait après le reste', () => {
    const list = [
      reco({ title: 'Vu', status: 'fait' }),
      reco({ title: 'À voir', status: 'idee' }),
    ];
    expect(sortRecommendations(list).map((r) => r.title)).toEqual(['À voir', 'Vu']);
  });

  it('fait passer les envies partagées devant la note', () => {
    const list = [
      reco({ title: 'Bien noté', rating: 5 }),
      reco({ title: 'Deux envies', rating: 1, wants: ['a', 'b'] }),
    ];
    expect(sortRecommendations(list).map((r) => r.title)).toEqual([
      'Deux envies',
      'Bien noté',
    ]);
  });

  it('départage par la note, puis par l’ajout le plus récent', () => {
    const list = [
      reco({ title: 'Ancien', created_at: '2026-01-01T00:00:00.000Z' }),
      reco({ title: 'Récent', created_at: '2026-03-01T00:00:00.000Z' }),
      reco({ title: 'Noté', rating: 4, created_at: '2025-01-01T00:00:00.000Z' }),
    ];
    expect(sortRecommendations(list).map((r) => r.title)).toEqual([
      'Noté',
      'Récent',
      'Ancien',
    ]);
  });

  it('classe le terminé du plus récemment fait au plus ancien', () => {
    const list = [
      reco({ title: 'Vu en janvier', status: 'fait', done_at: '2026-01-05T00:00:00.000Z' }),
      reco({ title: 'Vu en mars', status: 'fait', done_at: '2026-03-05T00:00:00.000Z' }),
    ];
    expect(sortRecommendations(list).map((r) => r.title)).toEqual([
      'Vu en mars',
      'Vu en janvier',
    ]);
  });

  it('ne modifie pas le tableau reçu', () => {
    const list = [reco({ title: 'A', status: 'fait' }), reco({ title: 'B' })];
    const copy = [...list];
    sortRecommendations(list);
    expect(list).toEqual(copy);
  });
});

describe('compteurs par genre', () => {
  it('ne compte que ce qui reste à faire', () => {
    const counts = countOpenByKind([
      reco({ kind: 'film' }),
      reco({ kind: 'film', status: 'en_cours' }),
      reco({ kind: 'film', status: 'fait' }),
      reco({ kind: 'cadeau' }),
    ]);

    expect(counts.film).toBe(2);
    expect(counts.cadeau).toBe(1);
    expect(counts.serie).toBe(0);
  });

  it('renvoie une entrée pour chaque genre, même vide', () => {
    const counts = countOpenByKind([]);
    for (const kind of RECO_KINDS) {
      expect(counts[kind.key]).toBe(0);
    }
  });
});
