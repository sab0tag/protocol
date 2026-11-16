import { useEffect, useState } from 'react';
import { useActiveProfile } from '../app/profiles';
import { dailyPhrase, greeting } from '../domain/greeting';

/** Personal encouragement belongs with the profile, keeping the execution screen focused on the plan. */
export function ProfileGreeting() {
  const profile = useActiveProfile();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return <div className="space-y-1 text-sm">
    <p data-testid="greeting" className="font-medium">{greeting(now, profile.name)}</p>
    {profile.motivation !== false && <p data-testid="daily-phrase" className="text-muted">{dailyPhrase(now)}</p>}
  </div>;
}
