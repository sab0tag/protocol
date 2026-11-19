import { crisisInText, dangerInText } from '../domain/symptoms';
import { redFlagInText } from '../domain/rehabSafety';
import { CrisisCard } from './CrisisCard';
import { DangerCard } from './DangerCard';

/** Always available; this check has no module/tier dependency and makes no AI request. */
export function TextSafety({ text, injured = false }: { text: string; injured?: boolean }) {
  // D181: with an injury in the plan its red flags are danger signs too
  return crisisInText(text) ? <CrisisCard /> : dangerInText(text) || (injured && redFlagInText(text)) ? <DangerCard /> : null;
}
