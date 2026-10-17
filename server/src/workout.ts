// A kettlebell session for the person's level (SPEC.md D63). Claude picks only exercise ids from the list the app
// sends (an enum in the output schema) — the levels the person chose — with sets and reps or seconds, and one short
// piece of advice from their own records. The app checks every line against its library and shows a draft; nothing is
// written until the person records the workout. Like the menu: the doctor decides, the model only helps to do it.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

export interface WorkoutInput {
  exercises: { id: string; name: string; level: number; pattern: string; unilateral: boolean; timed: boolean }[];
  history: { date: string; feeling: string; items: string[] }[]; // «Гоблет-присід: 10 · 10 · 9»
  rules: string[]; // the doctor's limits in words
  equipment: string;
  minutes: number;
  wish: string;
}

export function workoutSchema(ids: [string, ...string[]]) {
  return z.object({
    exercises: z.array(z.object({
      id: z.enum(ids),
      sets: z.number().describe('Підходів, 1–5'),
      reps: z.number().nullable().describe('Повторів у підході (на кожну руку/ногу для однобічних); null для вправ на час'),
      seconds: z.number().nullable().describe('Секунд у підході для вправ на час, інакше null'),
    })),
    advice: z.string().describe('1–2 речення: що з записів видно і на що звернути увагу сьогодні'),
  });
}

export type WorkoutResult = z.infer<ReturnType<typeof workoutSchema>>;
export type WorkoutMaker = (input: WorkoutInput) => Promise<{ result: WorkoutResult | 'refused'; usage?: Usage }>;

const SYSTEM = `Ти складаєш тренування з гирею на сьогодні для людини, яка виконує план свого лікаря. Лікар вирішує — ти лише допомагаєш.
Усе, що бачитиме людина (поради, примітки), пиши українською і звертайся на «ви».
Бери лише вправи зі списку, за id. 4–6 вправ, що разом покривають присід, нахил (тяга/махи), жим, тягу і корпус; вкладись у вказаний час разом із відпочинком.
Спирайся на записи людини: що вийшло легко — трохи додай (+1–2 повтори або складніший варіант того самого руху), що було важко — залиш як є. Після «Щось боліло» нічого не додавай і обери легші варіанти.
Однобічні вправи — повтори на кожну руку чи ногу. Для вправ на час — секунди, повтори null.
Порада — коротка, по-людськи, з опорою на цифри із записів; без медичних порад, без діагнозів, не змінюй обмежень лікаря.`;

export function claudeWorkout(opts: { model: string; effort: Effort; client?: Anthropic }): WorkoutMaker {
  const client = opts.client ?? new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return async (input) => {
    const ids = [...new Set(input.exercises.map((e) => e.id))] as [string, ...string[]]; // an enum must not repeat
    const lines = [
      `Інвентар: ${input.equipment}. Час: до ${input.minutes} хв.`,
      `Вправи (id — назва, рівень 1–3, тип руху, однобічна, на час):\n${input.exercises.map((e) =>
        `- ${e.id} — ${e.name}, рівень ${e.level}, ${e.pattern}${e.unilateral ? ', однобічна' : ''}${e.timed ? ', на час' : ''}`).join('\n')}`,
      `Останні тренування:\n${input.history.map((h) => `- ${h.date} (${h.feeling || 'без оцінки'}): ${h.items.join('; ')}`).join('\n') || '- ще немає'}`,
      `Обмеження лікаря:\n${input.rules.map((r) => `- ${r}`).join('\n') || '- немає'}`,
      input.wish ? `Побажання на сьогодні: ${input.wish}` : '',
    ].filter(Boolean);
    return structured(client, { model: opts.model, effort: opts.effort, maxTokens: 4000, system: SYSTEM, schema: workoutSchema(ids), content: lines.join('\n\n') });
  };
}
