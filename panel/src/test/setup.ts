import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// React Router crea un Request de Node (undici) con el AbortSignal de jsdom, y undici lo
// rechaza. En las pruebas el Request de navegación no necesita la señal: se le quita.
const NodeRequest = globalThis.Request;
class TestRequest extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init ? { ...init, signal: undefined } : init);
  }
}
globalThis.Request = TestRequest as typeof Request;
