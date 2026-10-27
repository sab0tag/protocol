import { useSyncExternalStore } from 'react';
import { activeProfile, readProfiles } from '../data/profiles';
const subscribe = (listener: () => void) => {
  window.addEventListener('protocol-profiles-changed', listener);
  return () => window.removeEventListener('protocol-profiles-changed', listener);
};
// A primitive snapshot is stable between writes, including the initial unnamed profile.
const snapshot = () => JSON.stringify(readProfiles());
export function useProfileDirectory() {
  useSyncExternalStore(subscribe, snapshot);
  return readProfiles();
}
export function useActiveProfile() {
  useProfileDirectory();
  return activeProfile();
}
