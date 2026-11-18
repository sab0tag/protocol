// D159: «Їжа» on «Сьогодні» — Сніданок, Обід, Вечеря and each snack (D161: as many as were eaten, «Додати їжу» adds one). A tile is the meal: tap opens it in place with the field
// focused; a tap on a suggestion or a chip writes the line at once (the person chose it, «Скасувати» in the toast); a phrase,
// the voice or a photo of the plate is a draft written only with «Додати все» (the reading or the AI chose there). Which
// meal and when are never asked: the tile is the meal, the time is «now» or the person's usual time for it.
import { Camera, Check, ChevronDown, Mic, Plus, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../data/db';
import { useFavorites } from '../data/queries';
import { listen, speechSupported, type SpeechError } from '../data/speech';
import { count, countOnce } from '../data/tally';
import { whyFlagged } from '../domain/concierge';
import { atLocal, dateOf, newId, timeOf } from '../domain/dates';
import { evaluate } from '../domain/evaluate';
import { foodPlanStatus } from '../domain/foodPlanStatus';
import { amountText, approxG, itemFor, parseQuery, readMeal, searchFoods, type Candidate, type Recognized } from '../domain/foodSearch';
import { frequentItems } from '../domain/habits';
import { medFoodNotes } from '../domain/medFood';
import { blockKeyFor, hitLabels, mealBlocks, NEW_SNACK, recentSlotDays, sameFood, SLOTS, slotEntries, slotTime, tileState, usualForSlot, withFoodDose, yesterdaySlot, type MealBlock, type Slot, type TileState } from '../domain/mealSlots';
import { mealNutrients, round } from '../domain/nutrition';
import { dishItem, setPortions } from '../domain/recipes';
import type { ItemCheck, RuleHit } from '../domain/rules';
import { crisisInText, dangerInText } from '../domain/symptoms';
import type { DayEntry, Food, MealItem, Plan, Recipe } from '../domain/types';
import { t } from '../i18n/uk';
import { Amount } from './Amount';
import { ConciergeNotFound } from './ConciergeNotFound';
import { CrisisCard } from './CrisisCard';
import { DangerCard } from './DangerCard';
import { MedFoodPanel } from './MedFoodPanel';
import { PhotoStatus, usePlatePhoto } from './PlatePhoto';
import { RecognizedPanel } from './RecognizedPanel';
import { Sheet } from './Sheet';
import { saved } from './Toast';
import { giveVoiceOk, okGiven } from './VoiceSheet';

const L = t.tiles;
const copy = (items: MealItem[]): MealItem[] => JSON.parse(JSON.stringify(items)) as MealItem[];
const names = (items: MealItem[]) => items.map((i) => i.name).join(', ');

export interface MealTilesProps {
  date: string; day: DayEntry[]; all: DayEntry[]; foods: Map<string, Food>; recipes: Recipe[]; plan: Plan | undefined;
  /** a light day, or a day the food module did not observe: no «не записано» */
  quiet: boolean;
  /** the open block's key (`blockKeyFor`, or `e:<id>` for a snack) */
  open: string | null; onOpen: (key: string | null) => void; onConfirm: (planned: DayEntry) => void;
  /** D164: `#/do/food` — the open tile starts the microphone (after the same consent, D95) */
  listen?: boolean;
  /** D162: food said in the one field — a draft for the open tile, written only with «Додати все» */
  draft?: TileDraft | null; onDraftDone?: () => void;
}
export interface TileDraft { rows: Recognized[]; via?: DayEntry['via'] }

export function MealTiles(props: MealTilesProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const { date, day, all, open } = props;
  const [asking, setAsking] = useState(false);
  const blocks = mealBlocks(day, date, open === NEW_SNACK ? atLocal(date, slotTime({ slot: 3, date, now, entries: all })) : undefined);
  return (
    <section aria-labelledby="meal-tiles" className="protocol-card mb-3 px-4 pb-3 pt-2 sm:p-5" data-testid="meal-tiles">
      <div className="mb-1 flex flex-wrap items-center gap-x-3">
        <h2 id="meal-tiles" className="mr-auto text-xl font-semibold">{L.title}</h2>
        {/* ТЗ 17.11, step 2: the day's nutrition left «Ще»; it is reached from the food it sums up */}
        <Link to="/food" className="inline-flex min-h-tap items-center text-sm text-accent underline-offset-4 hover:underline">{t.nutrition.title}</Link>
        <button type="button" aria-expanded={asking} onClick={() => setAsking((v) => !v)}
          className="inline-flex min-h-tap items-center gap-1 rounded-full px-2 font-semibold text-accent"><Plus size={18} aria-hidden />{L.addFood}</button>
      </div>
      {asking && <WhichMeal onPick={(slot) => { setAsking(false); props.onOpen(blockKeyFor(slot)); }} />}
      <ul className="space-y-2">
        {blocks.map((block) => <li key={block.key}><MealTile {...props} block={block} now={now} /></li>)}
      </ul>
    </section>
  );
}

/** D161: «Додати їжу» → which meal → its tile opens (a snack — a new one), and the rest is the tile as usual. D164: the
 *  button sits in the block's heading, so the tiles fit the first screen. */
function WhichMeal({ onPick }: { onPick: (slot: Slot) => void }) {
  return (
    <div role="group" aria-label={L.which} className="mb-2 flex flex-wrap gap-2">
      <p className="w-full text-sm text-muted">{L.which}</p>
      {SLOTS.map((slot) => <button key={slot} type="button" onClick={() => onPick(slot)}
        className="min-h-tap rounded-full border-2 border-line bg-surface px-4 font-semibold">{t.meal.names[slot]}</button>)}
    </div>
  );
}

/** Lines with the record and the place in it they came from. */
interface Line { entry: DayEntry; index: number; item: MealItem }

/** A main meal gathers its records; a snack block is one record (or none yet, when just opened). */
function blockEntries(block: MealBlock, day: DayEntry[], date: string): { done: DayEntry[]; planned: DayEntry[] } {
  if (block.slot !== 3) return slotEntries(day, date, block.slot);
  const e = block.entry;
  return { done: e?.status === 'done' ? [e] : [], planned: e?.status === 'planned' ? [e] : [] };
}

function MealTile({ block, now, date, day, all, foods, recipes, plan, quiet, open, onOpen, onConfirm, listen, draft, onDraftDone }: MealTilesProps & { block: MealBlock; now: Date }) {
  const { slot } = block;
  const name = t.meal.names[slot]!;
  const expanded = open === block.key;
  const { done, planned: menu } = blockEntries(block, day, date);
  const planned = quiet ? [] : menu;
  const lines: Line[] = done.flatMap((entry) => (entry.items ?? []).map((item, index) => ({ entry, index, item })));
  const items = lines.map((l) => l.item);
  const state: TileState = slot !== 3 ? tileState({ slot, date, now, day, light: quiet }) : done.length ? 'recorded' : planned.length ? 'planned' : 'open';
  const dose = withFoodDose({ slot, date, day, plan });
  // R03: the meal against the rest of the day and the week before; the tile's own records are the candidate
  const ids = new Set(done.map((e) => e.id));
  const others = all.filter((e) => !ids.has(e.id));
  const checks: ItemCheck[] = plan && items.length ? evaluate({ plan, date, foods, entries: others, intent: 'recorded', meal: items }).checks : [];
  const labels = hitLabels(checks.flatMap((c) => c.hits));

  const summary = state === 'recorded' ? names(items)
    : state === 'planned' ? L.planned(names(planned.flatMap((e) => e.items ?? []))) : '';
  const headerId = `tile-${block.key.replace(/\W/g, '-')}`;
  // D167: an opened tile comes up to the top of the screen, so its field and all its suggestions are in view
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (expanded) box.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }, [expanded]);
  return (
    <div ref={box} className={`scroll-mt-3 rounded-2xl border ${expanded ? 'border-accent/40 bg-surface' : state === 'missed' || dose ? 'border-line border-dashed bg-surface' : 'border-line bg-surface'}`}
      data-slot={slot} data-state={state}>
      <button type="button" id={headerId} aria-expanded={expanded} onClick={() => onOpen(expanded ? null : block.key)}
        className="flex min-h-tap w-full items-center gap-2 px-3 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className={`font-semibold ${state === 'ahead' && !dose ? 'text-muted' : ''}`}>{name}</span>
          {slot === 3 && block.at && <span className="tabular text-sm text-muted"> {timeOf(block.at)}</span>}
          {dose && state !== 'recorded'
            ? <span className="block text-sm">{L.withFood(dose.title, dose.time, name)}</span>
            : state === 'missed' ? <span className="text-muted"> — {L.notRecorded} · <span className="font-medium text-accent">{L.add}</span></span>
              : summary && <span className={`${state === 'planned' ? 'text-muted' : ''}`}> · {summary}</span>}
          {state === 'recorded' && labels.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{labels.map((x) => <PlanLabel key={x} text={x} />)}</span>}
        </span>
        {state === 'recorded' && !labels.length && plan?.constraints.some((c) => c.active) && foodPlanStatus(checks, foods, plan).state === 'clear'
          && <Check size={18} className="shrink-0 text-accent" aria-label={t.check.fits} />}
        {!expanded && state !== 'recorded' && state !== 'ahead' && <Plus size={18} className="shrink-0 text-accent" aria-hidden />}
        {expanded && <ChevronDown size={18} className="shrink-0 rotate-180 text-muted" aria-hidden />}
      </button>
      {expanded && <TileBody slot={slot} name={name} date={date} lines={lines} planned={planned} checks={checks} all={all} day={day}
        foods={foods} recipes={recipes} plan={plan} onConfirm={onConfirm} onClose={() => onOpen(null)}
        at={block.key === NEW_SNACK ? block.at : undefined} onCreated={slot === 3 ? (id) => onOpen(`e:${id}`) : undefined} listen={!!listen}
        {...(draft ? { draft, onDraftDone } : {})} />}
    </div>
  );
}

