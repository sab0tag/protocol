// D123: «Додати списком» — a list of dishes, pasted or from a file. Each line goes one of four ways (src/domain/dishList.ts);
// only a make-up that needs the model goes to it, in packs of 15 with the base's names once; a name alone is a draft
// «Потрібен склад» with no numbers (ТЗ v1.0, R08) — its make-up can be typed right here. Nothing is saved by itself: the
// cards wait to be checked, «Зберегти всі з ✓» takes only those made entirely of the base with the amounts said, a «?» one is
// saved on its own after it is opened. The unsaved list survives a reload (its breakdowns are paid for).
import { ChevronDown, ChevronUp, FileUp, ListPlus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { db, inDemo } from '../data/db';
import { harchDishes } from '../data/harchDishes';
import { keep, kept } from '../data/kept';
import { newId } from '../domain/dates';
import { breakdown, lineItem, recipeItems, type DishLine } from '../domain/dishBreakdown';
import { decode, fileLine, fromFile, MAX_BYTES, packs, parseCsv, parseText, tally, wayOf, type ListContext, type ListRow, type Way } from '../domain/dishList';
import { mealNutrients } from '../domain/nutrition';
import { dishItem } from '../domain/recipes';
import type { Food, Plan, Recipe } from '../domain/types';
import { t } from '../i18n/uk';
import { ApiError, dishesBreakdown } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { BreakdownEditor, fmt } from './BreakdownEditor';
import { allowDishes, dishConsented } from './DishBreakdown';
import { saved } from './Toast';

const L = t.dishes.list;
const KEPT = 'dishlist';
const WEEK = 7 * 86_400_000;

type Status = 'exists' | 'ready' | 'waiting' | 'draft' | 'failed' | 'notDish' | 'later' | 'skipped' | 'saved';
export interface Card {
  key: string; name: string; text: string; make?: string; portions: number; status: Status; sameName?: true;
  where?: 'own' | 'builtin' | 'harch' | 'base'; local?: { lines: DishLine[]; portions: number }; // «вже є» with a make-up of its own
  lines: DishLine[]; note?: string; ai?: boolean; fromFile?: boolean; reason?: string; open?: boolean; invalid?: true;
}
interface State { cards: Card[]; merged: number; over: number; cut: number; imported: number }

/** ✓ — every ingredient of the base with the amount said, nothing proposed; or a dish of one's own export. */
export const sure = (c: Card) => c.status === 'ready' && (c.fromFile || c.lines.every((l) => !!l.food && l.amountSaid));


function cardOf(row: ListRow, way: Way): Card {
  const base = { key: row.key, name: row.name, text: row.text, ...(row.make ? { make: row.make } : {}), ...(row.sameName ? { sameName: true as const } : {}),
    portions: row.portions ?? 1, lines: [] as DishLine[] };
  switch (way.kind) {
    case 'exists': return { ...base, status: 'exists', where: way.where, ...(way.local ? { local: way.local } : {}) };
    case 'local': return { ...base, status: 'ready', lines: way.lines, portions: way.portions };
    case 'ai': return { ...base, status: 'waiting' };
    case 'draft': return { ...base, status: 'draft' };
    case 'notDish': return { ...base, status: 'notDish', reason: L.notDish };
  }
}

export function DishList({ foods, recipes, plan, onClose }: { foods: Map<string, Food>; recipes: Recipe[]; plan?: Plan; onClose: () => void }) {
  const [state, setStateRaw] = useState<State | null>(() => kept<State>(KEPT, WEEK) ?? null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<[number, number] | null>(null);
  const [asking, setAsking] = useState<'consent' | 'close' | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const list = useMemo(() => [...foods.values()], [foods]);
  const ctx: ListContext = useMemo(() => ({ foods: list, recipes, harch: harchDishes(foods).map((d) => d.name), dishItem }), [list, recipes, foods]);
  const setState = (s: State | null) => { setStateRaw(s); keep(KEPT, s ?? undefined); };
  const update = (fn: (cs: Card[]) => Card[]) => setStateRaw((s) => { if (!s) return s; const n = { ...s, cards: fn(s.cards) }; keep(KEPT, n); return n; });
  const patch = (key: string, p: Partial<Card>) => update((cs) => cs.map((c) => (c.key === key ? { ...c, ...p } : c)));

  const take = (body: string, csv: boolean) => {
    setError('');
    const file = fromFile(body, foods);
    if (file) {
      const fromExport = file.dishes;
      const cards = fromExport.map((d, i): Card => {
        const lines = d.items.map((it, j) => fileLine(it, j, foods));
        const way = wayOf({ key: `f${i}`, name: d.name, text: d.name }, ctx);
        const local = { lines, portions: 1 };
        const card = { key: `f${i}`, name: d.name, text: d.name, portions: 1, fromFile: true };
        if (way.kind === 'exists') return { ...card, status: 'exists', where: way.where, ...(lines.length ? { local } : {}), lines: [] };
        return lines.length ? { ...card, status: 'ready', lines } : { ...card, status: 'draft', lines: [] };
      });
      // D131: a dish with an invalid line is not lost silently — a card that says why
      const bad = file.bad.map((b, i): Card => ({ key: `b${i}`, name: b.name, text: b.name, portions: 1, status: 'failed', reason: L.invalid(b.why), lines: [], invalid: true }));
      setState({ cards: [...cards, ...bad], merged: 0, over: 0, cut: 0, imported: cards.length });
      return;
    }
    const parsed = csv ? parseCsv(body) : parseText(body);
    if (!parsed.rows.length) { setError(L.unreadableFile); return; }
    setState({ cards: parsed.rows.map((r) => cardOf(r, wayOf(r, ctx))), merged: parsed.merged, over: parsed.over, cut: parsed.cut, imported: 0 });
  };
  const pick = async (f: File | undefined) => {
    if (file.current) file.current.value = '';
    if (!f) return;
    if (f.size > MAX_BYTES * 2) { setError(L.tooBig); return; } // a .json export may be larger than a list; the rows are capped anyway
    const body = decode(new Uint8Array(await f.arrayBuffer()));
    if (body === null) { setError(L.unreadableFile); return; }
    take(body, /\.csv$/i.test(f.name));
  };

  // ------------------------------------------------------------------ to the model
  const send = async (pack: Card[], tried = false): Promise<void> => {
    try {
      const r = await dishesBreakdown(currentKeys() ?? null, pack.map((c) => ({ key: c.key, text: `${c.name} — ${c.make ?? ''}` })),
        list.map((f) => f.name));
      const got = new Map(r.dishes.map((d) => [d.key, d]));
      update((cs) => cs.map((c) => {
        if (!pack.some((p) => p.key === c.key)) return c;
        const d = got.get(c.key);
        if (!d) return { ...c, status: 'failed', reason: L.missing };
        if (!d.readable) return { ...c, status: 'notDish', reason: L.notDish };
        const lines = breakdown(d, list);
        if (!lines.length) return { ...c, status: 'failed', reason: L.missing };
        return { ...c, status: 'ready', lines, ai: true, note: d.note, portions: c.portions > 1 ? c.portions : Math.max(1, Math.round(d.portions) || 1) };
      }));
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'other');
      if (err.status === 429 && err.code === 'too_many') {
        const left = Number(err.data.left ?? 0);
        if (left > 0 && left < pack.length) { await send(pack.slice(0, left), tried); update((cs) => cs.map((c) => (pack.slice(left).some((p) => p.key === c.key) ? { ...c, status: 'later', reason: L.later } : c))); return; }
        update((cs) => cs.map((c) => (pack.some((p) => p.key === c.key) ? { ...c, status: 'later', reason: L.later } : c)));
        return;
      }
      const fail = (reason: string) => update((cs) => cs.map((c) => (pack.some((p) => p.key === c.key) ? { ...c, status: 'failed', reason } : c)));
      if (err.status === 0 && err.code === 'offline') { fail(L.offline); return; }
      if (err.code === 'ai_off') { fail(L.aiOff); return; } // nothing to try again now
      if (err.status === 422 && pack.length === 1) { fail(L.refused); return; }
      if (err.status === 400 || err.status === 413) { fail(L.tryLater); return; }
      // a timeout or a failed pack: once more, halved; then «спробуйте пізніше» (a failed pack is not counted on the server)
      if (!tried && pack.length > 1) { const h = Math.ceil(pack.length / 2); await send(pack.slice(0, h), true); await send(pack.slice(h), true); return; }
      if (!tried) { await send(pack, true); return; }
      update((cs) => cs.map((c) => (pack.some((p) => p.key === c.key) ? { ...c, status: 'failed', reason: L.tryLater } : c)));
    }
  };
  const run = async () => {
    if (!state) return;
    if (inDemo()) { setError(L.demo); return; } // D98
    if (!dishConsented()) { setAsking('consent'); return; }
    const waiting = state.cards.filter((c) => c.status === 'waiting');
    const ps = packs(waiting);
    for (const [i, p] of ps.entries()) { setBusy([i + 1, ps.length]); await send(p); }
    setBusy(null);
  };

  // ------------------------------------------------------------------ saving
  const recipeOf = (c: Card): Recipe => (c.status === 'draft'
    ? { id: newId(), name: c.name.trim(), items: [], needsMake: true } // a name only — no lines, no numbers
    : { id: newId(), name: c.name.trim(), items: recipeItems(c.lines, c.portions) });
  /** A draft's make-up typed on its card: the same four ways again — made here, or waiting for the model. */
  const make = (c: Card, text: string) => {
    const row: ListRow = { key: c.key, name: c.name, text: `${c.name} — ${text}`, make: text, ...(c.portions > 1 ? { portions: c.portions } : {}) };
    const w = wayOf(row, { ...ctx, recipes: ctx.recipes.filter((r) => r.name !== c.name) });
    patch(c.key, w.kind === 'local' ? { make: text, status: 'ready', lines: w.lines, portions: w.portions } : { make: text, status: 'waiting' });
  };
  const save = async (cs: Card[]) => {
    const rs = cs.map(recipeOf);
    if (!rs.length) return;
    if (await saved(db.recipes.bulkPut(rs).then(() => true), L.saved(rs.length), async () => { await db.recipes.bulkDelete(rs.map((r) => r.id)); update((all) => all.map((c) => (cs.some((x) => x.key === c.key) ? { ...c, status: 'ready' } : c))); })) {
      update((all) => all.map((c) => (cs.some((x) => x.key === c.key) ? { ...c, status: 'saved', open: false } : c)));
    }
  };

  if (!state) return (
    <section aria-label={L.title} className="space-y-2 rounded-2xl border border-line bg-surface p-3">
      <h2 className="flex items-center gap-2 font-semibold"><ListPlus size={18} className="text-accent" aria-hidden />{L.title}</h2>
      <p className="text-sm text-muted">{L.hint}</p>
      <label className="block"><span className="sr-only">{L.title}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={L.placeholder}
          className="block w-full rounded-xl border border-line bg-bg p-2" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!text.trim()} onClick={() => take(text.slice(0, MAX_BYTES), false)}
          className="min-h-tap rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{L.read}</button>
        <button type="button" onClick={() => file.current?.click()} className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 text-accent">
          <FileUp size={18} aria-hidden />{L.file}</button>
        <input ref={file} type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" className="hidden" aria-label={L.file}
          onChange={(e) => void pick(e.target.files?.[0])} />
        <button type="button" onClick={onClose} className="min-h-tap rounded-xl border border-line px-3">{t.meal.cancel}</button>
      </div>
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </section>
  );

  const cards = state.cards;
  const ways = cards.map((c): Way => (c.status === 'exists' ? { kind: 'exists', where: c.where ?? 'own' } : c.status === 'waiting' || c.ai ? { kind: 'ai' }
    : c.status === 'draft' ? { kind: 'draft' } : c.status === 'notDish' ? { kind: 'notDish' } : { kind: 'local', lines: c.lines, portions: c.portions }));
  const sum = tally(ways), waiting = cards.filter((c) => c.status === 'waiting').length;
  const ready = cards.filter((c) => sure(c)), drafts = cards.filter((c) => c.status === 'draft');
  return (
    <section aria-label={L.title} className="space-y-3 rounded-2xl border border-line bg-surface p-3">
      <h2 className="flex items-center gap-2 font-semibold"><ListPlus size={18} className="text-accent" aria-hidden />{L.title}</h2>
      <p role="status" data-testid="list-summary" className="text-sm">{L.summary(sum.all, sum.exists, sum.local, sum.drafts, sum.ai, Math.ceil(waiting / 15))}</p>
      {[state.merged > 0 && L.merged(state.merged), state.over > 0 && L.over(state.over), state.cut > 0 && L.cut(state.cut), state.imported > 0 && L.fromFile(state.imported)]
        .filter(Boolean).map((x) => <p key={String(x)} className="text-xs text-muted">{x}</p>)}
      {waiting > 0 && !busy && (
        <div className="space-y-1">
          <button type="button" onClick={() => void run()} className="min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface">{L.go}</button>
          {!dishConsented() && <p className="text-xs text-muted">{L.needConsent}</p>}
        </div>
      )}
      {asking === 'consent' && (
        <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{t.dishes.breakdown.consent}</p>
          <button type="button" onClick={() => { allowDishes(); setAsking(null); void run(); }} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{t.dishes.breakdown.allow}</button>
        </div>
      )}
      {busy && <p role="status" className="text-sm text-muted">{L.busy(busy[0], busy[1])}</p>}
      {ready.length > 0 && (
        <button type="button" onClick={() => void save(ready)} className="min-h-tap w-full rounded-xl border border-accent px-4 font-medium text-accent">{L.saveAll(ready.length)}</button>
      )}
      {drafts.length > 0 && (
        <div className="space-y-1">
          <button type="button" onClick={() => void save(drafts)} className="min-h-tap w-full rounded-xl border border-line px-4">{L.saveDrafts(drafts.length)}</button>
          <p className="text-xs text-muted">{L.draftHint}</p>
        </div>
      )}
      <ul className="space-y-2">{cards.map((c) => (
        <CardView key={c.key} c={c} foods={foods} {...(plan ? { plan } : {})} patch={(p) => patch(c.key, p)} onSave={() => void save([c])} onMake={(x) => make(c, x)}
          onRemove={() => update((cs) => cs.filter((x) => x.key !== c.key))} />))}</ul>
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      {asking === 'close' ? (
        <div role="alertdialog" className="space-y-2 rounded-xl bg-warn-bg p-2 text-sm text-warn">
          <p>{L.closeAsk}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setState(null); setAsking(null); onClose(); }} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{L.done}</button>
            <button type="button" onClick={() => setAsking(null)} className="min-h-tap rounded-xl border border-line bg-surface px-3 text-ink">{t.backup.no}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => (cards.some((c) => c.status === 'ready') ? setAsking('close') : (setState(null), onClose()))}
          className="min-h-tap text-sm text-muted underline">{L.done}</button>
      )}
    </section>
  );
}

