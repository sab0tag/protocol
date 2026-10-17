import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { buildChecklist } from '../../src/domain/checklist';
import { dayRhythm } from '../../src/domain/rhythm';
import type { DayEntry } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const DATE = '2026-10-04';
const plan = examplePlan(new Date(`${DATE}T12:00:00`)); // Вітамін D at 08:30, dinner by 20:00
const at = (time: string) => `${DATE}T${time}:00+03:00`;
const rhythm = (entries: DayEntry[]) => dayRhythm({ entries,
  checklist: buildChecklist({ plan, date: DATE, entries, workouts: [], foods, now: new Date(`${DATE}T12:00:00`) }), lastMealBy: plan.targets.lastMealBy });
const shape = (r: ReturnType<typeof dayRhythm>) => r.nodes.map((n) => `${n.at} ${n.kind}${n.kind === 'entry' ? `:${n.entry.title}` : ''}`);

describe('«Ритм дня» (D53)', () => {
  it('a day without records still shows the plan: the dose, the dinner deadline; the workout is its tile, not a line here (D78)', () => {
    const r = rhythm([]);
    expect(shape(r)).toEqual(['08:30 dose', '20:00 deadline']);
    expect(r.anytime).toEqual([]);
  });

  it('records join the line by time; water stays off it; a marked dose is its entry, not a plan node', () => {
    const r = rhythm([
      { id: 'b', at: at('08:40'), kind: 'meal', status: 'done', title: 'Сніданок', items: [] },
      { id: 'w', at: at('09:00'), kind: 'water', status: 'done', title: 'Вода', waterMl: 250 },
      { id: 'd', at: at('08:30'), kind: 'med', status: 'done', title: 'Вітамін D', checkKey: 'med:p-vitd:08:30' },
      { id: 'l', at: at('13:30'), kind: 'meal', status: 'planned', title: 'Обід', items: [], menu: {} },
    ]);
    expect(shape(r)).toEqual(['08:30 entry:Вітамін D', '08:40 entry:Сніданок', '13:30 entry:Обід', '20:00 deadline']);
  });
});
