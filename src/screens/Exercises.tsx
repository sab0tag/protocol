import { SceneHeader } from '../components/SceneHeader';
import { ExerciseLibrary } from '../components/ExerciseLibrary';
import { EXERCISES } from '../data/exercises';
import { usePlan } from '../data/queries';
import { todayISO } from '../domain/dates';
import { allowedExercises, restrictionText } from '../domain/trainingRules';
import { EQUIPMENT } from '../domain/workouts';
import { t } from '../i18n/uk';

/** «Вправи з гирею» (D60): the whole library, by level. */
export function Exercises() {
  const allowed = allowedExercises(EXERCISES, usePlan(), todayISO()); // D178
  return (
    <section className="space-y-3 pt-4">
      <SceneHeader title={t.exercise.library} />
      <p className="text-sm text-muted">{EQUIPMENT}</p>
      <ExerciseLibrary list={allowed.list} limits={{ hidden: allowed.hidden, texts: allowed.limits.map(restrictionText) }} />
    </section>
  );
}
