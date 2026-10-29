// P3 (аудит, «поиск упражнений»), D153: the library searched by the words a person would use — the name, or the movement
// («присід», «жим», «тяга», «прес»…). Every word of the query must start a word of the exercise; case, apostrophes and
// «е/є», «и/і» typed either way do not matter. Pure.
import type { Exercise, Pattern } from '../data/exercises';

/** The words a movement goes by. */
export const PATTERN_WORDS: Record<Pattern, string> = {
  squat: 'присід ноги стегна', hinge: 'тяга нахил сідниці стегна спина мах', push: 'жим руки груди плечі',
  pull: 'тяга спина руки', carry: 'перенесення прогулянка хват', core: 'прес корпус стабільність', getup: 'підйом',
};

const norm = (s: string) => s.toLowerCase().replace(/[’'`ʼ]/g, '').replace(/є/g, 'е').replace(/і|ї/g, 'и').replace(/ё/g, 'е');
const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function searchExercises(list: readonly Exercise[], query: string): Exercise[] {
  const q = words(query);
  if (!q.length) return [...list];
  return list.filter((e) => {
    const own = words(`${e.name} ${PATTERN_WORDS[e.pattern]}`);
    return q.every((w) => own.some((x) => x.startsWith(w)));
  });
}
