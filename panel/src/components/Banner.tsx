import type { ReactNode } from 'react';

type Tone = 'info' | 'warning' | 'error' | 'success';

// El tono nunca depende solo del color: cada aviso lleva un ícono de texto.
const ICONS: Record<Tone, string> = { info: 'i', warning: '!', error: '×', success: '✓' };

export function Banner({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  // Los errores y advertencias se anuncian de inmediato a los lectores de pantalla.
  const role = tone === 'error' || tone === 'warning' ? 'alert' : 'status';
  return (
    <div className={`banner banner-${tone}`} role={role}>
      <span className="banner-icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div>{children}</div>
    </div>
  );
}
