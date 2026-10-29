/** Conservative contact normalization: preserve the local part; never merge identities by address. */
export function address(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 254) return null;
  const v = value.trim();
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(v)) return null;
  const at = v.lastIndexOf('@');
  return v.slice(0, at + 1) + v.slice(at + 1).toLowerCase();
}
