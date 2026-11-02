import { describe, expect, it } from 'vitest';
import { adherenceResolved, adherenceState, completedLate } from '../../src/domain/adherence';
import { buildChecklist } from '../../src/domain/checklist';
import type { DayEntry, Plan } from '../../src/domain/types';

const entry = (status: DayEntry['status'], adherence?: DayEntry['adherence']): DayEntry => ({
  id: 'dose',
  at: '2026-10-28T08:45:00+02:00',
  kind: 'med',
  status,
  ...(adherence ? { adherence } : {}),
  title: 'Вітамін D',
});

describe('adherence states', () => {
  it('projects legacy completed records and distinguishes new outcomes', () => {
    expect(adherenceState(entry('done'))).toBe('completed');
    expect(adherenceState(entry('done', 'completed_late'))).toBe('completed_late');
    expect(adherenceState({ ...entry('done'), checkKey: 'med:med:08:30' })).toBe('completed_late');
    expect(adherenceState({ ...entry('done'), checkKey: 'med:med:08:30', timeUnknown: true })).toBe('completed');
    expect(adherenceState(entry('skipped'))).toBe('skipped');
    expect(adherenceState(entry('planned', 'uncertain'))).toBe('uncertain');
    expect(adherenceState(entry('planned'))).toBe('no_data');
    expect(adherenceState(undefined)).toBe('no_data');
  });

  it('does not infer late completion from the time a record was entered', () => {
    expect(completedLate('09:00', '08:30')).toBe(true);
    expect(completedLate('08:30', '08:30')).toBe(false);
    expect(completedLate('08:00', '08:30')).toBe(false);
    expect(completedLate(undefined, '08:30')).toBe(false);
  });

  it('considers uncertainty resolved for reminders without counting it as completion', () => {
    const uncertain = entry('planned', 'uncertain');
    expect(adherenceResolved(uncertain)).toBe(true);
    expect(adherenceState(uncertain)).not.toBe('completed');
    expect(adherenceResolved(entry('planned'))).toBe(false);
  });

  it('builds a distinct due-dose state for uncertainty and keeps it out of completion totals', () => {
    const plan: Plan = { constraints: [], targets: {}, modes: [],
      prescriptions: [{ id: 'med', kind: 'medication', title: 'Вітамін D', source: 'Тест', schedule: { times: ['08:30'] } }] };
    const uncertain = { ...entry('planned', 'uncertain'), checkKey: 'med:med:08:30', prescriptionId: 'med' };
    const result = buildChecklist({ plan, date: '2026-10-28', entries: [uncertain], workouts: [], foods: new Map(),
      now: new Date('2026-10-28T09:00:00') });
    expect(result.items[0]).toMatchObject({ adherence: 'uncertain', uncertain: true, done: false });
    expect(result.done).toBe(0);
  });
});
