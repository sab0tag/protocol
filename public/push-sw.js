// Reminders (SPEC.md D34), imported into the generated service worker. The push carries only a generic word
// («Обід», «Ліки»); the details come from this phone's own data in IndexedDB — the server never sees them.
/* eslint-env serviceworker */
function idbGet(store, key) {
  return new Promise((resolve) => {
    const open = indexedDB.open('protocol');
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      try {
        const req = open.result.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => { resolve(req.result); open.result.close(); };
        req.onerror = () => { resolve(undefined); open.result.close(); };
      } catch (e) { resolve(undefined); }
    };
  });
}

const amount = (it) => it.recipe ? `${it.recipe.portions} порц.` : it.unit ? `${it.unit.qty} ${it.unit.name}` : `${it.grams} г`;

async function detail(d) {
  if (d.k === 'meal' && d.e) {
    const e = await idbGet('entries', d.e);
    if (e && e.items && e.items.length) return e.items.map((it) => `${it.name} ${amount(it)}`).join(', ');
  }
  if (d.k === 'med' && d.h) {
    const plan = await idbGet('plan', 'main');
    const meds = (plan && plan.prescriptions || []).filter((p) => p.schedule && p.schedule.times.includes(d.h)
      && (p.kind === 'medication' || p.kind === 'supplement'));
    if (meds.length) return meds.map((p) => [p.title, p.dose, p.schedule.withFood ? 'під час їжі' : ''].filter(Boolean).join(' ')).join(', ');
  }
  return undefined;
}

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  event.waitUntil((async () => {
    let body = d.b || '';
    try { body = (await detail(d)) || body; } catch (e) { /* the generic words stay */ }
    const title = (d.n > 0 ? '⏰ Ще раз: ' : '') + (d.t || 'Протокол');
    await self.registration.showNotification(title, {
      body, tag: d.tag || undefined, renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.u || './' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { if ('navigate' in c) await c.navigate(url).catch(() => undefined); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
