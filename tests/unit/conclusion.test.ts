import { describe, expect, it } from 'vitest';
import { examplePlan } from '../../src/data/seed.example';
import { applyLines, draftLines, dueIn, missing, sourceOf, timesToSet, unfinished, type ConclusionResult, type DraftLine } from '../../src/domain/conclusion';
import type { MedIndex } from '../../src/domain/meds';

let n = 0;
const id = () => `id${++n}`;
const at = (sure: 'yes' | 'check' = 'yes', page = 1, box = [0.1, 0.2, 0.5, 0.05]) => ({ page, box, sure });
const rx = (o: Partial<ConclusionResult['prescriptions'][number]>): ConclusionResult['prescriptions'][number] => ({
  kind: 'medication', title: 'М', dose: '1 таб.', times: [], perDay: null, frequency: null, durationDays: null, asNeeded: false, withFood: null, ...at(), ...o });
const R: ConclusionResult = {
  readable: true, date: '2026-10-12', doctor: 'Ендокринолог', note: null, diagnosis: 'Предіабет', nextVisit: null,
  diet: { said: 'стіл №5', ...at('check') },
  tests: [{ title: 'Глюкоза натще', ...at() }, { title: 'HbA1c', ...at() }],
  constraints: [
    { tag: 'lactose', title: 'Непереносимість лактози', reason: 'Без молока', allergens: [], ...at() },
    { tag: 'allergy', title: 'Алергія на горіхи', reason: '', allergens: ['nuts', 'nonsense'], ...at() },
    { tag: 'allergy', title: 'Алергія невідомо на що', reason: '', allergens: [], ...at() }, // an allergy with no allergen is dropped
    { tag: 'weird', title: 'Менше смаженого', reason: '', allergens: [], ...at() },
  ],
  prescriptions: [
    rx({ kind: 'supplement', title: 'Вітамін D', dose: '2000 МО', times: ['8:00', '08:30', 'вранці'], frequency: '1 раз на день', withFood: true }),
    rx({ title: 'Метформін', dose: '500 мг', perDay: 2, frequency: '2 рази на день', durationDays: 14 }),
    rx({ title: 'Ібупрофен', dose: '200 мг', asNeeded: true, frequency: 'при болю' }),
    rx({ title: 'Каптоприл', dose: null, perDay: 1, ...at('check') }), // the dose not read
    rx({ title: 'Пробіотик', dose: '1 капс.', perDay: null }), // no time and no «how often»
  ],
  targets: [
    { key: 'kcal', value: '1 800', ...at() }, { key: 'proteinG', value: '9000', ...at() }, { key: 'carbsMaxG', value: '150', ...at() },
    { key: 'waterMl', value: '2 л', ...at() }, { key: 'lastMealBy', value: '19.00', ...at() },
  ],
  unread: [{ text: 'Ам…ин 1/2 т', page: 2, box: [0.1, 0.5, 0.3, 0.05] }, { text: ' ', page: 1, box: [] }],
};
const index: MedIndex = { source: '', built: '', list: [
  { name: 'Метформін-Тева', inn: 'Metformin', substance: 'метформін', form: 'таблетки', doses: '500 мг', atc: 'A10BA02', rx: true },
  { name: 'Вітамін Е', inn: 'Tocopherol', substance: 'токоферол', form: 'капсули', doses: '100 мг', atc: 'A11HA03', rx: false }] };
const meds = (ls: DraftLine[]) => ls.flatMap((l) => (l.kind === 'prescription' ? [l] : []));

