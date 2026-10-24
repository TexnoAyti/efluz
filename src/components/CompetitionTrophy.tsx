import { Trophy } from 'lucide-react';

const images = {
  'copa-del-rey': { creator: 'MacMoreno', license: 'CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:Copa_del_Rey_Trophy.png' },
  'fa-cup': { creator: 'Riccardo de conciliis', license: 'CC BY-SA 2.5', source: 'https://commons.wikimedia.org/wiki/File:FA_Cup.png' },
};

/** Trophy cabinet artwork is separate from competition branding. */
export function CompetitionTrophy({ competitionId, name }: { competitionId: string; name: string }) {
  const key = Object.keys(images).find(slug => new RegExp(`^comp-${slug}-\\d{4}$`).test(competitionId)) as keyof typeof images | undefined;
  if (!key) return <Trophy aria-hidden="true" className="efl-trophy-fallback" strokeWidth={1.2} />;
  const image = images[key];
  const credit = `${name} — ${image.creator} · ${image.license}`;
  return <a href={image.source} target="_blank" rel="noopener noreferrer" title={credit} aria-label={credit} className="efl-trophy-image-link">
    <img src={`/trophies/${key}.svg`} alt={name} width="80" height="112" loading="lazy" decoding="async" className="efl-trophy-image" />
  </a>;
}
