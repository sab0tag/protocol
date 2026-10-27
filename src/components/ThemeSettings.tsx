import { useEffect, useState } from 'react';
import { applyThemePreference, readThemePreference, saveThemePreference, type ThemePreference } from '../store/theme';
import { t } from '../i18n/uk';

const L = t.theme;

export function ThemeSettings() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [error, setError] = useState('');
  const dark = preference === 'dark' || (preference === 'system' && systemDark);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const set = (next: ThemePreference) => {
    setError('');
    try {
      saveThemePreference(next);
    } catch {
      applyThemePreference(next);
      setError(L.saveFailed);
    }
    setPreference(next);
  };

  return (
    <section aria-labelledby="theme-settings-heading" className="protocol-card rounded-2xl border border-line bg-surface p-4">
      <h2 id="theme-settings-heading" className="font-semibold">{L.appearance}</h2>
      <label className="protocol-toggle-row mt-2">
        <span>{L.dark}</span>
        <input type="checkbox" className="protocol-switch" checked={dark} aria-label={L.dark}
          onChange={(event) => set(event.target.checked ? 'dark' : 'light')} />
      </label>
      <p className="text-sm text-muted">{L.systemHint}</p>
      {preference !== 'system' && <button type="button" className="mt-2 min-h-tap text-sm font-medium text-accent underline" onClick={() => set('system')}>{L.system}</button>}
      {error && <p role="alert" className="mt-2 text-sm text-warn">{error}</p>}
    </section>
  );
}
