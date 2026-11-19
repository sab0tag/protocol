// D189: the place of an injection prescribed by the doctor (insulin, GLP-1) — asked once the dose is marked, with last time's
// place as a hint, so the person can move it. Only where the plan's prescription is an injection; never a dose calculator, never
// a catalogue of medicines.
import type { DayEntry, InjectionSite, Prescription } from './types';

// ATC A10A — insulins, A10BJ — GLP-1 agonists; by name for papers without a code; or the words of the prescription itself
const ATC = /^A10A|^A10BJ/;
const NAMES = /інсулін|insulin|лантус|туджео|левемір|новорапід|хумалог|апідра|актрапід|протафан|хумулін|тресіба|фіасп|семаглутид|оземпік|ozempic|вегові|wegovy|ліраглутид|віктоза|victoza|саксенда|saxenda|тирзепатид|мунджаро|mounjaro|дулаглутид|трулісіті|trulicity/iu;
const WORDS = /ін[’']?єкц|п\/ш|підшкірн|шприц[- ]ручк|укол/iu;

export function injectable(p: Pick<Prescription, 'kind' | 'title' | 'dose' | 'med'>): boolean {
  if (p.kind !== 'medication') return false;
  if (p.med?.atc && ATC.test(p.med.atc)) return true;
  return NAMES.test(`${p.title} ${p.med?.name ?? ''} ${p.med?.inn ?? ''}`) || WORDS.test(`${p.title} ${p.dose ?? ''}`);
}

/** The last place for this prescription before `before` (an entry id), if any. */
export function lastSite(entries: readonly DayEntry[], prescriptionId: string, before?: string): InjectionSite | undefined {
  return [...entries].filter((e) => e.kind === 'med' && e.prescriptionId === prescriptionId && e.site && e.id !== before)
    .sort((a, b) => b.at.localeCompare(a.at))[0]?.site;
}

/** Today's marked injections without a place — the newest first. */
export function siteAsked(day: readonly DayEntry[], prescriptions: readonly Prescription[]): DayEntry[] {
  const inj = new Set(prescriptions.filter(injectable).map((p) => p.id));
  return day.filter((e) => e.kind === 'med' && e.status === 'done' && e.prescriptionId && inj.has(e.prescriptionId) && !e.site)
    .sort((a, b) => b.at.localeCompare(a.at));
}
