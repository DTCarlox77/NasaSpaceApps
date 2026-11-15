/** Placeholder de una sección (P1): título, endpoints que usará y en qué fase se implementa. */
import { sectionById, type SectionId } from '../nav/access.ts';

export function SectionPlaceholder({ id }: { id: SectionId }) {
  const section = sectionById(id);
  return (
    <section className="page stack" aria-labelledby={`section-${id}`}>
      <div>
        <p className="eyebrow">Sección</p>
        <h1 id={`section-${id}`}>{section.title}</h1>
        <p className="muted">{section.summary}</p>
      </div>
      <div className="placeholder-box">
        <p>
          <strong>Se implementa en {section.phase}.</strong> Usará:
        </p>
        <ul>
          {section.endpoints.map((endpoint) => (
            <li key={endpoint}>
              <code>{endpoint}</code>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
