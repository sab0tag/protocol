import { ExerciseLibrary } from '../components/ExerciseLibrary';
import { EQUIPMENT } from '../domain/workouts';
import { t } from '../i18n/uk';

/** «Вправи з гирею» (D60): the whole library, by level. */
export function Exercises() {
  return (
    <section className="space-y-3 pt-4">
      <h1 className="text-2xl font-semibold">{t.exercise.library}</h1>
      <p className="text-sm text-muted">{EQUIPMENT}</p>
      <ExerciseLibrary />
    </section>
  );
}
