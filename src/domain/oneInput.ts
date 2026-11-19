// D162: «Скажіть або напишіть…» — one field on «Сьогодні» instead of «Записати їжу», «Сказати голосом», «Помічник» and
// «Швидкі дії». Not a chat: the code decides what a phrase is, and nothing is written by itself except water (with
// «Скасувати»). Order: danger and crisis words (no model, ever) → a question (it is never taken for a command or for food:
// «чи можна метформін?» must not become a tick) → commands: a light day, an edit of the last card, a medicine of today's
// plan (only after «Так»), water → food (readMeal, through the voice reading) → nothing. Pure: the corpus
// tests/fixtures/one-input.yaml runs through this function.
import { doctorQuestion } from './doctorQuestions';
import { redFlagInText } from './rehabSafety';
import { spokenForm } from './spokenForm';
import { withoutStop } from './foodSearch';
import { fold } from './meds';
import { normalize } from './nutrition';
import { crisisInText, dangerInText } from './symptoms';
import { command, emptyDraft, lightDayCommand, readUtterance, waterOf, type Ask, type VoiceContext, type VoiceDraft } from './voice';

/** A dose of today's plan: its checklist key, its name and other names (trade name, INN), its time. */
export interface DueMed { key: string; title: string; time?: string; prescriptionId?: string; aliases?: string[] }

export interface OneInputContext extends Omit<VoiceContext, 'meds'> {
  /** today's doses still to mark (the checklist's open med items) */
  meds: DueMed[];
  /** today's doses already marked — «випив метформін» again is said so, not marked twice */
  taken: DueMed[];
  /** «HH:mm», for «випив таблетку» — the doses of the nearest time */
  now: string;
  /** the «assistant» module: off — a question never leaves the phone */
  assistant: boolean;
  /** the draft of the card still on screen, for «прибери курку», «не два, а три яйця» */
  card?: VoiceDraft;
  /** D181: the plan has an injury (a rehab complex or a limit for training) — its red flags bring the 103 card too */
  injured?: boolean;
}

export type OneInput =
  | { kind: 'empty' }
  | { kind: 'crisis' }
  | { kind: 'danger' }
  | { kind: 'question'; text: string }
  | { kind: 'doctor-question'; text: string }
  | { kind: 'assistant-off'; text: string }
  | { kind: 'light-day' }
  | { kind: 'undo' }
  | { kind: 'edit'; draft: VoiceDraft; note?: string; ask?: Ask }
  | { kind: 'no-card' }
  | { kind: 'meds'; meds: DueMed[] }
  | { kind: 'which-med'; options: DueMed[] }
  | { kind: 'med-done'; titles: string[] }
  | { kind: 'med-unknown'; text: string }
  | { kind: 'water'; ml: number }
  | { kind: 'food'; draft: VoiceDraft };

// D175: a point between digits stays — «0.5 л води»
const clean = (s: string) => normalize(withoutStop(s)).replace(/(?<!\d)[.,]+|[.,]+(?!\d)|[!;:]+/gu, ' ').replace(/\s+/gu, ' ').trim();

// ------------------------------------------------------------------ a question
const ASK_WORD = /^(?:що|чи|можна|порадь|порадьте|підкажи|підкажіть)(?=\s|$)/u;
export const isQuestion = (text: string) => /\?/u.test(text) || ASK_WORD.test(clean(text));

// ------------------------------------------------------------------ medicines
const GENERIC = /(?:^|\s)(таблетк\S*|пігулк\S*|ліки|капсул\S*)(?=\s|$)/u;
const SINGULAR = /(?:^|\s)(?:таблетку|таблетка|пігулку|пігулка|капсулу|капсула)(?=\s|$)/u;
const PERIOD: [RegExp, (time: string) => boolean][] = [
  [/(?:^|\s)ранков\S*|(?:^|\s)зранку|(?:^|\s)вранці/u, (x) => x < '12:00'],
  [/(?:^|\s)(?:обідн|денн)\S*|(?:^|\s)вдень/u, (x) => x >= '12:00' && x < '17:00'],
  [/(?:^|\s)вечірн\S*|(?:^|\s)ввечері|(?:^|\s)на\s+ніч|(?:^|\s)нічн\S*/u, (x) => x >= '17:00'],
];
const VERB_WORDS = /(?:^|\s)(?:я|вже|щойно|прийняв|прийняла|прийняли|прийнято|випив|випила|випили|випито|таблетк\S*|пігулк\S*|капсул\S*|ліки|ранков\S*|вечірн\S*|обідн\S*|денн\S*|зранку|вранці|вдень|ввечері|на|ніч|нічн\S*|свої|мої|усі|всі)(?=\s|$)/gu;

/** The medicines a phrase names — by its own words, folded («еналаприл» ~ «Еналаприл-Здоров’я»). */
function namedMeds(text: string, list: DueMed[]): DueMed[] {
  const said = fold(text).split(' ').filter((w) => w.length >= 3);
  return list.filter((m) => [m.title, ...(m.aliases ?? [])].some((name) => {
    const ws = fold(name).split(' ').filter((w) => w.length >= 4);
    return ws.length > 0 && ws.some((w) => said.some((x) => x === w || (x.length >= 4 && (w.startsWith(x) || x.startsWith(w.slice(0, -1))))));
  }));
}

