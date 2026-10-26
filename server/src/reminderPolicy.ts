// D136: the same small, content-free policy runs in the API, client and bundled service worker.
export const GATES = ['meds', 'water', 'food', 'menu', 'assistant', 'wellbeing', 'workout', 'progress', 'weight'] as const;
export type Gate = typeof GATES[number];
export interface Choice { id: string; at: number; priority: 0 | 1; enabled: boolean }
export interface DayRule extends Choice { date: string; from: number; until: number }
export interface ReminderPolicy { v: 1; modules: Partial<Record<Gate, Choice>>; days: DayRule[] }
export interface PolicyPayload { k?: unknown; m?: unknown; tag?: unknown; o?: unknown; d?: unknown; u?: unknown }
export const emptyPolicy = (): ReminderPolicy => ({ v: 1, modules: {}, days: [] });
const ID = /^[A-Za-z0-9:_-]{1,160}$/;
const instant = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= 8_640_000_000_000_000;
const fields = (x: object, keys: string[]) => Object.keys(x).length === keys.length && Object.keys(x).every((k) => keys.includes(k));
const choice = (x: unknown): x is Choice => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const c = x as Choice;
  return typeof c.id === 'string' && ID.test(c.id) && instant(c.at) && (c.priority === 0 || c.priority === 1)
    && typeof c.enabled === 'boolean' && (c.priority !== 0 || c.enabled);
};
export const newer = (a: Choice, b: Choice) => a.priority > b.priority || (a.priority === b.priority
  && (a.at > b.at || (a.at === b.at && a.id > b.id)));

/** Closed protocol: no free text, medical data or arbitrary scopes. Invalid requests are rejected as a whole. */
export function parseReminderPolicy(x: unknown): ReminderPolicy | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x) || !fields(x, ['v', 'modules', 'days'])) return;
  const p = x as ReminderPolicy;
  if (p.v !== 1 || !p.modules || typeof p.modules !== 'object' || Array.isArray(p.modules) || !Array.isArray(p.days) || p.days.length > 40) return;
  for (const [gate, c] of Object.entries(p.modules)) {
    if (!GATES.some((g) => g === gate) || !choice(c) || !fields(c, ['id', 'at', 'priority', 'enabled'])) return;
  }
  const dates = new Set<string>();
  for (const d of p.days) {
    if (!choice(d) || !fields(d, ['id', 'at', 'priority', 'enabled', 'date', 'from', 'until']) || d.priority !== 1
      || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)
      || !Number.isFinite(Date.parse(d.date + 'T00:00:00Z')) || new Date(d.date + 'T00:00:00Z').toISOString().slice(0, 10) !== d.date
      || !instant(d.from) || !instant(d.until) || d.until - d.from < 23 * 3_600_000 || d.until - d.from > 25 * 3_600_000 || dates.has(d.date)) return;
    dates.add(d.date);
  }
  return p;
}

/** Merge, never replace: an old device or omitted scope cannot erase a later explicit choice. */
export function mergeReminderPolicy(a: ReminderPolicy, b: ReminderPolicy): ReminderPolicy {
  const modules = { ...a.modules };
  for (const g of GATES) { const c = b.modules[g]; if (c && (!modules[g] || newer(c, modules[g]))) modules[g] = c; }
  const days = new Map(a.days.map((d) => [d.date, d]));
  for (const d of b.days) { const old = days.get(d.date); if (!old || newer(d, old)) days.set(d.date, d); }
  return { v: 1, modules, days: [...days.values()].sort((x, y) => x.date.localeCompare(y.date)) };
}

/** Only module/weight events in this preparation PR. Light-day projection is connected in parts 07/08. */
export function policyFromEvents(events: readonly unknown[]): ReminderPolicy {
  let p = emptyPolicy();
  for (const value of events) {
    if (!value || typeof value !== 'object') continue;
    const e = value as { kind?: string; module?: Gate; at?: string; id?: string; enabled?: boolean; source?: string };
    const gate = e.kind === 'weight' ? 'weight' : e.kind === 'module' ? e.module : undefined;
    if (!gate || !GATES.includes(gate) || (e.kind === 'module' && gate === 'weight')) continue;
    const c = { id: e.id, at: Date.parse(e.at ?? ''), enabled: e.enabled, priority: e.source === 'migration' ? 0 : 1 };
    if (choice(c)) p = mergeReminderPolicy(p, { v: 1, modules: { [gate]: c }, days: [] });
  }
  return { ...p, modules: Object.fromEntries(GATES.filter((g) => p.modules[g]).map((g) => [g, p.modules[g]!])) };
}

export function policyAccess(p: ReminderPolicy, at: number, now = at) {
  const on = (g: Gate) => {
    const c = p.modules[g];
    return !c || (c.enabled && (c.priority === 0 || at >= c.at));
  };
  const light = p.days.some((d) => d.enabled && ((at >= d.from && at < d.until) || (at <= now && now >= d.from && now < d.until)));
  return { meds: on('meds'), food: on('food') && !light, water: on('water') && !light,
    menu: on('menu') && !light, assistant: on('assistant') && !light, progress: on('progress') && !light,
    weight: (p.modules.weight ? on('weight') : on('wellbeing')) && !light };
}
export type PolicyAccess = ReturnType<typeof policyAccess>;

/** A snooze retains its original slot too: postponing it past midnight must not evade today's suppression. */
export function reminderAccess(p: ReminderPolicy, payload: PolicyPayload, at: number, now = at): PolicyAccess {
  const a = policyAccess(p, at, now);
  if (instant(payload.o)) {
    const original = policyAccess(p, payload.o, now);
    for (const g of Object.keys(a) as (keyof PolicyAccess)[]) a[g] = a[g] && original[g];
  }
  // Old meal/water payloads already carried their day, even though a snooze had no original epoch.
  const date = payload.k === 'water' ? payload.d : payload.k === 'meal' && typeof payload.u === 'string'
    ? /[?&]date=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(payload.u)?.[1] : undefined;
  if (typeof date === 'string' && p.days.some((d) => d.enabled && d.date === date)) a.food = a.water = a.menu = a.assistant = a.progress = a.weight = false;
  return a;
}

export function reminderAllowed(p: ReminderPolicy, payload: PolicyPayload, at: number, now = at, aware = true): boolean {
  return accessAllows(reminderAccess(p, payload, at, now), payload, aware, !Object.keys(p.modules).length && !p.days.length);
}

export function accessAllows(a: PolicyAccess, payload: PolicyPayload, aware = true, legacyUnknown = false): boolean {
  switch (payload.k) {
    case 'med': return a.meds;
    case 'meal': return a.food && ((aware && payload.m !== true) || a.menu); // old schedules cannot identify menu-derived meals
    case 'water': return a.water;
    case 'morning': return aware ? a.meds || a.food : a.meds && a.food; // legacy workers cannot filter their summary
    case 'evening': return a.menu && a.food;
    case 'topup': return a.menu && a.food && a.assistant;
    case 'week': return a.progress && (aware || (a.food && a.meds));
    case 'weight': return a.weight;
    case 'test': case 'visit': return true; // always-on doctor's plan/report
    default: return legacyUnknown; // unchanged pre-policy legacy requests
  }
}
