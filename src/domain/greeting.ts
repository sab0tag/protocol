import { t } from '../i18n/uk';
export function greeting(now: Date, name = ''): string {
  const h = now.getHours();
  const text = h >= 5 && h < 12 ? t.profiles.morning : h >= 12 && h < 18 ? t.profiles.afternoon : h >= 18 && h < 23 ? t.profiles.evening : t.profiles.night;
  return `${text}${name.trim() ? `, ${name.trim()}` : ''}!`;
}
/** Local calendar dates, not elapsed hours: DST and reloads do not change today's phrase. */
export function dailyPhrase(now: Date): string {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return t.profiles.phrases[((day % t.profiles.phrases.length) + t.profiles.phrases.length) % t.profiles.phrases.length]!;
}
