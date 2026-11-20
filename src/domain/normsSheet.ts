// D197: the norms for a doctor to check, by specialty — made from norms.ts alone, so the sheet and the app never differ. Shown on
// «Для лікарів і клінік» → «Норми застосунку» (print / PDF, copy) and written to docs/norms/ by `npm run norms:export`.
import { NORMS, normDraft, normsFor, SPECIALTIES, type NormId, type NormMeta, type Specialty } from './norms';

export interface SheetNorm { id: NormId; title: string; says: string; usedIn: string; source: string; note?: string; status: string; draft: boolean }

const sourceLine = (n: NormMeta) => n.source
  ? `${n.source.cite}. Версія: ${n.source.version}.${n.source.url ? ` ${n.source.url}` : ''}`
  : 'Без джерела — наша пропозиція, вирішує лікар.';
const statusLine = (id: NormId, n: NormMeta) => !n.review ? 'Чернетка — ще не перевірено лікарем.'
  : normDraft(id) ? `Перевірено: ${n.review.by}, ${n.review.date}, за версією джерела ${n.review.sourceVersion} — джерело оновилось, потрібна нова перевірка.`
  : `Перевірено: ${n.review.by}, ${n.review.date}, за версією джерела ${n.review.sourceVersion}.`;

export function sheetNorms(s: Specialty): SheetNorm[] {
  return normsFor(s).map((id) => {
    const n: NormMeta = NORMS[id];
    return { id, title: n.title, says: n.says, usedIn: n.usedIn, source: sourceLine(n), ...(n.note ? { note: n.note } : {}), status: statusLine(id, n), draft: normDraft(id) };
  });
}

export const SHEET_INTRO = 'Ці числа застосунок «Протокол» використовує лише тоді, коли лікар не задав свого. Число лікаря завжди головне, і нижче за обмеження лікаря застосунок нічого не пропонує. Поки норму не перевірено, на екрані під нею написано «Чернетка — ще не перевірено лікарем».';

/** The sheet as plain text (Markdown) — for copying into a message or a file. */
export function normsSheet(s: Specialty): string {
  const lines = [`# Норми застосунку «Протокол» на перевірку — ${SPECIALTIES[s]}`, '', SHEET_INTRO, ''];
  sheetNorms(s).forEach((n, i) => {
    lines.push(`## ${i + 1}. ${n.title}`, '', `**Значення.** ${n.says}`, '', `**Де в застосунку.** ${n.usedIn}`, '', `**Джерело.** ${n.source}`, '');
    if (n.note) lines.push(`**Примітка.** ${n.note}`, '');
    lines.push(`**Стан.** ${n.status}`, '', '**Рішення лікаря.** ☐ Погоджую · ☐ Змінити на: ____________ · ПІБ, дата, версія джерела: ____________', '');
  });
  return lines.join('\n');
}
