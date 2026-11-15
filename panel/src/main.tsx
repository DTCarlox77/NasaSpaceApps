import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/global.css';
import { checkConfig, ConfigError } from './config/env.ts';
import App from './App.tsx';
import { ConfigProblem } from './pages/ConfigProblem.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Falta el elemento #root en index.html');

let configError: string | null = null;
try {
  checkConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  configError = err.message;
}

createRoot(root).render(
  <StrictMode>{configError ? <ConfigProblem message={configError} /> : <App />}</StrictMode>,
);
