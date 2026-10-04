import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { ensureSeeded, requestPersistence } from './data/db';
import './styles/index.css';

registerSW({ immediate: true });
void requestPersistence();
void ensureSeeded().then(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
});
