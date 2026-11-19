// D175 (Soniox, PR 4): the experiment's measure. The main metric is not word accuracy but «the same would be written»:
// readOneInput(recognised) gives the same outcome as readOneInput(reference). A wrong word in «вівсянки» without
// consequences does not matter; «2000» instead of «200» does. One fixed context for every phrase (the corpus' own plan),
// so a run on any phone is judged the same way. Pure functions — the dev page, the unit test and scripts/speech-report.ts.
import { FOODS } from '../data/foods';
import { RECIPES } from '../data/recipes';
import { amountText } from './foodSearch';
import { normalize } from './nutrition';
import { spokenForm } from './spokenForm';
import { readOneInput, type DueMed, type OneInput, type OneInputContext } from './oneInput';
import { dishItem } from './recipes';
import { emptyDraft, type VoiceDraft } from './voice';

export type CorpusGroup = 'food-uk' | 'food-ru' | 'meds' | 'water' | 'commands' | 'questions';
export interface CorpusPhrase {
  id: string; group: CorpusGroup;
  /** the reference text — what the person reads aloud */
  say: string;
  /** the draft on screen for a command («не два, а три яйця») */
  card?: string;
  /** the same words as an engine may write them (digits, punctuation, capitals, Latin letters): must read the same */
  forms?: string[];
  expect: { kind: OneInput['kind']; meds?: string[]; water_ml?: number; items?: string[] };
}

const med = (id: string, title: string, time: string, aliases?: string[]): DueMed => ({ key: `med:${id}:${time}`, title, time, prescriptionId: id, ...(aliases ? { aliases } : {}) });
/** The corpus' plan: 08:30, the morning doses still open. Never a real person's plan — it is the same on every phone. */
export const CORPUS_CONTEXT: OneInputContext = {
  foods: FOODS, recipes: RECIPES, dishItem, prescriptions: [], yesterday: [], now: '08:30', assistant: true,
  meds: [med('met', 'Метформін', '08:00', ['Сіофор']), med('ena', 'Еналаприл', '08:00'), med('vitd', 'Вітамін D', '08:00'),
    med('ome', 'Омепразол', '08:00'), med('ator', 'Аторвастатин', '20:00')],
  taken: [],
};

export function readPhrase(text: string, card?: string): OneInput {
  if (!card) return readOneInput(text, CORPUS_CONTEXT);
  const on = readOneInput(card, CORPUS_CONTEXT); // the card as the field made it from the earlier words
  return readOneInput(text, { ...CORPUS_CONTEXT, card: on.kind === 'food' ? on.draft : emptyDraft() });
}

const draftLines = (d: VoiceDraft) => [
  ...d.items.map((x) => (x.item.unit && x.sure ? `${x.item.name} ${amountText(x.item)}` : x.item.name)),
  ...d.notFound.map((x) => `? ${x}`), ...(d.waterMl ? [`вода ${d.waterMl} мл`] : []),
];
/** What would be written (or shown to confirm) — the comparable part of a reading; the free text of a question is not. */
export function outcome(r: OneInput): string[] {
  switch (r.kind) {
    case 'meds': return [r.kind, ...r.meds.map((m) => m.title)];
    case 'which-med': return [r.kind, ...r.options.map((m) => m.title)];
    case 'med-done': return [r.kind, ...r.titles];
    case 'water': return [r.kind, `${r.ml} мл`];
    case 'food': case 'edit': return [r.kind, ...draftLines(r.draft)];
    default: return [r.kind];
  }
}

const SMALL: Record<string, number> = {
  пів: 0.5, півтори: 1.5, півтора: 1.5, один: 1, одна: 1, одне: 1, одну: 1, два: 2, дві: 2, две: 2, три: 3, чотири: 4, четыре: 4,
  пять: 5, шість: 6, шесть: 6, сім: 7, семь: 7, вісім: 8, восемь: 8, девять: 9, поллитра: 0.5,
};
/** The numbers said, as numbers: «дві тисячі», «2 000» and «2000» are the same, «двісті» and «2000» are not. */
export function spokenNumbers(text: string): number[] {
  return (normalize(spokenForm(text)).match(/\d+(?:\.\d+)?|\p{L}+/gu) ?? [])
    .map((w) => (/^\d/.test(w) ? Number(w) : SMALL[w])).filter((n): n is number => n !== undefined);
}

const COMMANDS = new Set<OneInput['kind']>(['undo', 'edit', 'light-day', 'no-card']);
const titles = (o: string[]) => (o[0] === 'meds' || o[0] === 'which-med' || o[0] === 'med-done' ? o.slice(1).join('|') : '');

export interface Verdict { same: boolean; dangerous: ('number' | 'medicine' | 'command' | 'danger-card')[] }
/** «The same would be written», and what makes a difference dangerous: another number, another medicine, another command,
 *  a danger card lost or gained. An empty result is not compared here — it is a lost phrase. */