/** The doses due nearest now: those at the earliest open time not more than an hour ahead, else the earliest open ones. */
function nearest(meds: DueMed[], now: string): DueMed[] {
  const timed = meds.filter((m) => m.time).sort((a, b) => a.time!.localeCompare(b.time!));
  const soon = timed.filter((m) => m.time! <= addHour(now));
  const pick = (soon.length ? soon : timed)[0]?.time;
  return pick ? timed.filter((m) => m.time === pick) : [];
}
const addHour = (t: string) => { const [h, m] = t.split(':').map(Number); return `${String(Math.min(23, h! + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

function medsOf(text: string, ctx: OneInputContext): OneInput | null {
  const s = clean(text);
  const named = namedMeds(s, ctx.meds);
  if (named.length) return { kind: 'meds', meds: named };
  const done = namedMeds(s, ctx.taken);
  if (done.length) return { kind: 'med-done', titles: done.map((m) => m.title) };
  const generic = GENERIC.test(s);
  if (!generic) {
    // «прийняв но-шпу»: «прийняв» is said of medicines only — never read as food; «випив кефір» is food
    return /(?:^|\s)(?:прийняв|прийняла|прийняли|прийнято)(?=\s|$)/u.test(s) && s.replace(VERB_WORDS, ' ').trim() ? { kind: 'med-unknown', text: text.trim() } : null;
  }
  const rest = s.replace(VERB_WORDS, ' ').trim();
  if (rest) return { kind: 'med-unknown', text: text.trim() }; // «випив таблетку від голови» — not a dose of the plan
  const period = PERIOD.find(([re]) => re.test(s));
  const group = period ? ctx.meds.filter((m) => m.time && period[1](m.time)) : nearest(ctx.meds, ctx.now);
  if (!group.length) return ctx.taken.length ? { kind: 'med-done', titles: ctx.taken.map((m) => m.title) } : { kind: 'med-unknown', text: text.trim() };
  if (group.length > 1 && SINGULAR.test(s) && !period) return { kind: 'which-med', options: group };
  return { kind: 'meds', meds: group };
}

// ------------------------------------------------------------------ water
const WATER_ONLY = /(?:^|\s)(?:ще|я|випив|випила|випили|склянк\S*|склянок|стакан\S*|чашк\S*|вод[аиуі]|мл|л|літр\S*|пів|півтори|одну|одна|один|дві|два|три|чотири|п[’']?ять|\d+(?:[.,]\d+)?)(?=\s|$)/gu;
/** Water and nothing else: «склянка води», «ще дві склянки», «300 мл». «Вода з лимоном» or «склянка кефіру» is food. */
export function waterCommand(text: string): number | undefined {
  const s = clean(text);
  if (!s || s.replace(WATER_ONLY, ' ').trim()) return undefined;
  if (!/(?:^|\s)(?:вод[аиуі]|склянк\S*|склянок|стакан\S*|мл|л|літр\S*)(?=\s|$)/u.test(s)) return undefined;
  return waterOf(/(?:^|\s)вод[аиуі](?=\s|$)/u.test(s) ? s : `${s} води`);
}

// ------------------------------------------------------------------ edits of the card on screen
const UNDO = /^(?:скасуй|скасувати|відміни|відмінити|поверни)(?:\s+(?:останнє|останню|останній|це|назад))?$/u;
const REMOVE = /^(?:прибери|прибрати|видали|видалити|забери|забрати)\s/u;
const EDIT_START = /^(?:прибери|прибрати|видали|видалити|забери|забрати|замість|не\s|зроби|зробити|постав|хай\s+буде|нехай\s+буде|має\s+бути|без\s|додай|додати|ще\s)/u;

export function readOneInput(text: string, ctx: OneInputContext): OneInput {
  const raw = text.trim();
  if (!withoutStop(raw)) return { kind: 'empty' };
  if (crisisInText(raw)) return { kind: 'crisis' }; // D130: first, and the model is never called
  if (dangerInText(raw)) return { kind: 'danger' }; // D97
  if (ctx.injured && redFlagInText(raw)) return { kind: 'danger' }; // D181: a red flag with a cast or after an operation
  const toDoctor = doctorQuestion(raw); // D191: «запитати лікаря, …» — for the doctor's list, never the assistant
  if (toDoctor) return { kind: 'doctor-question', text: toDoctor };
  if (isQuestion(raw)) return ctx.assistant ? { kind: 'question', text: raw } : { kind: 'assistant-off', text: raw };
  if (lightDayCommand(raw)) return { kind: 'light-day' }; // D139
  return readSaid(spokenForm(raw), ctx);
}

/** D175: the rest reads the words in the form the reading takes (numbers in digits, the Russian words of food) */
function readSaid(raw: string, ctx: OneInputContext): OneInput {
  const s = clean(raw);
  if (UNDO.test(s)) return { kind: 'undo' };
  if (ctx.card && EDIT_START.test(s) && waterCommand(raw) === undefined) { // D107: a command on the card still on screen
    const done = command(withoutStop(raw), ctx.card, { ...ctx, meds: [] });
    if (done && !done.undo && !done.clear) return { kind: 'edit', draft: done.d, ...(done.note ? { note: done.note } : {}), ...(done.ask ? { ask: done.ask } : {}) };
  }
  if (!ctx.card && REMOVE.test(s)) return { kind: 'no-card' }; // «прибери курку» with nothing on screen: said so, never food «не знайдено»
  const med = medsOf(raw, ctx);
  if (med) return med;
  const water = waterCommand(raw);
  if (water !== undefined) return { kind: 'water', ml: water };
  const draft = readUtterance(raw, { ...ctx, meds: [] }, emptyDraft());
  return { kind: 'food', draft };
}
