import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement des jetons Google stockés en base.
 *
 * AES-256-GCM : confidentialité ET authenticité. Un jeton modifié en base ne
 * se déchiffre pas, il lève une erreur au lieu de produire une valeur
 * silencieusement fausse.
 *
 * Ce chiffrement s'ajoute à l'isolation de la table `google_credentials`, qui
 * n'a aucune policy et reste donc hors de portée du navigateur. Une fuite de
 * la base seule ne suffit pas à exploiter les jetons.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommandé pour GCM
const KEY_LENGTH = 32;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY manquante. Générez-la avec : openssl rand -base64 32',
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY doit faire 32 octets une fois décodée en base64 (${key.length} obtenus).`,
    );
  }

  cachedKey = key;
  return key;
}

/** La clé de chiffrement est-elle configurée et valide ? */
export function isEncryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** Chiffre une valeur. Format : `iv.tag.chiffré`, en base64url. */
export function encryptToken(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

/** Déchiffre une valeur produite par `encryptToken`. */
export function decryptToken(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Jeton chiffré illisible.');
  }

  const [ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
