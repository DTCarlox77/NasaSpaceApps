/**
 * Etiqueta de rol (chip con texto + color) con un tooltip de una línea: lo que ese rol ve en el
 * sistema. Se enfoca con el teclado y el tooltip queda enlazado con aria-describedby.
 * - <RoleBadge role="flight_surgeon" />        rol global de la cuenta
 * - <RoleBadge crewRole="commander" />         rol en la misión (solo astronautas)
 */
import { useId } from 'react';
import { crewRoleInfo, globalRoleInfo } from '../nav/roles.ts';

type RoleBadgeProps = ({ role: string; crewRole?: never } | { crewRole: string; role?: never }) & {
  /** Sin tooltip (p. ej. dentro de una opción que ya muestra la descripción). */
  plain?: boolean;
};

export function RoleBadge(props: RoleBadgeProps) {
  const id = useId();
  const crew = props.crewRole !== undefined;
  const info = crew ? crewRoleInfo(props.crewRole as string) : globalRoleInfo(props.role as string);
  const icon = crew ? '◆' : '●';
  if (props.plain || !info.hint) {
    return (
      <span className={`role-badge role-${info.tone}`}>
        <span aria-hidden="true">{icon}</span>
        {info.label}
      </span>
    );
  }
  return (
    <span className={`role-badge role-${info.tone} has-tooltip`} tabIndex={0} aria-describedby={`${id}-hint`}>
      <span aria-hidden="true">{icon}</span>
      {info.label}
      <span role="tooltip" id={`${id}-hint`} className="role-tooltip">
        {info.hint}
      </span>
    </span>
  );
}
