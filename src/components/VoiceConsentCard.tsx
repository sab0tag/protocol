// D174 (Soniox, PR 3): the consent the first tap of a microphone asks — Soniox's own, or the phone's engine (D95). «Так»
// starts the recording from this very tap, so the audio is made inside the gesture (iPhone keeps it silent otherwise).
import { giveVoiceConsent, type VoiceConsent } from '../data/speech';
import { t } from '../i18n/uk';

export function VoiceConsentCard({ kind, onYes, className = '' }: { kind: Exclude<VoiceConsent, 'ok'>; onYes: () => void; className?: string }) {
  return (
    <div role="group" aria-label={t.voice.consentTitle} className={`space-y-2 text-sm ${className}`} data-testid={`voice-consent-${kind}`}>
      <p>{kind === 'soniox' ? t.voice.sonioxConsent : t.voice.consent}</p>
      <button type="button" onClick={() => { giveVoiceConsent(kind); onYes(); }} className="min-h-tap rounded-full bg-accent px-4 font-semibold text-on-accent">
        {kind === 'soniox' ? t.voice.sonioxOk : t.voice.consentOk}</button>
    </div>
  );
}
