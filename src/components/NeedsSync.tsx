// D78: a feature that goes through our server says so with a way on — «Увімкнути синхронізацію», and back here after.
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../i18n/uk';

export function NeedsSync({ text, back }: { text: string; back?: string }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{text}</p>
      <button type="button" onClick={() => navigate(`/sync?back=${encodeURIComponent(back ?? pathname + search)}`)}
        className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{t.menu.enableSync}</button>
    </div>
  );
}
