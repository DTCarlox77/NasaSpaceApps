/**
 * Equipo (/equipo), SOLO admin = control de misión: cómo se arma el equipo de la misión y qué
 * rol tiene cada quien.
 * - "Tripulación · <misión>": tarjetas por astronauta (indicativo, nombre, usuario, rol en la
 *   misión, misión, estado de la cuenta y fecha de alta).
 * - "Equipo en Tierra": tabla con nombre, usuario, rol global, estado y último acceso.
 * - Buscador, filtro por rol, alta guiada y leyenda "qué ve cada rol".
 * En modo api: la tripulación sale del contrato (GET /missions/{id}/crew y /admin/assignments);
 * usuario, estado, último acceso y el equipo en Tierra no tienen endpoint (no hay
 * GET /admin/users en v1.8) y muestran "Disponible en modo demo".
 */
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { TeamAccount } from '../../api/types.ts';
import { useAuth } from '../../auth/context.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { Loading, QueryError } from '../../components/QueryStatus.tsx';
import { RoleBadge } from '../../components/RoleBadge.tsx';
import { calendarDate, clockTime, timeAgo } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useMission } from '../../mission/useMission.ts';
import { canDo } from '../../nav/access.ts';
import { CREW_ROLE_INFO, CREW_ROLES, GLOBAL_ROLE_INFO, GROUND_ACCOUNT_ROLES } from '../../nav/roles.ts';
import { CreateAccountWizard, type CreatedAccount } from './CreateAccountWizard.tsx';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog.tsx';
import { ACCOUNT_STATUS_META, accountStatus, matchesSearch, type CrewRow, type TeamKind } from './team.ts';
import { useCrewRoster, useGroundAccounts, useRefreshMission } from './useTeam.ts';
import './team.css';

export const DEMO_ONLY = 'Disponible en modo demo';

