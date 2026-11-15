/**
 * Acciones de una cuenta (solo admin), cada una con confirmación y resultado:
 * - Restablecer contraseña: POST /admin/users/{id}/reset-password → temporal mostrada una vez.
 * - Desbloquear (si está bloqueada; en modo api el estado no se conoce): POST /admin/users/{id}/unlock.
 * - Cambiar rol en la misión (tripulación): PATCH /admin/assignments/{id} { crew_role }.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { describeError, HttpError } from '../../api/http.ts';
import { changeCrewRole, resetPassword, unlockUser } from '../../api/team.ts';
import type { CrewRole } from '../../api/types.ts';
import { useAuth } from '../../auth/context.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { Modal } from '../../components/Modal.tsx';
import { RoleBadge } from '../../components/RoleBadge.tsx';
import { canDo } from '../../nav/access.ts';
import { CREW_ROLE_INFO, CREW_ROLES } from '../../nav/roles.ts';
import { RoleOption } from './CreateAccountWizard.tsx';
import type { AccountStatus } from './team.ts';

export interface ActionTarget {
  userId: string | null;
  username: string | null;
  /** Cómo se nombra en los textos: indicativo o nombre. */
  label: string;
  /** null = no se conoce (modo api: sin lista de cuentas). */
  status: AccountStatus | null;
  crew?: { assignmentId: string | null; crewRole: CrewRole; callSign: string };
}

type Dialog = 'reset' | 'unlock' | 'role' | null;

const errorText = (err: unknown) =>
  err instanceof HttpError && err.status < 500 && err.status !== 403 ? err.message : describeError(err);

export function AccountActions({
  target,
  takenRoles,
  onDone,
  onTemporaryPassword,
}: {
  target: ActionTarget;
  /** Roles únicos ocupados en la misión → indicativo. */
  takenRoles: ReadonlyMap<CrewRole, string>;
  onDone(message: string): void;
  onTemporaryPassword(result: { username: string; password: string; heading: string }): void;
}) {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [newRole, setNewRole] = useState<CrewRole | ''>('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocument = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    return () => document.removeEventListener('mousedown', onDocument);
  }, [open]);

  const reset = useMutation({
    mutationFn: () => resetPassword(target.userId as string),
    onSuccess: (data) => {
      setDialog(null);
      onTemporaryPassword({
        username: target.username ?? target.label,
        password: data.temporary_password,
        heading: `Contraseña restablecida para ${target.label}. Sus sesiones se cerraron.`,
      });
      reset.reset();
    },
  });
  const unlock = useMutation({
    mutationFn: () => unlockUser(target.userId as string),
    onSuccess: () => {
      setDialog(null);
      onDone(`Cuenta de ${target.label} desbloqueada.`);
    },
  });
  const changeRole = useMutation({
    mutationFn: (crewRole: CrewRole) => changeCrewRole(target.crew?.assignmentId as string, crewRole),
    onSuccess: (data) => {
      setDialog(null);
      onDone(`${target.label} ahora es ${CREW_ROLE_INFO[data.crew_role]?.label ?? data.crew_role}.`);
    },
  });

  const canReset = !!target.userId && canDo(role, 'account.reset_password');
  const canUnlock = !!target.userId && canDo(role, 'account.unlock') && (target.status === 'locked' || target.status === null);
  const canChangeRole = !!target.crew?.assignmentId && canDo(role, 'assignment.change_role');
  if (!canReset && !canUnlock && !canChangeRole) return null;

  function choose(next: Dialog) {
    setOpen(false);
    reset.reset();
    unlock.reset();
    changeRole.reset();
    if (next === 'role') setNewRole(target.crew?.crewRole ?? '');
    setDialog(next);
  }

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="btn btn-ghost btn-small"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Acciones de ${target.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        Acciones <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul
          className="menu-list"
          role="menu"
          aria-label={`Acciones de ${target.label}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          {canReset ? (
            <li role="none">
              <button type="button" role="menuitem" onClick={() => choose('reset')}>
                Restablecer contraseña
              </button>
            </li>
          ) : null}
          {canUnlock ? (
            <li role="none">
              <button type="button" role="menuitem" onClick={() => choose('unlock')}>
                Desbloquear
              </button>
            </li>
          ) : null}
          {canChangeRole ? (
            <li role="none">
              <button type="button" role="menuitem" onClick={() => choose('role')}>
                Cambiar rol en la misión
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {dialog === 'reset' ? (
        <Modal title={`¿Restablecer la contraseña de ${target.label}?`} onClose={() => setDialog(null)}>
          <div className="stack">
            <p>
              Se genera una contraseña temporal (se muestra una sola vez), se pedirá cambiarla en el próximo inicio de
              sesión y se cierran sus sesiones abiertas.
            </p>
            {reset.isError ? <Banner tone="error">{errorText(reset.error)}</Banner> : null}
            <div className="row wizard-actions">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Cancelar
              </Button>
              <Button onClick={() => reset.mutate()} loading={reset.isPending}>
                Sí, restablecer
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {dialog === 'unlock' ? (
        <Modal title={`¿Desbloquear la cuenta de ${target.label}?`} onClose={() => setDialog(null)}>
          <div className="stack">
            <p>Se borran los intentos fallidos y puede volver a iniciar sesión.</p>
            {unlock.isError ? <Banner tone="error">{errorText(unlock.error)}</Banner> : null}
            <div className="row wizard-actions">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Cancelar
              </Button>
              <Button onClick={() => unlock.mutate()} loading={unlock.isPending}>
                Sí, desbloquear
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {dialog === 'role' && target.crew ? (
        <Modal title={`Cambiar rol en la misión · ${target.crew.callSign}`} onClose={() => setDialog(null)} size="lg">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (newRole && newRole !== target.crew?.crewRole && !changeRole.isPending) changeRole.mutate(newRole);
            }}
          >
            <p className="small">
              Rol actual: <RoleBadge crewRole={target.crew.crewRole} plain />. Como máximo un Comandante y un Oficial
              médico por misión.
            </p>
            <fieldset className="stack-tight role-fieldset">
              <legend>Nuevo rol</legend>
              {CREW_ROLES.map((r) => {
                const holder = takenRoles.get(r);
                const takenByOther = !!holder && holder !== target.crew?.callSign;
                return (
                  <RoleOption
                    key={r}
                    name={`new-role-${target.crew?.callSign}`}
                    value={r}
                    checked={newRole === r}
                    disabled={takenByOther}
                    onChange={() => setNewRole(r)}
                    badge={<RoleBadge crewRole={r} plain />}
                    hint={CREW_ROLE_INFO[r].hint}
                    note={takenByOther ? `Ocupado por ${holder}` : r === target.crew?.crewRole ? 'Rol actual' : undefined}
                  />
                );
              })}
            </fieldset>
            {changeRole.isError ? <Banner tone="error">{errorText(changeRole.error)}</Banner> : null}
            <div className="row wizard-actions">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Cancelar
              </Button>
              <Button type="submit" loading={changeRole.isPending} disabled={!newRole || newRole === target.crew.crewRole}>
                Cambiar rol
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
