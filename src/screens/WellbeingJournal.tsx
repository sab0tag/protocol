import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { Link, useNavigate } from 'react-router-dom';
import { Loading } from '../components/Recovery';
import { useAllWellbeing } from '../data/queries';
import { useUi } from '../store/ui';
import { t } from '../i18n/uk';
import { todayISO } from '../domain/dates';

export function WellbeingJournal() {
  const records = useAllWellbeing();
  const setDate = useUi((state) => state.setDate);
  const navigate = useNavigate();
  if (!records) return <Loading />;

  const ordered = [...records].sort((a, b) => b.date.localeCompare(a.date));
  const openRecord = (date: string) => {
    setDate(date);
    navigate('/wellbeing');
  };
  const addToday = () => {
    setDate(todayISO());
    navigate('/wellbeing');
  };

  return (
    <section className="space-y-4 pt-4">
      <header className="protocol-scene-header flex items-center justify-between gap-3">
        <div>
          <Link to="/wellbeing" className="inline-flex min-h-tap items-center text-sm text-muted">{t.well.title}</Link>
          <h1 className="text-2xl font-semibold">{t.well.journal}</h1>
          <p className="text-sm text-muted">{t.well.journalHint}</p>
        </div>
        <button type="button" onClick={addToday} className="flex min-h-tap shrink-0 items-center rounded-xl bg-accent px-3 font-medium text-surface">
          {t.well.addToday}
        </button>
      </header>
      {ordered.length === 0
        ? <p className="protocol-card rounded-2xl border border-line bg-surface p-4 text-muted">{t.well.noJournal}</p>
        : <ul className="divide-y divide-line overflow-hidden protocol-card rounded-2xl border border-line bg-surface">
          {ordered.map((record) => (
            <li key={record.date}>
              <button type="button" onClick={() => openRecord(record.date)}
                className="min-h-tap w-full px-3 py-3 text-left">
                <span className="block font-medium first-letter:uppercase">
                  {format(parseISO(record.date), 'EEEE, d MMMM yyyy', { locale: uk })}
                </span>
                <span className="mt-1 block text-sm text-muted">
                  {[record.energy != null && `${t.well.energy}: ${record.energy}/5`,
                    record.mood != null && `${t.well.mood}: ${record.mood}/5`,
                    record.sleep != null && `${t.well.sleep}: ${record.sleep}/5`].filter(Boolean).join(' · ')}
                </span>
                {record.symptoms.length > 0 && <span className="mt-1 block text-sm">{record.symptoms.join(' · ')}</span>}
                {record.note && <span className="mt-1 block text-sm text-muted">{record.note}</span>}
              </button>
            </li>
          ))}
        </ul>}
    </section>
  );
}
