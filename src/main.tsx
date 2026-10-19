import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { ensureSeeded, inDemo, requestPersistence } from './data/db';
import { startSync } from './sync/runner';
import { useUi } from './store/ui';
import { Boot, ErrorBoundary, watchResume } from './components/Recovery';
import './styles/index.css';

// A tab left open for days (a computer) never navigates, so the browser never looks for a new version and the old
// code keeps syncing with a vault it no longer understands. Look again whenever the app comes back to the screen;
// `autoUpdate` reloads the page once the new version is in.
// D106: while the new version downloads, the old page stays — a reload by hand in those seconds shows the old one again,
// so the person is told it is coming (the analyst reloaded twice, not knowing the page would do it itself).
const updating = () => { if (navigator.serviceWorker.controller) useUi.setState({ updating: true }); };
registerSW({
  immediate: true,
  onRegisteredSW: (_url, reg) => {
    if (!reg) return;
    if (reg.installing) updating();
    reg.addEventListener('updatefound', updating);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
    });
  },
});
void requestPersistence();
watchResume(); // D42
const start = () => ensureSeeded().then(() => { if (!inDemo()) void startSync(); }); // D98: the example never syncs
createRoot(document.getElementById('root')!).render(
  <StrictMode><ErrorBoundary><Boot start={start}><App /></Boot></ErrorBoundary></StrictMode>,
);
