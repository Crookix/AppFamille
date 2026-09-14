#!/usr/bin/env node
/**
 * Applique les migrations SQL de `supabase/migrations` sur la base Supabase.
 *
 *   npm run db:push
 *
 * Les migrations déjà appliquées sont enregistrées dans `_tribu_migrations`
 * et ne sont jamais rejouées. Chaque fichier s'exécute dans sa propre
 * transaction : en cas d'erreur, rien de ce fichier n'est appliqué.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

dotenv.config({ path: join(root, '.env.local'), quiet: true });
dotenv.config({ path: join(root, '.env'), quiet: true });

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error(
    'SUPABASE_DB_URL manquante.\n' +
      'Renseignez-la dans .env.local (voir .env.example) :\n' +
      '  Dashboard Supabase > Connect > ORMs/psql > Connection string',
  );
  process.exit(1);
}

const migrationsDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

// Supabase n'accepte que le TLS ; un PostgreSQL local n'en a pas du tout, et
// le lui imposer fait échouer la connexion avant la première migration. C'est
// ce qui empêchait de rejouer les migrations hors Supabase — en intégration
// continue, ou contre la pile locale de `npx supabase start`.
const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);

const client = new pg.Client({
  connectionString,
  ssl: local ? false : { rejectUnauthorized: false },
});

const only = process.argv[2];

async function main() {
  await client.connect();

  await client.query(`
    create table if not exists public._tribu_migrations (
      name        text primary key,
      applied_at  timestamptz not null default now()
    );
  `);

  const { rows } = await client.query('select name from public._tribu_migrations');
  const applied = new Set(rows.map((r) => r.name));

  let count = 0;
  for (const file of files) {
    if (only && !file.includes(only)) continue;
    if (applied.has(file)) {
      console.log(`  déjà appliquée  ${file}`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    process.stdout.write(`  application     ${file} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into public._tribu_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log('ok');
      count += 1;
    } catch (error) {
      await client.query('rollback');
      console.log('ÉCHEC');
      console.error(`\n${file} :\n${error.message}\n`);
      if (error.position) {
        const pos = Number(error.position);
        const upTo = sql.slice(0, pos);
        const line = upTo.split('\n').length;
        console.error(`  ligne ~${line} : ${sql.split('\n')[line - 1]?.trim()}\n`);
      }
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode !== 1) {
    console.log(
      count === 0 ? '\nBase déjà à jour.' : `\n${count} migration(s) appliquée(s).`,
    );
  }
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
