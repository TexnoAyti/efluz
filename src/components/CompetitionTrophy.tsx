import { Trophy } from 'lucide-react';

const images = {
  'copa-del-rey': { creator: 'MacMoreno', license: 'CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:Copa_del_Rey_Trophy.png' },
  'fa-cup': { creator: 'Riccardo de conciliis', license: 'CC BY-SA 2.5', source: 'https://commons.wikimedia.org/wiki/File:FA_Cup.png' },
};

/** Trophy cabinet artwork is separate from competition branding. */
export function CompetitionTrophy({ competitionId, name }: { competitionId: string; name: string }) {
  const key = Object.keys(images).find(slug => new RegExp(`^comp-${slug}-\\d{4}$`).test(competitionId)) as keyof typeof images | undefined;
  if (!key) return <Trophy aria-hidden="true" className="h-20 w-20 text-amber-500" strokeWidth={1.2} />;
  const image = images[key];
  const credit = `${name} — ${image.creator} · ${image.license}`;
  return <a href={image.source} target="_blank" rel="noopener noreferrer" title={credit} aria-label={credit} className="flex h-full w-full items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--efl-primary)]">
    <img src={`/trophies/${key}.svg`} alt={name} width="96" height="128" loading="lazy" decoding="async" className="h-32 w-24 object-contain drop-shadow-[0_6px_12px_rgba(0,0,0,0.25)]" />
  </a>;
}