describe('a doctor’s conclusion → the plan (D80, D101)', () => {
  const lines = draftLines(R, id, { pages: 2, today: '2026-10-19', index });
  it('checks the model’s lines: no invented times, sane numbers, known tags only, the diagnosis not kept', () => {
    expect(sourceOf(R)).toBe('Ендокринолог, 12.10.2026');
    const c = lines.filter((l) => l.kind === 'constraint').map((l) => l.kind === 'constraint' && [l.constraint.tag, l.constraint.diet ?? l.constraint.allergens]);
    expect(c).toEqual([['diet', 'ЩД'], ['lactose', undefined], ['allergy', ['nuts']], ['custom', undefined]]); // «стіл №5» → ЩД, to confirm
    const p = meds(lines).map((l) => l.prescription);
    expect(p[0]).toMatchObject({ title: 'Вітамін D', dose: '2000 МО', schedule: { times: ['08:30'], withFood: true }, notes: '1 раз на день', since: '2026-10-19' });
    expect(p.slice(5).map((x) => [x.kind, x.title])).toEqual([['test', 'Глюкоза натще'], ['test', 'HbA1c']]); // no visit date
    const t = lines.filter((l) => l.kind === 'target').map((l) => l.kind === 'target' && [l.target, l.value]);
    expect(t).toEqual([['kcal', 1800], ['carbsG', { max: 150 }], ['waterMl', 2000], ['lastMealBy', '19:00']]); // protein 9000 g is not a number to keep
    expect(JSON.stringify(lines)).not.toContain('Предіабет');
  });

  it('«2 рази на день» suggests 08:00 and 20:00 and says so; a course ends after its days from the paper’s date; «за потреби» needs no time', () => {
    const [, metf, ibu] = meds(lines);
    expect(metf).toMatchObject({ suggested: true, prescription: { schedule: { times: ['08:00', '20:00'] }, until: '2026-10-25', med: { name: 'Метформін-Тева', atc: 'A10BA02' } } });
    expect(meds(lines)[0]!.suggested).toBeUndefined(); // the time is the doctor's
    expect(meds(lines)[0]!.prescription.med).toBeUndefined(); // «Вітамін D» is not «Вітамін Е»
    expect(ibu!.prescription).toMatchObject({ asNeeded: true });
    expect(ibu!.prescription.schedule).toBeUndefined();
    expect(ibu!.prescription.med).toBeUndefined(); // not in the register — «не з реєстру»
    expect(meds(lines).slice(0, 5).map(missing)).toEqual([undefined, undefined, undefined, 'dose', 'time']);
    const once = meds(draftLines({ ...R, prescriptions: [rx({ title: 'А', perDay: 1, frequency: 'по 1 табл. 1 раз на день ввечері' }),
      rx({ title: 'О', perDay: null, frequency: 'вранці натщесерце — 14 днів' }), rx({ title: 'Н', perDay: 1, frequency: 'на ніч' })] }, id));
    expect(once.slice(0, 3).map((l) => [l.prescription.schedule?.times, l.suggested])).toEqual([[['20:00'], true], [['08:00'], true], [['22:00'], true]]);
  });

  it('✓ only for a line read clearly with its dose; ? otherwise; ✗ for the unread, with the piece of paper it came from', () => {
    expect(meds(lines).slice(0, 4).map((l) => l.status)).toEqual(['sure', 'sure', 'sure', 'check']);
    expect(lines.find((l) => l.kind === 'constraint' && l.constraint.tag === 'diet')!.status).toBe('check');
    const u = lines.filter((l) => l.kind === 'unread');
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ status: 'unread', text: 'Ам…ин 1/2 т', from: { page: 2, box: [0.1, 0.5, 0.3, 0.05] } });
    expect(meds(lines)[0]!.from).toEqual({ page: 1, box: [0.1, 0.2, 0.5, 0.05] });
    const off = draftLines({ ...R, prescriptions: [rx({ page: 3 }), rx({ box: [0.9, 0.9, 0.5, 0.5] })] }, id, { pages: 2 });
    expect(meds(off).slice(0, 2).map((l) => l.from)).toEqual([undefined, { page: 1, box: [0.9, 0.9, expect.closeTo(0.1), expect.closeTo(0.1)] }]); // no page 3; the box kept on the page
  });

  it('puts only the ticked lines in, updating what is already there — never a medicine without its dose or time', () => {
    const plan = examplePlan(new Date('2026-10-17T12:00:00'));
    const picked = lines.filter((l) => l.kind === 'constraint' && l.constraint.tag === 'lactose'
      || l.kind === 'prescription' && ['Вітамін D', 'Каптоприл', 'Пробіотик'].includes(l.prescription.title) || l.kind === 'target' && l.target === 'waterMl');
    const out = applyLines(plan, picked);
    expect(out.constraints).toHaveLength(plan.constraints.length); // the lactose limit updated in place
    expect(out.constraints.find((c) => c.tag === 'lactose')).toMatchObject({ id: 'c-lactose', reason: 'Без молока', source: 'Ендокринолог, 12.10.2026' });
    expect(out.prescriptions.map((p) => p.title)).toEqual(['Вітамін D']);
    expect(out.prescriptions[0]).toMatchObject({ id: 'p-vitd', dose: '2000 МО' });
    expect(out.targets).toMatchObject({ waterMl: 2000, kcal: plan.targets.kcal });
  });
});

