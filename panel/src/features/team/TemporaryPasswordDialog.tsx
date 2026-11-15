/**
 * Contraseña temporal (alta o restablecimiento): se muestra UNA sola vez. Al cerrar, quien abre
 * el diálogo descarta el valor (y el resultado de la mutación): ya no se puede volver a ver.
 */
import { useState } from 'react';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { Modal } from '../../components/Modal.tsx';

export const ONE_TIME_NOTICE = 'No se volverá a mostrar. Se pedirá cambiarla en el primer inicio de sesión.';

export function TemporaryPasswordDialog({
  username,
  password,
  heading,
  onClose,
}: {
  username: string;
  password: string;
  heading: string;
  onClose(): void;
}) {
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopy('done');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <Modal title="Contraseña temporal" onClose={onClose} closeOnEscape={false}>
      <div className="stack">
        <p>{heading}</p>
        <div className="temp-password">
          <span className="muted small">
            Usuario <code>{username}</code>
          </span>
          <code className="temp-password-value" aria-label="Contraseña temporal">
            {password}
          </code>
        </div>
        <div className="row">
          <Button variant="secondary" onClick={() => void onCopy()}>
            Copiar
          </Button>
          <span className="small" aria-live="polite">
            {copy === 'done' ? '✓ Copiada' : copy === 'failed' ? 'No se pudo copiar: selecciónala y cópiala a mano.' : ''}
          </span>
        </div>
        <Banner tone="warning">{ONE_TIME_NOTICE}</Banner>
        <div>
          <Button onClick={onClose}>Entendido, cerrar</Button>
        </div>
      </div>
    </Modal>
  );
}
