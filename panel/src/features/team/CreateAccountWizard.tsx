/**
 * Alta guiada (solo admin): POST /admin/users en 3 pasos con indicador de progreso.
 * 1. Datos: nombre, indicativo (tripulación, en mayúsculas) y usuario sugerido (editable).
 * 2. Rol: tripulación → rol en la misión (la misión vigente se asigna sola); Tierra → rol global.
 * 3. Confirmación: resumen con las etiquetas y "Crear cuenta".
 * Las validaciones adelantan los 409 del contrato (USERNAME_TAKEN, CALL_SIGN_TAKEN,
 * CREW_ROLE_TAKEN); si el backend responde otra cosa, se muestra junto al campo que corresponde.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { describeError, HttpError } from '../../api/http.ts';
import { createUser, errorField } from '../../api/team.ts';
import type { CreateUserRequest, CrewRole } from '../../api/types.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { Field } from '../../components/Field.tsx';
import { Modal } from '../../components/Modal.tsx';
import { RoleBadge } from '../../components/RoleBadge.tsx';
import { CREW_ROLE_INFO, CREW_ROLES, GLOBAL_ROLE_INFO, GROUND_ACCOUNT_ROLES } from '../../nav/roles.ts';
import {
  normalizeCallSign,
  suggestUsername,
  takenCrewRoles,
  validateDetails,
  validateRole,
  type AccountDraft,
  type CrewRow,
  type DraftErrors,
  type TeamKind,
} from './team.ts';

const STEPS = ['Datos', 'Rol', 'Confirmación'] as const;

export interface CreatedAccount {
  username: string;
  temporaryPassword: string;
  /** "ORION · Comandante" o "Cirujano de vuelo". */
  description: string;
}

