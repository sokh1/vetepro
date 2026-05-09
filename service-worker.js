// ============================================================
//  VetePro - Service Worker PWA
//  Strategie : Cache-first pour les assets, Network-first pour les donnees
// ============================================================

const CACHE_NAME = 'vetepro-v1';
const OFFLINE_PAGE = 'vetepro_final.html';

// Fichiers a mettre en cache au premier chargement
const PRECACHE_ASSETS = [
  './vetepro_final.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// ---- INSTALLATION : precache des assets ----
self.addEventListener('install', event => {
  console.log('[SW] Installation...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Mise en cache des assets');
        // On tente le cache mais on ne bloque pas si un asset externe echoue
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Impossible de cacher:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ---- ACTIVATION : supprimer les anciens caches ----
self.addEventListener('activate', event => {
  console.log('[SW] Activation...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Suppression ancien cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ---- FETCH : strategie hybride ----
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ne pas intercepter les requetes vers Google Sheets / Apps Script
  // (doivent toujours aller sur le reseau)
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('sheets.googleapis.com') ||
    url.hostname.includes('googleapis.com')
  ) {
    return; // laisser passer sans interception
  }

  // Pour les requetes GET uniquement
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Asset en cache : le servir immediatement
        // ET mettre a jour le cache en arriere-plan (stale-while-revalidate)
        const fetchPromise = fetch(event.request)
          .then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              const cloned = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse); // si hors ligne, garder le cache

        return cachedResponse; // reponse immediate depuis le cache
      }

      // Pas en cache : aller sur le reseau et mettre en cache si succes
      return fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200 && event.request.url.startsWith('http')) {
            const cloned = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return networkResponse;
        })
        .catch(() => {
          // Hors ligne et pas en cache : page de fallback
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match(OFFLINE_PAGE);
          }
        });
    })
  );
});

// ---- MESSAGE : forcer la mise a jour du cache ----
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Cache supprime sur demande');
    });
  }
});