function CardView({ c, foods, plan, patch, onSave, onRemove, onMake }: { c: Card; foods: Map<string, Food>; plan?: Plan; patch: (p: Partial<Card>) => void;
  onSave: () => void; onRemove: () => void; onMake: (text: string) => void }) {
  const [typed, setTyped] = useState('');
  const per = c.lines.length ? mealNutrients(c.lines.map(lineItem), foods) : null;
  const guessedAmounts = c.lines.filter((l) => !l.amountSaid).length, estimated = c.lines.filter((l) => !l.food).length;
  const ok = sure(c);
  const flags = c.status === 'ready' ? [
    per ? L.perPortion(fmt(per.kcal / c.portions), fmt(per.protein / c.portions)) : '',
    c.ai ? L.ai : L.noAi, !c.fromFile && guessedAmounts ? L.amountGuessed(guessedAmounts) : '', !c.fromFile && estimated ? L.estimated(estimated) : '',
  ].filter(Boolean) : [c.status === 'exists' ? L.exists[c.where ?? 'own'] : c.status === 'waiting' ? L.waiting : c.status === 'draft' ? L.needsMake : c.status === 'saved' ? L.savedMark
    : c.status === 'skipped' ? L.skipped : c.reason ?? ''];
  const badge = c.status === 'ready' ? (ok ? '✓' : '?') : c.status === 'saved' ? '✓' : '';
  const said = `${c.name}${badge === '?' ? ', перевірте' : ''}, ${flags.join(', ')}`; // a screen reader reads the card whole
  return (
    <li data-dish={c.name} data-status={c.status === 'ready' ? (ok ? 'ok' : 'check') : c.status} className="rounded-xl border border-line p-2">
      <button type="button" disabled={c.status !== 'ready'} onClick={() => patch({ open: !c.open })} aria-expanded={!!c.open} aria-label={said}
        className="flex min-h-tap w-full items-start gap-2 text-left">
        <span className={`w-5 shrink-0 font-semibold ${badge === '?' ? 'text-warn' : 'text-accent'}`} aria-hidden>{badge}</span>
        <span className="min-w-0 flex-1" aria-hidden><span className="font-medium">{c.name}</span>
          <span className={`block text-xs ${c.status === 'failed' || c.status === 'later' || c.status === 'draft' ? 'text-warn' : 'text-muted'}`}>{flags.join(' · ')}</span>
          {c.sameName && <span className="block text-xs text-warn">{L.sameName}</span>}</span>
        {c.status === 'ready' && (c.open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />)}
      </button>
      {c.status === 'exists' && c.local && (
        <div className="mt-1 flex gap-2 pl-7">
          <button type="button" onClick={() => patch({ status: 'skipped' })} className="min-h-tap rounded-xl border border-line px-3 text-sm">{L.skip}</button>
          <button type="button" onClick={() => patch({ status: 'ready', lines: c.local!.lines, portions: c.local!.portions })} className="min-h-tap rounded-xl border border-accent px-3 text-sm text-accent">{L.addNew}</button>
        </div>
      )}
      {c.status === 'exists' && !c.local && c.make && (
        <div className="mt-1 flex gap-2 pl-7">
          <button type="button" onClick={() => patch({ status: 'skipped' })} className="min-h-tap rounded-xl border border-line px-3 text-sm">{L.skip}</button>
          <button type="button" onClick={() => patch({ status: 'waiting' })} className="min-h-tap rounded-xl border border-accent px-3 text-sm text-accent">{L.addNew}</button>
        </div>
      )}
      {c.status === 'draft' && (
        <form className="mt-1 flex gap-2 pl-7" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onMake(typed.trim()); }}>
          <label className="min-w-0 flex-1"><span className="sr-only">{L.makeLabel(c.name)}</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={L.makePh} className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3 text-sm" /></label>
          <button type="submit" disabled={!typed.trim()} className="min-h-tap rounded-xl border border-accent px-3 text-sm text-accent disabled:opacity-40">{L.makeOk}</button>
          <button type="button" onClick={onRemove} aria-label={`${L.remove}: ${c.name}`} className="min-h-tap rounded-xl border border-line px-3 text-sm">{L.remove}</button>
        </form>
      )}
      {(c.status === 'failed' || c.status === 'later') && (
        <div className="mt-1 flex gap-2 pl-7">
          {!c.invalid && <button type="button" onClick={() => patch({ status: 'waiting' })} className="min-h-tap rounded-xl border border-accent px-3 text-sm text-accent">{c.status === 'later' ? L.continue : L.retry}</button>}
          <button type="button" onClick={onRemove} className="min-h-tap rounded-xl border border-line px-3 text-sm">{L.remove}</button>
        </div>
      )}
      {c.status === 'notDish' && <button type="button" onClick={onRemove} className="mt-1 ml-7 min-h-tap rounded-xl border border-line px-3 text-sm">{L.remove}</button>}
      {c.status === 'ready' && c.open && (
        <div className="mt-2">
          <BreakdownEditor foods={foods} {...(plan ? { plan } : {})} name={c.name} onName={(name) => patch({ name })} portions={c.portions}
            onPortions={(portions) => patch({ portions })} lines={c.lines} onLines={(lines) => patch({ lines })} {...(c.note ? { note: c.note } : {})}>
            <button type="button" disabled={!c.name.trim() || !c.lines.some((l) => l.grams > 0)} onClick={onSave}
              className="min-h-tap rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{L.saveOne}</button>
          </BreakdownEditor>
        </div>
      )}
    </li>
  );
}