function PlanLabel({ text }: { text: string }) {
  return <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn">{text}</span>;
}

function TileBody({ slot, name, date, lines, planned, checks, all, day, foods, recipes, plan, onConfirm, onClose, at, onCreated, listen, draft, onDraftDone }: {
  slot: Slot; name: string; date: string; lines: Line[]; planned: DayEntry[]; checks: ItemCheck[]; all: DayEntry[]; day: DayEntry[];
  foods: Map<string, Food>; recipes: Recipe[]; plan: Plan | undefined; onConfirm: (e: DayEntry) => void; onClose: () => void;
  /** a new snack: the time it was opened with; its first line makes the record, which then is this block */
  at?: string; onCreated?: (id: string) => void; listen?: boolean;
  draft?: TileDraft; onDraftDone?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Line | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listened = useRef(false); // the field holds dictated words: the meal says it came by voice (D119)
  useEffect(() => { input.current?.focus(); }, []);
  const favorites = useFavorites();
  const items = lines.map((l) => l.item);
  // the tile's own records are the candidate meal, never also counted as the rest of the day (R03)
  const others = useMemo(() => { const ids = new Set(lines.map((l) => l.entry.id)); return all.filter((e) => !ids.has(e.id)); }, [all, lines]);
  const frequent = useMemo(() => frequentItems(all, date, 60, 50), [all, date]);
  const usual = useMemo(() => new Set(frequent.map((f) => f.item.recipe?.id ?? f.item.foodId ?? '')), [frequent]);
  const usualGrams = (item: MealItem) => frequent.find((f) => sameFood(f.item, item))?.item.grams; // D164: «Перевірте» on a 3× amount
  const slotUsual = useMemo(() => usualForSlot(all, date, slot, 50), [all, date, slot]);
  const { photo, setPhoto, pick, allow, fileInput } = usePlatePhoto({ foods, recipes, usual });

  // the line goes into the meal's latest record, or a new record at the meal's time — never asked
  const write = async (add: MealItem[], via?: DayEntry['via']) => {
    if (!add.length) return;
    const target = lines.at(-1)?.entry;
    const label = L.added(names(add));
    if (target) {
      const next: DayEntry = { ...target, items: [...(target.items ?? []), ...add], ...(via ? { via } : {}) };
      await saved(db.entries.put(next), label, () => db.entries.put(target));
    } else {
      const entry: DayEntry = { id: newId(), at: at ?? atLocal(date, slotTime({ slot, date, now: new Date(), entries: all })), kind: 'meal', status: 'done',
        title: name, items: add, ...(via ? { via } : {}) };
      await saved(db.entries.add(entry), label, () => db.entries.delete(entry.id));
      onCreated?.(entry.id);
    }
  };
  const pickOne = (item: MealItem) => { setQuery(''); void write([copy([item])[0]!]); input.current?.focus(); };
  const remove = async (line: Line) => {
    const was = line.entry;
    const rest = (was.items ?? []).filter((_, i) => i !== line.index);
    await saved((rest.length ? db.entries.put({ ...was, items: rest }) : db.entries.delete(was.id)).then(() => undefined), L.removed(line.item.name), () => db.entries.put(was));
  };

  const crisis = crisisInText(query); // D130
  const danger = crisis || dangerInText(query);
  const ctx = useMemo(() => ({ foods: [...foods.values()], recipes, dishItem, prefer: usual }), [foods, recipes, usual]);
  const read = useMemo(() => (query.trim() ? readMeal(query, ctx) : null), [query, ctx]);
  const phrase = read && !read.list ? read.rows : null;
  const typed = query.trim().length >= 2;
  // «гр» is also «грам»: a word being typed is searched as the beginning of a name when the reading finds nothing
  const list = read?.list?.length ? read.list : typed && read?.list ? prefix(query, foods, recipes) : [];
  const suggestions = !danger && !phrase && typed ? ordered(list, slotUsual, query).slice(0, 6) : [];
  const hint = (item: MealItem): string[] => plan
    ? hitLabels(evaluate({ plan, date, foods, entries: others, intent: 'proposed', meal: [...items, item] }).checks.at(-1)?.hits ?? []) : [];

  const yesterday = yesterdaySlot(all, date, slot);
  const [otherDay, setOtherDay] = useState(false); // D164: «Як у понеділок» — a long press on «Як учора»
  const pastDays = useMemo(() => (otherDay ? recentSlotDays(all, date, slot) : []), [otherDay, all, date, slot]);
  const chips: { key: string; label: string; aria?: string; items: MealItem[] }[] = [
    ...(yesterday.length ? [{ key: 'y', label: L.yesterday, aria: L.yesterdayItems(names(yesterday)), items: yesterday }] : []),
    ...[...(favorites ?? []).map((f) => ({ key: `f:${f.id}`, label: f.title, items: f.items })),
      ...usualForSlot(all, date, slot, 5, items).map((it) => ({ key: `u:${it.foodId ?? it.recipe?.id ?? it.name}`, label: `${it.name} · ${amountText(it)}`, items: [it] }))].slice(0, 5),
  ];

  const meal = mealNutrients(items, foods);
  const medNotes = plan && items.length ? medFoodNotes(plan.prescriptions, items, foods, { mealAt: lines.at(-1)!.entry.at,
    doses: new Map(plan.prescriptions.map((p) => [p.id, day.filter((e) => e.kind === 'med' && e.status === 'done' && e.prescriptionId === p.id && !e.timeUnknown).map((e) => e.at)])) }) : [];
  return (
    <div className="space-y-3 border-t border-line px-3 pb-3 pt-2">
      {lines.length > 0 && <ul aria-label={name} className="divide-y divide-line">
        {lines.map((l, k) => <SwipeRow key={`${l.entry.id}:${l.index}`} line={l} labels={hitLabels(checks[k]?.hits ?? [])} onTap={() => setEditing(l)} onRemove={() => void remove(l)} />)}
      </ul>}
      {planned.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1 text-muted">{L.planned(names(e.items ?? []))}</span>
          <button type="button" onClick={() => onConfirm(e)} className="min-h-tap rounded-full border-2 border-line px-3 font-semibold">{L.confirm}</button>
        </div>
      ))}

      <TileField autoStart={listen} input={input} listened={listened} name={name} query={query} setQuery={setQuery} onPhoto={pick} photoBusy={photo.state === 'busy'}
        onEnter={() => { const first = suggestions[0]; if (first) pickOne(first.item); }} />
      {fileInput}
      {danger && (crisis ? <CrisisCard className="mt-2" /> : <DangerCard className="mt-2" />) /* D97, D130: the card and nothing else about those words */}

      {!danger && !query.trim() && chips.length > 0 && (
        <div role="group" aria-label={L.suggestions} className="flex flex-wrap gap-2">
          {chips.map((c) => c.key === 'y'
            ? <HoldButton key={c.key} aria-label={c.aria} aria-description={L.otherDayHint} onTap={() => void write(copy(c.items))} onHold={() => setOtherDay(true)}
              className="min-h-tap rounded-full border-2 border-line bg-surface px-3 text-sm font-semibold">{c.label}</HoldButton>
            : <button key={c.key} type="button" aria-label={c.aria} onClick={() => void write(copy(c.items))}
              className="min-h-tap rounded-full border-2 border-line bg-surface px-3 text-sm font-semibold">{c.label}</button>)}
        </div>
      )}
      {otherDay && pastDays.length > 0 && <div role="group" aria-label={L.otherDay} className="space-y-1 rounded-xl border border-line p-2">
        <p className="text-sm text-muted">{L.otherDay}</p>
        {pastDays.map((d) => <button key={d.date} type="button" onClick={() => { setOtherDay(false); void write(copy(d.items)); }}
          className="flex min-h-tap w-full items-baseline gap-2 rounded-lg px-2 text-left">
          <span className="shrink-0 font-semibold">{L.likeDay(L.weekdayAcc[new Date(`${d.date}T12:00:00`).getDay()]!)}</span>
          <span className="min-w-0 truncate text-sm text-muted">{names(d.items)}</span></button>)}
      </div>}

      {suggestions.length > 0 && (
        <ul aria-label={L.suggestions} className="divide-y divide-line rounded-xl border border-line">
          {suggestions.map(({ item, recipe }) => {
            const marks = hint(item);
            return (
              <li key={recipe?.id ?? item.foodId ?? item.name}>
                <button type="button" data-item={item.name} onClick={() => pickOne(item)} className="flex min-h-tap w-full items-center gap-2 px-3 py-1 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block">{recipe && <span className="mr-1 rounded-full bg-accent/10 px-2 text-xs font-medium text-accent">{t.meal.dish}</span>}{item.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-sm text-muted"><span className="tabular mr-1">{amountText(item)}{item.unit || (recipe && !item.recipe?.byGrams) ? ` ≈ ${approxG(item.grams)} г` : ''}</span>
                      {marks.map((x) => <PlanLabel key={x} text={x} />)}</span>
                  </span>
                  {!marks.length && plan?.constraints.some((c) => c.active) && <Check size={16} className="shrink-0 text-accent" aria-label={t.check.fits} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {draft && <RecognizedPanel key={draft.rows.map((r) => r.text).join('|')} title={t.meal.recognized} rows={draft.rows} addLabel={L.addAll} usualGrams={usualGrams}
        onAdd={(picked, missing) => { void write(picked, draft.via); onDraftDone?.(); for (const m of missing) void countOnce('nf', m); }}
        notFound={(text) => <ConciergeNotFound text={text} plan={plan} foods={foods} recipes={recipes} date={date} onAdd={(s) => void write([s.item])} />} />}
      {!danger && phrase && <RecognizedPanel key={query} title={t.meal.recognized} rows={phrase} addLabel={L.addAll} usualGrams={usualGrams}
        onAdd={(picked, missing) => { void write(picked, listened.current ? 'voice' : undefined); setQuery(''); for (const m of missing) void countOnce('nf', m); }}
        notFound={(text) => <ConciergeNotFound text={text} plan={plan} foods={foods} recipes={recipes} date={date} onAdd={(s) => void write([s.item])} />} />}
      {!danger && !phrase && typed && suggestions.length === 0 && (
        <div>
          <p role="status" className="text-sm text-muted">«{query.trim()}» — {t.meal.notFound}</p>
          <ConciergeNotFound key={query.trim()} text={query.trim()} plan={plan} foods={foods} recipes={recipes} date={date}
            onAdd={(s) => { void write([s.item]); setQuery(''); }} />
          <Link to={`/dishes?describe=${encodeURIComponent(query.trim())}`} className="inline-flex min-h-tap items-center text-sm text-accent underline">{t.dishes.breakdown.fromMeal}</Link>
        </div>
      )}
      <PhotoStatus photo={photo} allow={allow} />
      {photo.state === 'done' && photo.rows.length > 0 && <RecognizedPanel title={t.meal.photoTitle} rows={photo.rows} note={photo.note} addLabel={L.addAll} usualGrams={usualGrams}
        onAdd={(picked, missing) => { void write(picked, 'photo'); setPhoto({ state: 'none' }); for (const m of missing) void countOnce('nf', m); }} />}

      {items.length > 0 && <PlanLine checks={checks} foods={foods} plan={plan} kcal={round(meal.kcal)} protein={round(meal.protein)} />}
      <MedFoodPanel notes={medNotes} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/meal/new?slot=${slot}`} className="inline-flex min-h-tap items-center text-sm text-accent underline">{L.more}</Link>
        <button type="button" onClick={onClose} className="min-h-tap rounded-full border-2 border-line px-4 font-semibold">{L.done}</button>
      </div>
      {editing && <EditLine line={editing} foods={foods} onClose={() => setEditing(null)} onRemove={() => { const l = editing; setEditing(null); void remove(l); }} />}
    </div>
  );
}

function prefix(query: string, foods: Map<string, Food>, recipes: Recipe[]): Candidate[] {
  return [...searchFoods(recipes, query, 4).map((r) => ({ item: dishItem(r, 1), recipe: r })),
    ...searchFoods([...foods.values()], query, 8).map((f) => ({ item: itemFor(f, {}), food: f }))];
}

/** Usual for this meal first (with its usual amount, unless an amount was typed), then «Мої страви», then the base. */
function ordered(list: Candidate[], slotUsual: MealItem[], query: string): Candidate[] {
  const typedAmount = parseQuery(query).qty !== undefined;
  const rank = (c: Candidate) => (slotUsual.some((u) => sameFood(u, c.item)) ? 0 : c.recipe ? 1 : 2);
  return list.map((c, i) => ({ c, i, r: rank(c) })).sort((a, b) => a.r - b.r || a.i - b.i).map(({ c, r }) => {
    if (r !== 0 || typedAmount) return c;
    const mine = slotUsual.find((u) => sameFood(u, c.item))!;
    return { ...c, item: copy([mine])[0]! };
  });
}

function TileField({ autoStart, input, listened, name, query, setQuery, onPhoto, photoBusy, onEnter }: {
  autoStart?: boolean; input: RefObject<HTMLInputElement>; listened: { current: boolean }; name: string; query: string; setQuery: (q: string) => void; onPhoto: () => void; photoBusy: boolean; onEnter: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<SpeechError | null>(null);
  const stop = useRef<() => void>(() => undefined);
  useEffect(() => () => stop.current(), []);
  useEffect(() => { if (autoStart && speechSupported()) start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on opening
  const start = () => {
    if (!okGiven()) { setAsk(true); return; }
    setAsk(false); setError(null); setBusy(true);
    stop.current = listen({ interim: setQuery, final: (x) => { listened.current = true; setQuery(x); }, error: setError, end: () => setBusy(false) });
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">{L.field(name)}</span>
          <input ref={input} type="search" value={query} autoComplete="off" placeholder={L.field(name)}
            onChange={(e) => { listened.current = false; setQuery(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
            className="block min-h-tap w-full rounded-full border-2 border-line bg-bg px-4" /></label>
        {speechSupported() && <button type="button" onClick={() => (busy ? stop.current() : start())} aria-label={busy ? L.listening : L.mic}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-surface ${busy ? 'animate-pulse bg-warn' : 'bg-accent'}`}>
          {busy ? <Square size={18} aria-hidden /> : <Mic size={20} aria-hidden />}</button>}
        <button type="button" onClick={onPhoto} disabled={photoBusy} aria-label={L.camera}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-line text-accent disabled:opacity-40"><Camera size={20} aria-hidden /></button>
      </div>
      {ask && <div className="mt-2 space-y-2 rounded-xl border border-line p-2 text-sm">
        <p>{t.voice.consent}</p>
        <button type="button" onClick={() => { giveVoiceOk(); start(); }} className="min-h-tap rounded-full bg-accent px-4 font-semibold text-surface">{t.voice.consentOk}</button>
      </div>}
      {busy && <p role="status" className="mt-1 text-sm text-muted">{L.listening}</p>}
      {error && <p role="alert" className="mt-1 text-sm text-muted">{t.voice.errors[error] ?? t.voice.errors.other}</p>}
    </div>
  );
}

/** One line of the meal: a tap edits it, a swipe to the left takes it out (with «Скасувати»). */
function SwipeRow({ line, labels, onTap, onRemove }: { line: Line; labels: string[]; onTap: () => void; onRemove: () => void }) {
  const [dx, setDx] = useState(0);
  const from = useRef<number | null>(null);
  const moved = useRef(false);
  const down = (e: ReactPointerEvent) => { if (e.pointerType !== 'mouse') { from.current = e.clientX; moved.current = false; } };
  const move = (e: ReactPointerEvent) => {
    if (from.current === null) return;
    const d = Math.min(0, e.clientX - from.current);
    if (d < -8) moved.current = true;
    setDx(d);
  };
  const up = () => {
    if (from.current === null) return;
    from.current = null;
    if (dx < -80) onRemove();
    setDx(0);
  };
  const { item } = line;
  return (
    <li className="relative overflow-hidden">
      <span className="absolute inset-y-0 right-0 flex items-center gap-1 px-3 text-sm font-semibold text-muted" aria-hidden><Trash2 size={16} />{t.tiles.remove}</span>
      <button type="button" onClick={() => { if (!moved.current) onTap(); moved.current = false; }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { from.current = null; setDx(0); }}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }} aria-description={t.tiles.swipeHint}
        className="relative flex min-h-tap w-full items-center gap-2 bg-surface py-1 text-left">
        <span className="min-w-0 flex-1">
          <span className="block">{item.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-sm text-muted"><span className="tabular mr-1">{amountText(item)}</span>
            {labels.map((x) => <PlanLabel key={x} text={x} />)}</span>
        </span>
        <span className="tabular shrink-0 text-xs text-muted">{line.entry.timeUnknown ? '' : timeOf(line.entry.at)}</span>
      </button>
    </li>
  );
}

/** The portion and the time of one line — the time is the record's, shared by the lines written with it. */
function EditLine({ line, foods, onClose, onRemove }: { line: Line; foods: Map<string, Food>; onClose: () => void; onRemove: () => void }) {
  const [item, setItem] = useState<MealItem>(line.item);
  const [time, setTime] = useState(timeOf(line.entry.at));
  const dish = !!item.recipe && !!item.components && !item.recipe.byGrams;
  const save = async () => {
    const was = line.entry;
    const next: DayEntry = { ...was, at: atLocal(dateOf(was.at), time), items: (was.items ?? []).map((x, i) => (i === line.index ? item : x)) };
    onClose();
    await saved(db.entries.put(next), t.toast.saved, () => db.entries.put(was));
  };
  return (
    <Sheet title={`${line.item.name} — ${t.tiles.editLine.toLowerCase()}`} onClose={onClose}>
      <div className="space-y-3">
        {dish
          ? <label className="block"><span className="text-sm text-muted">{t.meal.portions}</span>
              <input type="number" inputMode="decimal" min={0.5} step={0.5} value={item.recipe!.portions}
                onChange={(e) => { const v = Number(e.target.value); if (v >= 0.5) setItem((x) => setPortions(x, v)); }}
                className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
          : <Amount item={item} food={item.foodId ? foods.get(item.foodId) : undefined} onChange={(patch) => setItem((x) => ({ ...x, ...patch }))} />}
        <label className="block"><span className="text-sm text-muted">{t.tiles.time}</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <button type="button" onClick={() => void save()} disabled={!time || item.grams <= 0}
          className="flex min-h-tap w-full items-center justify-center rounded-full bg-ok px-4 font-semibold text-surface disabled:opacity-40">{t.tiles.save}</button>
        <button type="button" onClick={onRemove} className="flex min-h-tap w-full items-center justify-center gap-2 rounded-full border-2 border-line px-4 font-semibold">
          <Trash2 size={18} aria-hidden />{t.tiles.remove}</button>
        <Link to={`/meal/${line.entry.id}`} className="inline-flex min-h-tap items-center text-sm text-accent underline">{t.rowActions.edit}</Link>
      </div>
    </Sheet>
  );
}

/** One line of the check by the plan for this meal, «Чому?» on a tap; calories and protein small beside it. */
function PlanLine({ checks, foods, plan, kcal, protein }: { checks: ItemCheck[]; foods: Map<string, Food>; plan: Plan | undefined; kcal: number; protein: number }) {
  const [why, setWhy] = useState(false);
  const active = plan?.constraints.filter((c) => c.active) ?? [];
  const status = foodPlanStatus(checks, foods, plan);
  const hits: RuleHit[] = checks.flatMap((c) => c.hits.filter((h) => h.verdict !== 'ok'));
  const flagged = checks.find((c) => c.hits.some((h) => h.verdict !== 'ok'));
  const first = flagged?.hits.find((h) => h.verdict !== 'ok');
  const diets = active.filter((c) => c.tag === 'diet' && c.diet).map((c) => c.diet!);
  const text = !active.length ? t.check.noPlan
    : status.state === 'allergen' ? t.meal.planAllergen
      : status.state === 'incomplete' ? t.meal.planIncomplete
        : flagged && first ? t.tiles.attention(first.itemName === flagged.item.name ? flagged.item.name : `${flagged.item.name} (${first.itemName.toLocaleLowerCase('uk')})`, first.message)
          : t.tiles.fits(diets.length === 1 ? diets[0]! : t.tiles.fitsPlan);
  const clear = active.length > 0 && status.state === 'clear';
  return (
    <div data-plan-status={status.state} className={`rounded-xl p-2 text-sm ${clear ? 'bg-ok-bg text-ok' : active.length ? 'bg-warn-bg text-warn' : 'text-muted'}`}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        {clear && <Check size={16} className="shrink-0 self-center" aria-hidden />}
        <span className="font-semibold">{text}</span>
        {plan && active.length > 0 && <button type="button" aria-expanded={why} onClick={() => { if (!why) void count('why'); setWhy((v) => !v); }}
          className="min-h-[2rem] px-1 underline">{t.why.ask}</button>}
        <span className="tabular ml-auto text-xs opacity-80">{t.tiles.totals(kcal, protein)}</span>
      </p>
      {why && plan && <div className="mt-1 space-y-1">
        {hits.map((h, i) => <p key={i}>{whyFlagged(h, plan).text}</p>)}
        <p className="text-xs">{t.meal.planLimit}</p>
        <Link to="/plan" className="underline">{t.why.openPlan}</Link>
      </div>}
    </div>
  );
}

/** A tap does one thing, a long press (or a right click) another — «Як учора» and «Як у понеділок» (D164). */
function HoldButton({ onTap, onHold, children, ...rest }: { onTap: () => void; onHold: () => void; children: ReactNode; className?: string; 'aria-label'?: string; 'aria-description'?: string }) {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const stop = () => window.clearTimeout(timer.current);
  return <button type="button" {...rest} onClick={() => { if (!held.current) onTap(); held.current = false; }}
    onPointerDown={() => { held.current = false; timer.current = window.setTimeout(() => { held.current = true; onHold(); }, 550); }}
    onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={(e) => { e.preventDefault(); stop(); onHold(); }}>{children}</button>;
}
