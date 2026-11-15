export function Spinner({ label = 'Cargando…', large = false }: { label?: string; large?: boolean }) {
  return (
    <span
      className={`spinner${large ? ' spinner-lg' : ''}`}
      role={label ? 'status' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}