export function judge(phrase: CorpusPhrase, recognised: string): Verdict {
  const want = readPhrase(phrase.say, phrase.card), got = readPhrase(recognised, phrase.card);
  const a = outcome(want), b = outcome(got);
  const sameOutcome = a.join('\n') === b.join('\n');
  const dangerous: Verdict['dangerous'] = [];
  const nums = (t: string) => spokenNumbers(t).sort((x, y) => x - y).join(',');
  // a dose's number is not written (the plan's dose is marked), yet «200» heard for «2000» on a medicine is dangerous
  const doses = a[0] === 'meds' || b[0] === 'meds';
  if ((!sameOutcome || doses) && nums(phrase.say) !== nums(recognised)) dangerous.push('number');
  if (!sameOutcome) {
    if (titles(a) !== titles(b) && (titles(a) || titles(b))) dangerous.push('medicine');
    if ((COMMANDS.has(want.kind) || COMMANDS.has(got.kind)) && want.kind !== got.kind) dangerous.push('command');
    const card = (k: OneInput['kind']) => k === 'danger' || k === 'crisis';
    if (card(want.kind) !== card(got.kind)) dangerous.push('danger-card');
  }
  return { same: sameOutcome && !dangerous.length, dangerous };
}

// ------------------------------------------------------------------ runs and the report
export type Engine = 'soniox' | 'browser';
/** One recording on the dev page: text and times only — never sound. */
export interface SpeechRun {
  phrase: string; engine: Engine; platform: string; speaker: string; condition: string;
  /** the final text, or '' when none came */
  text: string; error?: string;
  startedAt: number; lastWordAt?: number; finalAt?: number; endedAt: number;
  /** Soniox: how long its socket was open (what is billed) */
  socketMs?: number;
}
export interface EngineReport {
  engine: Engine; platform: string; runs: number; matchPct: number | null; dangerous: number; lost: number;
  latencyMedianMs: number | null; latencyWorstMs: number | null; socketSecondsPerPhrase: number | null;
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export function report(runs: SpeechRun[], corpus: CorpusPhrase[]): EngineReport[] {
  const byId = new Map(corpus.map((p) => [p.id, p]));
  const groups = new Map<string, SpeechRun[]>();
  for (const r of runs) { if (!byId.has(r.phrase)) continue; const k = `${r.engine}\n${r.platform}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, rs]) => {
    const [engine, platform] = k.split('\n') as [Engine, string];
    const heard = rs.filter((r) => r.text.trim());
    const verdicts = heard.map((r) => judge(byId.get(r.phrase)!, r.text));
    const lat = heard.filter((r) => r.finalAt !== undefined && r.lastWordAt !== undefined).map((r) => Math.max(0, r.finalAt! - r.lastWordAt!));
    const sockets = rs.filter((r) => r.socketMs !== undefined).map((r) => r.socketMs!);
    return {
      engine, platform, runs: rs.length,
      // a lost phrase counts as not the same: the measure is «would it be written», over every recording
      matchPct: rs.length ? Math.round((verdicts.filter((v) => v.same).length / rs.length) * 1000) / 10 : null,
      dangerous: verdicts.filter((v) => v.dangerous.length).length,
      lost: rs.length - heard.length,
      latencyMedianMs: median(lat), latencyWorstMs: lat.length ? Math.max(...lat) : null,
      socketSecondsPerPhrase: sockets.length ? Math.round((sockets.reduce((a, b) => a + b, 0) / sockets.length) / 100) / 10 : null,
    };
  });
}

/** The rule fixed before the run (ТЗ Soniox, «Правило решения»), per platform: Soniox by default if it matches ≥ 90 %,
 *  has no more dangerous errors than the phone's engine, and its median latency is ≤ 1.5 s. */
export function decide(rows: EngineReport[]): { platform: string; soniox: boolean; why: string }[] {
  const platforms = [...new Set(rows.map((r) => r.platform))].sort();
  return platforms.map((platform) => {
    const s = rows.find((r) => r.platform === platform && r.engine === 'soniox'), b = rows.find((r) => r.platform === platform && r.engine === 'browser');
    if (!s || !b) return { platform, soniox: false, why: 'немає прогону обох рушіїв' };
    const fails = [
      ...((s.matchPct ?? 0) >= 90 ? [] : [`збіг ${s.matchPct ?? 0} % < 90 %`]),
      ...(s.dangerous <= b.dangerous ? [] : [`небезпечних ${s.dangerous} > ${b.dangerous}`]),
      ...(s.latencyMedianMs !== null && s.latencyMedianMs <= 1500 ? [] : [`медіана затримки ${s.latencyMedianMs ?? '—'} мс > 1500`]),
    ];
    return { platform, soniox: !fails.length, why: fails.length ? fails.join('; ') : 'усі три умови виконано' };
  });
}
