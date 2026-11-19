// D174 (Soniox, PR 3): «Ще → Налаштування → Голос». The choice «Телефон» / «Soniox» shows only when the server gives this
// device a key (a choice of «Телефон» is never overridden). The test ID — a hash, not a secret — is shown always, so the
// owner can read it out for the server's test list (SPEECH_TEST_VAULTS).
import { useEffect, useState } from 'react';
import { refreshSpeech, setVoiceEngineChoice, speechServer, voiceEngineChoice } from '../data/speech';
import { t } from '../i18n/uk';

const L = t.voiceSettings;

export function VoiceSettings() {
  const [server, setServer] = useState(speechServer());
  const [choice, setChoice] = useState(voiceEngineChoice());
  useEffect(() => { void refreshSpeech().then(setServer); }, []);
  const pick = (v: 'phone' | 'soniox') => { setVoiceEngineChoice(v); setChoice(v); };
  return (
    <section aria-labelledby="voice-settings" className="protocol-card space-y-3 p-4" data-testid="voice-settings">
      <h2 id="voice-settings" className="text-lg font-semibold">{L.title}</h2>
      {server?.available ? <>
        <div role="radiogroup" aria-label={L.title} className="flex flex-wrap gap-2">
          {(['phone', 'soniox'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={choice === v} onClick={() => pick(v)}
              className={`min-h-tap rounded-full border-2 px-4 font-semibold ${choice === v ? 'border-accent text-accent' : 'border-line'}`}>{L[v]}</button>))}
        </div>
        <p className="text-sm text-muted">{choice === 'soniox' ? L.sonioxHint : L.phoneHint}</p>
      </> : <p className="text-sm text-muted">{L.phoneOnly}</p>}
      <p className="text-sm">{L.testId}: {server?.id ? <span className="tabular font-semibold" data-testid="voice-test-id">{server.id}</span> : <span className="text-muted">{L.noId}</span>}</p>
    </section>
  );
}
