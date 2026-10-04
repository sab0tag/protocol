// End-to-end encryption for sync (SPEC.md D31). The sync code (128 random bits) is the only secret: from it the
// device derives the vault id, the key that opens the vault on the server, the AES key that encrypts every record
// and the HMAC key that hides which table and row a record is. The server gets none of the last two.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const te = new TextEncoder();
const td = new TextDecoder();

export interface Keys {
  vaultId: string; // 32 hex
  auth: string; // base64url, 43 chars
  enc: CryptoKey;
  mac: CryptoKey;
}

/** «7KQF-3MZD-8RTA-W2PX-91HC-VE4N-6Y»: 26 characters, 4 per group. */
export function newCode(): string {
  return formatCode(crypto.getRandomValues(new Uint8Array(16)));
}

export function formatCode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < 26; i++) { s = ALPHABET[Number(n & 31n)] + s; n >>= 5n; }
  return s.match(/.{1,4}/g)!.join('-');
}

/** The typed or pasted code back to its 16 bytes; undefined if it is not a code. Case, spaces, dashes and the
 *  look-alikes O/0, I/L/1 do not matter. */
export function parseCode(text: string): Uint8Array | undefined {
  const s = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 26) return undefined;
  let n = 0n;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return undefined;
    n = (n << 5n) | BigInt(v);
  }
  if (n >> 128n) return undefined;
  const out = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export function b64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKeys(code: Uint8Array): Promise<Keys> {
  const base = await crypto.subtle.importKey('raw', code as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const p = (info: string): HkdfParams => ({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('protocol-sync-v1'), info: te.encode(info) });
  return {
    vaultId: hex(await crypto.subtle.deriveBits(p('vault'), base, 128)),
    auth: b64url(new Uint8Array(await crypto.subtle.deriveBits(p('auth'), base, 256))),
    enc: await crypto.subtle.deriveKey(p('enc'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    mac: await crypto.subtle.deriveKey(p('mac'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
  };
}

/** The server-side name of a row: HMAC of "table:id" — stable, but says nothing about the row. */
export async function recordKey(keys: Keys, tid: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', keys.mac, te.encode(tid))));
}

/** AES-GCM with a fresh IV; the record key is bound as additional data, so the server cannot swap records. */
export async function seal(keys: Keys, k: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(k) }, keys.enc, te.encode(JSON.stringify(value)));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv); out.set(new Uint8Array(ct), 12);
  return b64(out);
}

export async function open<T>(keys: Keys, k: string, sealed: string): Promise<T> {
  const raw = unb64(sealed);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: te.encode(k) }, keys.enc, raw.slice(12));
  return JSON.parse(td.decode(pt)) as T;
}
