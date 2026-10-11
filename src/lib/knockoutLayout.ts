export interface KnockoutNode {
  id: string;
  round: string;
  targetId: string | null;
}

/** Presentation only: follow existing winner links to assign bracket halves. */
export function layoutKnockout(rounds: Array<{ key: string; nodes: KnockoutNode[] }>, cardWidth = 204, cardHeight = 108, gap = 54, slot = 128) {
  const nodes = rounds.flatMap(r => r.nodes);
  const final = rounds.find(r => r.key === 'FINAL');
  const branches = rounds.filter(r => r.key !== 'FINAL');
  const finalIds = new Set(final?.nodes.map(n => n.id));
  const side = new Map<string, 'left' | 'right' | 'center'>();
  final?.nodes.forEach(n => side.set(n.id, 'center'));
  const finalists = nodes.filter(n => n.targetId && finalIds.has(n.targetId));
  finalists.forEach((n, i) => side.set(n.id, i < Math.ceil(finalists.length / 2) ? 'left' : 'right'));
  for (const round of [...branches].reverse()) {
    round.nodes.forEach((n, i) => {
      const inherited = n.targetId ? side.get(n.targetId) : undefined;
      if (!side.has(n.id)) side.set(n.id, inherited && inherited !== 'center' ? inherited : i < Math.ceil(round.nodes.length / 2) ? 'left' : 'right');
    });
  }
  const count = Math.max(1, ...branches.flatMap(r => ['left', 'right'].map(s => r.nodes.filter(n => side.get(n.id) === s).length)), final?.nodes.length || 0);
  const height = 48 + count * slot;
  const middle = 40 + count * slot / 2;
  const centerX = branches.length * (cardWidth + gap);
  const width = 2 * centerX + cardWidth;
  const positions = new Map<string, { x: number; y: number; side: 'left' | 'right' | 'center' }>();
  const columns: Array<{ key: string; x: number; side: string; count: number }> = [];
  branches.forEach((round, index) => {
    for (const s of ['left', 'right'] as const) {
      const group = round.nodes.filter(n => side.get(n.id) === s);
      if (!group.length) continue;
      const x = s === 'left' ? index * (cardWidth + gap) : width - cardWidth - index * (cardWidth + gap);
      columns.push({ key: round.key, x, side: s, count: group.length });
      const centers = group.map((n, i) => {
        const sources = nodes.filter(src => src.targetId === n.id).map(src => positions.get(src.id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
        return sources.length ? sources.reduce((sum, p) => sum + p.y + cardHeight / 2, 0) / sources.length : 40 + (i + .5) * count * slot / group.length;
      });
      // Sparse rounds and BYEs must not put two cards on top of one another.
      for (let i = 1; i < centers.length; i++) centers[i] = Math.max(centers[i], centers[i - 1] + slot);
      const offset = middle - (centers[0] + centers[centers.length - 1]) / 2;
      group.forEach((n, i) => positions.set(n.id, { x, y: centers[i] + offset - cardHeight / 2, side: s }));
    }
  });
  if (final) {
    columns.push({ key: 'FINAL', x: centerX, side: 'center', count: final.nodes.length });
    final.nodes.forEach((n, i) => positions.set(n.id, { x: centerX, y: middle + (i - (final.nodes.length - 1) / 2) * slot - cardHeight / 2, side: 'center' }));
  }
  return { positions, columns, width, height };
}