describe('the visit and the tests next to it stay two things; a medicine counts from the moment it is put in (D103)', () => {
  it('the visit line keeps its own words; the tests do not take its date', () => {
    const ls = draftLines({ ...R, prescriptions: [], constraints: [], targets: [], diet: null, unread: [],
      tests: [{ title: 'Контроль глюкози та ліпідограми через 3 місяці', ...at() }],
      nextVisit: { date: '2027-01-15', title: 'Повторний огляд ендокринолога', ...at('yes', 1, [0.1, 0.47, 0.5, 0.02]) } }, id);
    expect(ls.map((l) => [l.kind, l.kind === 'checkup' ? [l.date, l.title] : l.kind === 'prescription' ? [l.prescription.kind, l.prescription.title] : null])).toEqual([
      ['checkup', ['2027-01-15', 'Повторний огляд ендокринолога']], ['prescription', ['test', 'Контроль глюкози та ліпідограми через 3 місяці']]]);
    const out = applyLines(examplePlan(new Date('2026-10-17T12:00:00')), ls);
    expect(out.nextCheckup).toEqual({ date: '2027-01-15', tests: ['Повторний огляд ендокринолога'] });
    expect(out.prescriptions.find((p) => p.kind === 'test')?.dueDate).toBe('2027-01-12'); // its own «через 3 місяці» from 12.10 (D104), never the visit’s 15.01
  });
  it('a new medicine gets the moment it was put in; one already in the plan keeps its own start', () => {
    const plan = examplePlan(new Date('2026-10-17T12:00:00'));
    const ls = meds(draftLines(R, id, { today: '2026-10-19' })).filter((l) => ['Вітамін D', 'Метформін'].includes(l.prescription.title));
    const out = applyLines(plan, ls, { since: '2026-10-19', sinceTime: '10:10' });
    expect(out.prescriptions.find((p) => p.title === 'Метформін')).toMatchObject({ since: '2026-10-19', sinceTime: '10:10' });
    const vitd = out.prescriptions.find((p) => p.title === 'Вітамін D')!;
    expect(vitd.since).toBe(plan.prescriptions[0]!.since);
    expect(vitd.sinceTime).toBeUndefined();
  });
});

describe('«через 3 місяці» → a date to take the test, suggested and said so (D104)', () => {
  it('counts from the paper’s date; months, weeks, days, «пів року», «місяць»; nothing without «через»', () => {
    expect(dueIn('Контроль глюкози натще та ліпідограми через 3 місяці', '2026-10-16')).toBe('2027-01-16');
    expect(dueIn('УЗД через місяць', '2026-10-16')).toBe('2026-11-16');
    expect(dueIn('ОАК через 2 тижні', '2026-10-16')).toBe('2026-10-30');
    expect(dueIn('HbA1c через пів року', '2026-10-16')).toBe('2027-04-16');
    expect(dueIn('ТТГ через півтора місяці', '2026-10-16')).toBe('2026-11-30'); // 45 days
    expect(dueIn('Глюкоза натще', '2026-10-16')).toBeUndefined();
    expect(dueIn('через 50 років', '2026-10-16')).toBeUndefined();
    const ls = draftLines({ ...R, prescriptions: [], constraints: [], targets: [], diet: null, unread: [], nextVisit: null,
      tests: [{ title: 'Ліпідограма через 3 місяці', ...at() }, { title: 'HbA1c', ...at() }] }, id, { today: '2026-10-19' });
    expect(meds(ls).map((l) => [l.prescription.dueDate, l.suggestedDate])).toEqual([['2027-01-12', true], [undefined, undefined]]); // from 12.10, the paper’s date
  });
});

describe('medicines older versions kept without a dose or time (D100)', () => {
  it('are asked to be finished — not «за потреби», not a course already over, not tests', () => {
    const p = (o: object) => ({ id: 'x', kind: 'medication' as const, title: 'М', source: '', ...o });
    const list = [p({ title: 'без дози', schedule: { times: ['08:00'] } }), p({ title: 'без часу', dose: '1 таб.' }), p({ title: 'повний', dose: '1', schedule: { times: ['08:00'] } }),
      p({ title: 'за потреби', dose: '1', asNeeded: true }), p({ title: 'закінчився', until: '2026-10-01' }), { ...p({ title: 'аналіз' }), kind: 'test' as const }];
    expect(unfinished(list, '2026-10-19').map((x) => x.title)).toEqual(['без дози', 'без часу']);
  });
});

describe('doses a day still to be timed (D80)', () => {
  const p = (notes: string, times: string[] = []) => ({ id: 'x', kind: 'medication' as const, title: 'М', source: '', notes, ...(times.length ? { schedule: { times } } : {}) });
  it('reads «2 рази на день», «двічі на добу»; nothing once timed or once a day', () => {
    expect(timesToSet(p('2 рази на день, 2 місяці'))).toBe(2);
    expect(timesToSet(p('двічі на добу'))).toBe(2);
    expect(timesToSet(p('3 р. на день'))).toBe(3);
    expect(timesToSet(p('1 раз на день'))).toBeUndefined();
    expect(timesToSet(p('2 рази на день', ['08:00', '20:00']))).toBeUndefined();
  });
});