function StepIndicator({ step }: { step: number }) {
  return (
    <>
      <ol className="wizard-steps" aria-label="Progreso del alta">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? 'done' : n === step ? 'current' : 'todo';
          return (
            <li key={label} className={`wizard-step wizard-step-${state}`} aria-current={n === step ? 'step' : undefined}>
              <span className="wizard-step-n" aria-hidden="true">
                {state === 'done' ? '✓' : n}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        Paso {step} de {STEPS.length}: {STEPS[step - 1]}
      </p>
    </>
  );
}

function RoleOption({
  name,
  value,
  checked,
  disabled,
  onChange,
  badge,
  hint,
  note,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange(): void;
  badge: ReactNode;
  hint: string;
  note?: string;
}) {
  return (
    <label className={`role-option${checked ? ' selected' : ''}${disabled ? ' disabled' : ''}`}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="role-option-body">
        {badge}
        <span className="small">{hint}</span>
        {note ? <span className="small role-option-note">{note}</span> : null}
      </span>
    </label>
  );
}

export function CreateAccountWizard({
  kind,
  missionId,
  missionCode,
  crewRows,
  knownUsernames,
  onCancel,
  onCreated,
}: {
  kind: TeamKind;
  missionId: string;
  missionCode: string;
  crewRows: CrewRow[];
  /** Usuarios conocidos (modo demo); null en modo api: lo valida el backend (409). */
  knownUsernames: ReadonlySet<string> | null;
  onCancel(): void;
  onCreated(account: CreatedAccount): void;
}) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<AccountDraft>({
    kind,
    full_name: '',
    username: '',
    call_sign: '',
    crew_role: '',
    role: '',
  });
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const callSigns = new Set(crewRows.map((r) => r.call_sign.toUpperCase()));
  const taken = takenCrewRoles(crewRows);

  const mutation = useMutation({
    mutationFn: (body: CreateUserRequest) => createUser(body),
    onSuccess: (data) => {
      const description =
        kind === 'crew'
          ? `${draft.call_sign} · ${CREW_ROLE_INFO[draft.crew_role as CrewRole]?.label ?? draft.crew_role}`
          : (GLOBAL_ROLE_INFO[draft.role as keyof typeof GLOBAL_ROLE_INFO]?.label ?? draft.role);
      onCreated({ username: data.user.username, temporaryPassword: data.temporary_password, description });
      // La contraseña no queda guardada en la caché de mutaciones.
      mutation.reset();
    },
    onError: (err) => {
      const field = errorField(err);
      const message = err instanceof HttpError ? err.message : describeError(err);
      if (field === 'username' || field === 'call_sign' || field === 'email') {
        setErrors({ [field === 'email' ? 'username' : field]: message });
        setStep(1);
      } else if (field === 'crew_role') {
        setErrors({ crew_role: message });
        setStep(2);
      } else {
        setGeneral(err instanceof HttpError && err.status < 500 ? message : describeError(err));
      }
    },
  });

  const set = (patch: Partial<AccountDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function next(event: FormEvent) {
    event.preventDefault();
    setGeneral(null);
    if (step === 1) {
      const found = validateDetails(draft, knownUsernames, callSigns);
      setErrors(found);
      if (Object.keys(found).length === 0) setStep(2);
      return;
    }
    if (step === 2) {
      const found = validateRole(draft, taken);
      setErrors(found);
      if (Object.keys(found).length === 0) setStep(3);
      return;
    }
    if (mutation.isPending) return;
    const body: CreateUserRequest =
      kind === 'crew'
        ? {
            username: draft.username,
            full_name: draft.full_name.trim(),
            role: 'astronaut',
            astronaut: { call_sign: draft.call_sign, mission_id: missionId, crew_role: draft.crew_role as CrewRole },
          }
        : {
            username: draft.username,
            full_name: draft.full_name.trim(),
            role: draft.role as CreateUserRequest['role'],
            ground_mission_ids: [missionId],
          };
    mutation.mutate(body);
  }

  const title = kind === 'crew' ? `Agregar a la tripulación · ${missionCode}` : 'Agregar al equipo en Tierra';

  return (
    <Modal title={title} onClose={onCancel} size="lg">
      <form className="stack" onSubmit={next} noValidate>
        <StepIndicator step={step} />

        {step === 1 ? (
          <div className="stack">
            <Field
              label="Nombre completo"
              value={draft.full_name}
              autoComplete="off"
              error={errors.full_name}
              onChange={(e) => {
                const fullName = e.target.value;
                set({ full_name: fullName, ...(usernameEdited ? {} : { username: suggestUsername(fullName) }) });
              }}
            />
            {kind === 'crew' ? (
              <Field
                label="Indicativo"
                value={draft.call_sign}
                autoComplete="off"
                hint="En mayúsculas y único en la misión (2 a 20), p. ej. NOVA."
                error={errors.call_sign}
                onChange={(e) => set({ call_sign: normalizeCallSign(e.target.value) })}
              />
            ) : null}
            <Field
              label="Usuario"
              value={draft.username}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              hint="Sugerido: inicial del nombre + apellido. Puedes cambiarlo."
              error={errors.username}
              onChange={(e) => {
                setUsernameEdited(true);
                set({ username: e.target.value.toLowerCase().trim() });
              }}
            />
          </div>
        ) : null}

        {step === 2 && kind === 'crew' ? (
          <fieldset className="stack-tight role-fieldset">
            <legend>Rol en la misión</legend>
            <p className="muted small">
              Misión: <strong>{missionCode}</strong> (la vigente; se asigna sola). Como máximo un Comandante y un
              Oficial médico por misión.
            </p>
            {CREW_ROLES.map((role) => {
              const holder = taken.get(role);
              return (
                <RoleOption
                  key={role}
                  name="crew_role"
                  value={role}
                  checked={draft.crew_role === role}
                  disabled={!!holder}
                  onChange={() => set({ crew_role: role })}
                  badge={<RoleBadge crewRole={role} plain />}
                  hint={CREW_ROLE_INFO[role].hint}
                  note={holder ? `Ocupado por ${holder}` : undefined}
                />
              );
            })}
            {errors.crew_role ? <span className="field-error">{errors.crew_role}</span> : null}
          </fieldset>
        ) : null}

        {step === 2 && kind === 'ground' ? (
          <fieldset className="stack-tight role-fieldset">
            <legend>Rol de la cuenta</legend>
            <p className="muted small">Se agrega al equipo en Tierra de {missionCode}. El rol decide qué ve en el panel.</p>
            {GROUND_ACCOUNT_ROLES.map((role) => (
              <RoleOption
                key={role}
                name="role"
                value={role}
                checked={draft.role === role}
                onChange={() => set({ role })}
                badge={<RoleBadge role={role} plain />}
                hint={GLOBAL_ROLE_INFO[role].hint}
              />
            ))}
            {errors.role ? <span className="field-error">{errors.role}</span> : null}
          </fieldset>
        ) : null}

        {step === 3 ? (
          <div className="stack-tight">
            <dl className="summary-list">
              <div>
                <dt>Nombre</dt>
                <dd>{draft.full_name.trim()}</dd>
              </div>
              <div>
                <dt>Usuario</dt>
                <dd>
                  <code>{draft.username}</code>
                </dd>
              </div>
              {kind === 'crew' ? (
                <>
                  <div>
                    <dt>Indicativo</dt>
                    <dd>
                      <strong>{draft.call_sign}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Roles</dt>
                    <dd className="row">
                      <RoleBadge role="astronaut" />
                      <RoleBadge crewRole={draft.crew_role} />
                    </dd>
                  </div>
                  <div>
                    <dt>Misión</dt>
                    <dd>{missionCode}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>Rol</dt>
                  <dd>
                    <RoleBadge role={draft.role} />
                  </dd>
                </div>
              )}
            </dl>
            <p className="muted small">
              Se genera una contraseña temporal que se muestra una sola vez; se pedirá cambiarla en el primer inicio
              de sesión.
              {kind === 'crew' ? ' Un astronauta entra solo a la app móvil, no a este panel.' : ''}
            </p>
            {general ? <Banner tone="error">{general}</Banner> : null}
          </div>
        ) : null}

        <div className="row wizard-actions">
          <Button variant="ghost" onClick={step === 1 ? onCancel : () => { setErrors({}); setStep(step - 1); }}>
            {step === 1 ? 'Cancelar' : 'Atrás'}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {step === 3 ? 'Crear cuenta' : 'Siguiente'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