export function AccountStatusBadge({ account, now }: { account: TeamAccount; now: number }) {
  const status = accountStatus(account, now);
  const meta = ACCOUNT_STATUS_META[status];
  return (
    <span className={`account-status account-${status}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {meta.text}
      {status === 'locked' && account.locked_until ? ` hasta las ${clockTime(account.locked_until)}` : ''}
    </span>
  );
}

function DemoOnly() {
  return (
    <span className="demo-only" title="El contrato v1.8 no tiene una lista de cuentas (GET /admin/users).">
      <span aria-hidden="true">◇</span> {DEMO_ONLY}
    </span>
  );
}

function CrewCard({
  row,
  missionCode,
  mock,
  now,
  actions,
}: {
  row: CrewRow;
  missionCode: string;
  mock: boolean;
  now: number;
  actions?: ReactNode;
}) {
  const headingId = `equipo-${row.astronaut_id}`;
  return (
    <article className="team-card" aria-labelledby={headingId}>
      <header className="team-card-header">
        <h3 id={headingId} className="team-callsign">
          {row.call_sign}
        </h3>
        {actions}
      </header>
      <p className="team-name">{row.full_name}</p>
      <div className="row">
        <RoleBadge crewRole={row.crew_role} />
        <RoleBadge role="astronaut" />
      </div>
      <dl className="team-facts">
        <div>
          <dt>Usuario</dt>
          <dd>{row.account ? <code>{row.account.username}</code> : mock ? '—' : <DemoOnly />}</dd>
        </div>
        <div>
          <dt>Misión</dt>
          <dd>{missionCode}</dd>
        </div>
        <div>
          <dt>Cuenta</dt>
          <dd>{row.account ? <AccountStatusBadge account={row.account} now={now} /> : mock ? '—' : <DemoOnly />}</dd>
        </div>
        <div>
          <dt>Alta</dt>
          <dd>{calendarDate(row.assigned_from)}</dd>
        </div>
      </dl>
    </article>
  );
}

function GroundTable({ accounts, now, actions }: { accounts: TeamAccount[]; now: number; actions?(a: TeamAccount): ReactNode }) {
  return (
    <table className="data-table team-table">
      <caption className="visually-hidden">Equipo en Tierra</caption>
      <thead>
        <tr>
          <th scope="col">Nombre</th>
          <th scope="col">Usuario</th>
          <th scope="col">Rol</th>
          <th scope="col">Estado</th>
          <th scope="col">Último acceso</th>
          {actions ? <th scope="col">Acciones</th> : null}
        </tr>
      </thead>
      <tbody>
        {accounts.map((a) => (
          <tr key={a.id}>
            <td>{a.full_name}</td>
            <td>
              <code>{a.username}</code>
            </td>
            <td>
              <RoleBadge role={a.role} />
            </td>
            <td>
              <AccountStatusBadge account={a} now={now} />
            </td>
            <td>{a.last_login_at ? timeAgo(a.last_login_at, now) : 'Nunca'}</td>
            {actions ? <td>{actions(a)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RoleLegend() {
  return (
    <section className="team-legend" aria-labelledby="legend-title">
      <h2 id="legend-title">Qué ve cada rol</h2>
      <div className="team-legend-grid">
        <div>
          <h3 className="small muted">Rol de la cuenta</h3>
          <ul className="plain-list stack-tight">
            {(['admin', 'flight_surgeon', 'behavioral_health', 'astronaut'] as const).map((role) => (
              <li key={role} className="legend-row">
                <RoleBadge role={role} plain />
                <span className="small">{GLOBAL_ROLE_INFO[role].hint}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="small muted">Rol en la misión (astronautas)</h3>
          <ul className="plain-list stack-tight">
            {CREW_ROLES.map((role) => (
              <li key={role} className="legend-row">
                <RoleBadge crewRole={role} plain />
                <span className="small">{CREW_ROLE_INFO[role].hint}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function TeamPage() {
  const { role } = useAuth();
  const { mission, missionId } = useMission();
  const [params, setParams] = useSearchParams();
  const view: TeamKind = params.get('vista') === 'tierra' ? 'ground' : 'crew';
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [wizard, setWizard] = useState<TeamKind | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [lastCreated, setLastCreated] = useState<string | null>(null);
  const roster = useCrewRoster();
  const ground = useGroundAccounts();
  const refresh = useRefreshMission();
  const now = useNow(30_000);
  const missionCode = mission?.code ?? '—';
  const canCreate = canDo(role, 'account.create');
  const mock = roster.mock;

  const knownUsernames = mock
    ? new Set(
        [...(Array.isArray(roster.accounts.data?.items) ? roster.accounts.data.items : []), ...ground.accounts].map((a) =>
          a.username.toLowerCase(),
        ),
      )
    : null;

  function setView(next: TeamKind) {
    const p = new URLSearchParams(params);
    if (next === 'ground') p.set('vista', 'tierra');
    else p.delete('vista');
    setParams(p, { replace: true });
    setRoleFilter('');
  }

  const crewRows = roster.rows.filter(
    (r) =>
      (!roleFilter || r.crew_role === roleFilter) &&
      matchesSearch(search, [r.call_sign, r.full_name, r.account?.username]),
  );
  const groundRows = ground.accounts
    .filter((a) => (!roleFilter || a.role === roleFilter) && matchesSearch(search, [a.full_name, a.username]))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  let body: ReactNode;
  if (!missionId) {
    body = <Banner tone="info">No tienes una misión asignada.</Banner>;
  } else if (view === 'crew') {
    if (!roster.crew.data) {
      body = roster.crew.isError ? (
        <QueryError error={roster.crew.error} onRetry={() => void roster.crew.refetch()} />
      ) : (
        <Loading label="Cargando la tripulación…" />
      );
    } else {
      body =
        crewRows.length === 0 ? (
          <p className="muted">Nadie coincide con la búsqueda.</p>
        ) : (
          <div className="team-grid">
            {crewRows.map((row) => (
              <CrewCard key={row.astronaut_id} row={row} missionCode={missionCode} mock={mock} now={now} />
            ))}
          </div>
        );
    }
  } else if (!mock) {
    body = (
      <Banner tone="info">
        <strong>{DEMO_ONLY}.</strong> El contrato v1.8 no tiene una lista de cuentas (GET /admin/users), así que el
        equipo en Tierra, el usuario, el estado y el último acceso solo se ven en el modo demo. El alta sí funciona.
      </Banner>
    );
  } else if (!ground.query.data) {
    body = ground.query.isError ? (
      <QueryError error={ground.query.error} onRetry={() => void ground.query.refetch()} />
    ) : (
      <Loading label="Cargando el equipo en Tierra…" />
    );
  } else {
    body =
      groundRows.length === 0 ? (
        <p className="muted">Nadie coincide con la búsqueda.</p>
      ) : (
        <GroundTable accounts={groundRows} now={now} />
      );
  }

  const roleOptions =
    view === 'crew'
      ? CREW_ROLES.map((r) => ({ value: r, label: CREW_ROLE_INFO[r].label }))
      : GROUND_ACCOUNT_ROLES.map((r) => ({ value: r, label: GLOBAL_ROLE_INFO[r].label }));

  return (
    <section className="page page-wide stack" aria-labelledby="team-title">
      <div className="page-header">
        <div>
          <p className="eyebrow">Misión {missionCode}</p>
          <h1 id="team-title">Equipo</h1>
          <p className="muted">Cómo se arma el equipo de la misión y qué ve cada rol en el sistema.</p>
        </div>
        {canCreate && missionId ? (
          <div className="row">
            <Button onClick={() => setWizard('crew')}>Agregar a la tripulación</Button>
            <Button variant="secondary" onClick={() => setWizard('ground')}>
              Agregar al equipo en Tierra
            </Button>
          </div>
        ) : null}
      </div>

      {lastCreated ? <Banner tone="success">{lastCreated}</Banner> : null}

      <div className="tabs" role="tablist" aria-label="Equipo">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'crew'}
          className={`tab${view === 'crew' ? ' active' : ''}`}
          onClick={() => setView('crew')}
        >
          Tripulación · {missionCode}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'ground'}
          className={`tab${view === 'ground' ? ' active' : ''}`}
          onClick={() => setView('ground')}
        >
          Equipo en Tierra
        </button>
      </div>

      <div className="filter-row">
        <div className="field">
          <label htmlFor="team-search">Buscar</label>
          <input
            id="team-search"
            type="search"
            value={search}
            placeholder={view === 'crew' ? 'Nombre, usuario o indicativo' : 'Nombre o usuario'}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="team-role">Rol</label>
          <select id="team-role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">Todos</option>
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {body}

      <RoleLegend />

      {wizard && missionId ? (
        <CreateAccountWizard
          kind={wizard}
          missionId={missionId}
          missionCode={missionCode}
          crewRows={roster.rows}
          knownUsernames={knownUsernames}
          onCancel={() => setWizard(null)}
          onCreated={(account) => {
            setWizard(null);
            setCreated(account);
            void refresh();
          }}
        />
      ) : null}

      {created ? (
        <TemporaryPasswordDialog
          username={created.username}
          password={created.temporaryPassword}
          heading={`Cuenta creada: ${created.description}.`}
          onClose={() => {
            setLastCreated(`Cuenta de ${created.username} creada (${created.description}).`);
            // Al cerrar, la contraseña temporal se descarta: no se puede volver a ver.
            setCreated(null);
          }}
        />
      ) : null}
    </section>
  );
}
