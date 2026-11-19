import { beforeEach, describe, expect, it, vi } from 'vitest';

// D174 (Soniox, PR 3): which consent the first mic tap asks, the «Голос» choice, and that a recording started by itself never
// goes to Soniox. The server's answer and the engines are stubs.
const state = vi.hoisted(() => ({ available: true }));
const soniox = vi.hoisted(() => vi.fn((_on: unknown, _b: string[], _o: unknown) => () => undefined));
vi.mock('../../src/sync/api', () => ({ speechState: async () => ({ available: state.available, id: 'abc123', engine: 'soniox-test' }), speechKey: vi.fn() }));
vi.mock('../../src/sync/runner', () => ({ currentKeys: () => null }));
vi.mock('../../src/data/speechSoniox', () => ({ listenSoniox: soniox }));

const S = await import('../../src/data/speech');

const handlers = () => ({ interim: vi.fn(), final: vi.fn(), error: vi.fn(), end: vi.fn() });

beforeEach(async () => { localStorage.clear(); soniox.mockClear(); state.available = true; await S.refreshSpeech(); });

describe('the consent the first tap asks', () => {
  it('Soniox offered: its own consent, even when the phone’s (D95) was given', () => {
    localStorage.setItem('protocol.voice.ok', '1');
    expect(S.voiceConsent()).toBe('soniox');
    S.giveVoiceConsent('soniox');
    expect(S.voiceConsent()).toBe('ok');
  });

  it('the server gives no key: the phone’s consent (D95), as before', async () => {
    state.available = false; await S.refreshSpeech();
    expect(S.voiceConsent()).toBe('browser');
    S.giveVoiceConsent('browser');
    expect(S.voiceConsent()).toBe('ok');
    expect(localStorage.getItem(S.SONIOX_CONSENT)).toBeNull(); // the D95 «yes» says nothing about Soniox
  });

  it('«Телефон» chosen: never Soniox, whatever the server says', () => {
    S.giveVoiceConsent('soniox');
    S.setVoiceEngineChoice('phone');
    expect(S.voiceEngineChoice()).toBe('phone');
    expect(S.sonioxReady()).toBe(false);
    expect(S.voiceConsent()).toBe('browser');
  });
});

describe('which engine listens', () => {
  it('a tap with the Soniox consent — Soniox; the meal it gives carries the engine', () => {
    S.giveVoiceConsent('soniox');
    const on = handlers();
    S.listen(on);
    expect(soniox).toHaveBeenCalledOnce();
    (soniox.mock.calls[0]![0] as { final: (t: string, h: string) => void }).final('два яйця', 'два яйця');
    expect(on.final).toHaveBeenCalledWith('два яйця', 'два яйця');
    expect(S.voiceMark()).toEqual({ voiceEngine: 'soniox' });
  });

  it('started by itself (no tap) — never Soniox: iPhone keeps audio made without a gesture silent', () => {
    S.giveVoiceConsent('soniox');
    S.listen(handlers(), [], { tap: false });
    expect(soniox).not.toHaveBeenCalled();
  });

  it('no Soniox consent — the phone’s engine', () => {
    S.listen(handlers());
    expect(soniox).not.toHaveBeenCalled();
  });
});
