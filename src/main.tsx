import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { ensureSeeded, requestPersistence } from './data/db';
import { startSync } from './sync/runner';
import { Boot, ErrorBoundary, watchResume } from './components/Recovery';
import './styles/index.css';

registerSW({ immediate: true });
void requestPersistence();
watchResume(); // D42
const start = () => ensureSeeded().then(() => { void startSync(); });
createRoot(document.getElementById('root')!).render(
  <StrictMode><ErrorBoundary><Boot start={start}><App /></Boot></ErrorBoundary></StrictMode>,
);
