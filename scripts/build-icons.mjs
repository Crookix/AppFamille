#!/usr/bin/env node
/**
 * Génère les icônes PNG de la PWA à partir de l'icône vectorielle.
 *
 *   node scripts/build-icons.mjs
 *
 * L'icône « maskable » est dessinée à part : Android rogne l'icône en cercle,
 * il faut donc que le motif tienne dans la zone sûre centrale (~80 %).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
const source = readFileSync(join(iconsDir, 'icon.svg'));

const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#de6f47"/>
  <g transform="translate(256 256) scale(0.68) translate(-256 -256)">
    <path d="M256 108 106 236v168a20 20 0 0 0 20 20h100V300h60v124h100a20 20 0 0 0 20-20V236z" fill="#fdf5ec"/>
    <circle cx="196" cy="196" r="26" fill="#6da887"/>
    <circle cx="316" cy="196" r="26" fill="#e9b04a"/>
  </g>
</svg>`;

await Promise.all([
  sharp(source, { density: 384 }).resize(192, 192).png().toFile(join(iconsDir, 'icon-192.png')),
  sharp(source, { density: 384 }).resize(512, 512).png().toFile(join(iconsDir, 'icon-512.png')),
  sharp(source, { density: 384 }).resize(180, 180).png().toFile(join(iconsDir, 'apple-touch-icon.png')),
  sharp(Buffer.from(maskable), { density: 384 })
    .resize(512, 512)
    .png()
    .toFile(join(iconsDir, 'icon-maskable-512.png')),
  sharp(source, { density: 128 }).resize(32, 32).png().toFile(join(root, 'public', 'favicon.png')),
]);

console.log('Icônes générées dans public/icons.');
