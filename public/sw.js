/*
 * Service worker de MyFamily.
 *
 * Volontairement modeste. Une application familiale manipule des données
 * partagées qui changent d'une minute à l'autre : servir une version en cache
 * ferait apparaître une course déjà achetée ou une tâche déjà faite. Le réseau
 * est donc toujours consulté en premier, et le cache ne sert que de filet
 * quand la connexion manque.
 *
 * Ne sont jamais mises en cache : les requêtes d'authentification, les appels
 * à Supabase et toutes les méthodes autres que GET.
 */

const VERSION = 'myfamily-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const PAGES_CACHE = `${VERSION}-pages`;

const SHELL_ASSETS = [
  '/hors-connexion',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheable(request) {
  if (request.method !== 'GET') return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  // L'authentification et les routes serveur ne doivent jamais être rejouées.
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/auth/')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isCacheable(request)) return;

  // Ressources versionnées de Next : leur URL change à chaque déploiement,
  // le cache peut donc répondre directement.
  const url = new URL(request.url);
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Pages : réseau d'abord, cache en secours, page hors connexion en dernier.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PAGES_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match('/hors-connexion')),
        ),
    );
  }
});
