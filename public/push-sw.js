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

function idbAll(store) {
  return new Promise((resolve) => {
    const open = indexedDB.open('protocol');
    open.onerror = () => resolve([]);
    open.onsuccess = () => {
      try {
        const req = open.result.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => { resolve(req.result || []); open.result.close(); };
        req.onerror = () => { resolve([]); open.result.close(); };
      } catch (e) { resolve([]); }
    };
  });
}

function idbDay(date) {
  return new Promise((resolve) => {
    const open = indexedDB.open('protocol');
    open.onerror = () => resolve([]);
    open.onsuccess = () => {
      try {
        const req = open.result.transaction('entries', 'readonly').objectStore('entries').index('at').getAll(IDBKeyRange.bound(date, date + '\uffff'));
        req.onsuccess = () => { resolve(req.result || []); open.result.close(); };
        req.onerror = () => { resolve([]); open.result.close(); };
      } catch (e) { resolve([]); }
    };
  });
}

const hm = (at) => at.slice(11, 16);
const isMed = (p) => p.kind === 'medication' || p.kind === 'supplement';

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
  if (d.k === 'water' && d.d) { // D70: how much is in already, from the phone's own records
    const [entries, plan] = await Promise.all([idbDay(d.d), idbGet('plan', 'main')]);
    const ml = entries.filter((e) => e.kind === 'water' && e.status === 'done').reduce((n, e) => n + (e.waterMl || 0), 0);
    const target = plan && plan.targets && plan.targets.waterMl;
    const l = (x) => String(Math.round(x / 100) / 10).replace('.', ',');
    return `Випито ${l(ml)}${target ? ` з ${l(target)}` : ''} л — склянка води?`;
  }
  if (d.k === 'morning' && d.d) {
    const [entries, plan] = await Promise.all([idbDay(d.d), idbGet('plan', 'main')]);
    const meals = entries.filter((e) => e.kind === 'meal' && e.status === 'planned').sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => `${hm(e.at)} ${e.title}`);
    const times = [...new Set(((plan && plan.prescriptions) || []).filter(isMed).flatMap((p) => (p.schedule && p.schedule.times) || []))].sort();
    const parts = [meals.join(', '), times.length ? `ліки: ${times.join(', ')}` : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Меню на сьогодні немає — можна скласти в «Меню».';
  }
  if (d.k === 'evening' && d.d) {
    const entries = await idbDay(d.d);
    const planned = entries.filter((e) => e.kind === 'meal' && e.status === 'planned');
    if (!planned.length) return { body: 'Меню на завтра ще не складено — скласти?', url: `./#/menu?date=${d.d}` };
    const tips = [...new Set(entries.flatMap((e) => (e.menu && e.menu.tips) || []))];
    return tips.length ? tips.slice(0, 3).join(' · ') : planned.sort((a, b) => a.at.localeCompare(b.at)).map((e) => `${hm(e.at)} ${e.title}`).join(', ');
  }
  if (d.k === 'test' && d.d) {
    const plan = await idbGet('plan', 'main');
    const tests = ((plan && plan.prescriptions) || []).filter((p) => p.kind === 'test' && p.dueDate === d.d).map((p) => [p.title, p.notes].filter(Boolean).join(' — '));
    if (tests.length) return tests.join('; ');
  }
  if (d.k === 'week' && d.d) {
    const from = new Date(Date.parse(d.d + 'T12:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);
    const [entries, plan] = await Promise.all([idbAll('entries'), idbGet('plan', 'main')]);
    const week = entries.filter((e) => e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= d.d);
    const meals = week.filter((e) => e.kind === 'meal' && e.status === 'done').length;
    const days = new Set(week.map((e) => e.at.slice(0, 10))).size;
    const perDay = ((plan && plan.prescriptions) || []).filter(isMed).reduce((n, p) => n + ((p.schedule && p.schedule.times.length) || 0), 0);
    const meds = week.filter((e) => e.kind === 'med' && e.status === 'done' && e.checkKey).length;
    const parts = [`записи — ${days} з 7 днів`, `прийомів їжі — ${meals}`];
    if (perDay) parts.push(`ліки — ${Math.min(meds, perDay * 7)} з ${perDay * 7}`);
    return parts.join(' · ') + '. Подробиці — у «Прогрес».';
  }
  if (d.k === 'weight') {
    const w = (await idbAll('weights')).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (w) {
      const ago = Math.round((Date.parse((d.d || w.date) + 'T12:00:00Z') - Date.parse(w.date + 'T12:00:00Z')) / 86400000);
      return `Останнє — ${String(w.kg).replace('.', ',')} кг${ago > 0 ? `, ${ago} дн. тому` : ''}. Зранку, до сніданку.`;
    }
  }
  if (d.k === 'topup' && d.d) { // D116: what the day has against the plan's targets — counted here, never sent anywhere
    const [entries, plan, foods] = await Promise.all([idbDay(d.d), idbGet('plan', 'main'), idbAll('foods')]);
    const byId = new Map(foods.map((f) => [f.id, f]));
    const sum = { kcal: 0, protein: 0, calciumMg: 0 };
    const add = (it, k = 1) => {
      if (it.components && it.components.length) { it.components.forEach((c) => add(c, k)); return; }
      if (it.manual) { sum.kcal += (it.manual.kcal || 0) * k; sum.protein += (it.manual.protein || 0) * k; sum.calciumMg += (it.manual.calciumMg || 0) * k; return; }
      const f = it.foodId && byId.get(it.foodId);
      if (!f) return;
      const g = (it.grams || 0) / 100 * k;
      sum.kcal += f.per100g.kcal * g; sum.protein += f.per100g.protein * g; sum.calciumMg += (f.per100g.calciumMg || 0) * g;
    };
    entries.filter((e) => e.kind === 'meal' && e.status === 'done').forEach((e) => (e.items || []).forEach((it) => add(it)));
    const t = (plan && plan.targets) || {};
    const parts = [t.kcal ? `калорій ${Math.round(sum.kcal)} з ${t.kcal}` : '', t.proteinG ? `білка ${Math.round(sum.protein)} з ${t.proteinG} г` : '',
      t.calciumMg ? `кальцію ${Math.round(sum.calciumMg)} з ${t.calciumMg} мг` : ''].filter(Boolean);
    if (parts.length) return `Сьогодні: ${parts.join(', ')}. Відкрийте — підкажу, чим добрати.`;
  }
  if (d.k === 'visit') {
    const plan = await idbGet('plan', 'main');
    const q = (plan && plan.questions) || [];
    if (q.length) return `Ваші питання: ${q.length}. Звіт — у «Звіт для лікаря».`;
  }
  return undefined;
}

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  event.waitUntil((async () => {
    let body = d.b || '';
    let url = d.u || './';
    try {
      const x = await detail(d);
      if (typeof x === 'string') body = x;
      else if (x) { body = x.body; url = x.url; }
    } catch (e) { /* the generic words stay */ }
    const title = (d.n > 0 ? '⏰ Ще раз: ' : '') + (d.t || 'Протокол');
    await self.registration.showNotification(title, {
      body, tag: d.tag || undefined, renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // D94: only a page of this app opens — a payload's absolute address to another site is ignored
  const asked = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope);
  const url = asked.origin === self.location.origin ? asked.href : self.registration.scope;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { if ('navigate' in c) await c.navigate(url).catch(() => undefined); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
