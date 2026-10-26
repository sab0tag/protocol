import { crisisInText, dangerInText } from '../domain/symptoms';
import { CrisisCard } from './CrisisCard';
import { DangerCard } from './DangerCard';

/** Always available; this check has no module/tier dependency and makes no AI request. */
export function TextSafety({ text }: { text: string }) {
  return crisisInText(text) ? <CrisisCard /> : dangerInText(text) ? <DangerCard /> : null;
}
