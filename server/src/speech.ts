// «ТЗ: подключение и адаптация Soniox», PR 1 (D172): the server only hands the phone a short-lived Soniox key; the sound goes
// from the phone straight to Soniox and never through us. The main key (SONIOX_API_KEY) stays in the server's .env and is
// never in a response, a log or an error text. Off unless SPEECH_ENGINE says otherwise; without the key — off.
import { createHash } from 'node:crypto';

export type SpeechEngine = 'browser' | 'soniox-test' | 'soniox';

export interface SpeechConfig {
  engine: SpeechEngine;
  /** soniox-test: the hashes (speechId) of the vaults and devices allowed a key; everyone else stays on the phone's own engine */
  testIds: ReadonlySet<string>;
  /** a separate monthly ceiling for voice, micro-USD (SPEECH_MONTH_USD, $5 to start) */
  monthUsdMicro: number;
  model: string;
  /** the temporary key's life, seconds (60–120 per the spec) */
  ttlS: number;
}

/** Each key is charged as the worst case: 60 s of an open stream at $0.12 an hour. */
export const SPEECH_KEY_USD_MICRO = 2_000;
export const SPEECH_MAX_SECONDS = 60;

export class SpeechUpstream extends Error {
  readonly status: number;
  constructor(status: number) { super(`soniox ${status}`); this.status = status; }
}

/** What the logs, the test list and the settings screen use to name a vault or a device: a hash, never the id or a token. */
export const speechId = (who: string) => createHash('sha256').update(`speech:${who}`).digest('hex').slice(0, 12);

export function speechConfig(env: Record<string, string | undefined>): SpeechConfig | undefined {
  if (!env.SONIOX_API_KEY) return undefined;
  const raw = env.SPEECH_ENGINE ?? 'browser';
  if (raw !== 'browser' && raw !== 'soniox-test' && raw !== 'soniox') throw new Error('SPEECH_ENGINE must be browser, soniox-test or soniox');
  const month = Number(env.SPEECH_MONTH_USD ?? 5);
  const ttl = Number(env.SPEECH_KEY_TTL_S ?? 90);
  if (!Number.isFinite(month) || month < 0) throw new Error('SPEECH_MONTH_USD must be a number of dollars');
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 120) throw new Error('SPEECH_KEY_TTL_S must be 60–120');
  return { engine: raw, testIds: new Set((env.SPEECH_TEST_VAULTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
    monthUsdMicro: Math.round(month * 1_000_000), model: env.SPEECH_MODEL ?? 'stt-rt-v6', ttlS: ttl };
}

export interface SpeechKeys { issue: (ttlS: number) => Promise<{ key: string; expiresAt: string }> }

/** Soniox REST «temporary API key» (checked 18.11 against the live API): usage `transcribe_websocket`, 201 {api_key, expires_at}. */
export function sonioxKeys(apiKey: string, fetchImpl: typeof fetch = fetch): SpeechKeys {
  return {
    issue: async (ttlS) => {
      let res: Response;
      try {
        res = await fetchImpl('https://api.soniox.com/v1/auth/temporary-api-key', { method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: ttlS }), signal: AbortSignal.timeout(8_000) });
      } catch { throw new SpeechUpstream(0); }
      if (!res.ok) throw new SpeechUpstream(res.status);
      const d = await res.json().catch(() => null) as { api_key?: unknown; expires_at?: unknown } | null;
      if (typeof d?.api_key !== 'string' || !d.api_key || typeof d.expires_at !== 'string') throw new SpeechUpstream(502);
      return { key: d.api_key, expiresAt: d.expires_at };
    },
  };
}
