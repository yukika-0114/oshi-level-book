const CACHE = 'ttlv-v50';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先・失敗時はキャッシュ（更新がすぐ反映され、オフラインでも動く）
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // 毎回サーバーに更新を確認する
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});

// 通知をタップしたらアプリを開き、増加の確認を表示する
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './?openPending=1';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'OPEN_PENDING' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// 将来プッシュを受け取る場合の受け口（現在はサーバー送信なし）
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { payload = { body: e.data ? e.data.text() : '' }; }
  const title = payload.title || '増加の確認';
  const options = {
    body: payload.body || '増加の確認があります',
    tag: payload.tag || 'oshi-pending',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: './?openPending=1' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
