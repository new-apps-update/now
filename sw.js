/* sw.js — keep this file in the SAME folder as the html file.
   Shows notifications while the app is closed. Every notification uses the fake app's
   name + icon (the page sends them here) and only ever a harmless text. */

const DB_NAME = 'app-meta', STORE = 'kv';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  try {
    const db = await idb();
    return await new Promise(res => {
      const q = db.transaction(STORE).objectStore(STORE).get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(undefined);
    });
  } catch (e) { return undefined; }
}
async function kvSet(k, v) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(v, k);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  } catch (e) {}
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
/* no-op fetch handler: keeps the app installable on every Android/Chrome version, changes nothing */
self.addEventListener('fetch', () => {});

/* the page tells us the current fake-app name / icon / throttle settings */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'identity') {
    e.waitUntil(kvSet('identity', { name: d.name, icon: d.icon, mode: d.mode, win: d.win, url: d.url }));
  }
});

async function onPush(e) {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) { try { p = { body: e.data.text() }; } catch (__) {} }
  const d = (p && p.data) ? p.data : (p || {});
  const id = (await kvGet('identity')) || {};
  const tag = String(d.tag || 'chat-msg');
  const body = String(d.body || 'New update available');
  const title = id.name || 'Calculator';

  /* app is open and in front: the page already shows it inside the app */
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (wins.some(c => c.visibilityState === 'visible' && c.focused !== false)) return;

  let loud = true;

  /* "only the first message in N minutes" mode: later ones replace the old one silently */
  if (id.mode === 'window' && tag !== 'admin-push') {
    const win = Math.max(1, parseInt(id.win, 10) || 30) * 60000;
    const last = (await kvGet('lastAt')) || 0;
    if (Date.now() - last < win) loud = false; else await kvSet('lastAt', Date.now());
  }

  /* the page may have just shown the same notification itself: replace it quietly */
  try {
    const cur = await self.registration.getNotifications({ tag: tag });
    if (cur.some(n => n.data && n.data.ts && Date.now() - n.data.ts < 12000)) loud = false;
  } catch (_) {}

  const opts = {
    body: body, tag: tag, renotify: loud, silent: !loud,
    data: { ts: Date.now(), url: id.url || self.registration.scope }
  };
  if (id.icon) { opts.icon = id.icon; opts.badge = id.icon; }
  await self.registration.showNotification(title, opts);
}
self.addEventListener('push', e => e.waitUntil(onPush(e)));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if ('focus' in c) { await c.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
