// Usage: node tests/unit/backtest-report.ts  (prints Markdown tables; synthetic data only)
import { DESIGN, HELD_OUT } from './sim.ts';
import { backtest, metrics, inSegment, CANDIDATES, SEGMENTS, type Candidate, type Sample, type Segment } from './backtest.ts';

const pct = (x: number | null) => x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`;
export const designWorlds = () => Object.values(DESIGN).flatMap(make => [1, 2, 3].map(seed => make(seed)));
export const heldOutWorlds = () => [...Object.values(HELD_OUT).flatMap(make => [101, 102, 103].map(seed => make(seed))), ...Object.values(DESIGN).flatMap(make => [201, 202].map(seed => make(seed)))];

export function table(title: string, samples: Sample[], candidates: Candidate[]) {
 const lines = [`### ${title}`, '', '| Segment | n | Candidate | Availability | Old err | New err | Bias old→new | New-only n | New-only err | Under% old→new | Material under% old→new | Shortfall old→new | Stability old→new |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
 for (const segment of SEGMENTS) {
  const subset = inSegment(samples, segment);
  if (!subset.length) continue;
  const base = metrics(subset, 'v2');
  lines.push(`| ${segment} | ${subset.length} | v2 | ${pct(base.availability)} | | | | | | ${pct(base.oldUnderShare)} | | ${pct(base.oldMeanShortfall)} | ${pct(base.oldStability)} |`);
  for (const c of candidates) {
   const m = metrics(subset, c);
   lines.push(`| | | ${c} | ${pct(m.availability)} | ${pct(m.oldError)} | ${pct(m.newError)} | ${pct(m.oldBias)}→${pct(m.bias)} | ${m.newOnlyN} | ${pct(m.newOnlyError)} | ${pct(m.oldUnderShare)}→${pct(m.underShare)} | ${pct(m.oldMaterialUnder)}→${pct(m.materialUnder)} | ${pct(m.oldMeanShortfall)}→${pct(m.meanShortfall)} | ${pct(m.oldStability)}→${pct(m.stability)} |`);
  }
 }
 return lines.join('\n');
}
export function perScenario(samples: Sample[], candidate: Candidate, segment: Segment = 'all') {
 samples = inSegment(samples, segment);
 const names = [...new Set(samples.map(s => s.scenario))];
 const lines = [`| Scenario | n | v2 avail | ${candidate} avail | comparable n | v2 err | ${candidate} err | v2 bias | ${candidate} bias | v2 under% | ${candidate} under% | v2 material | ${candidate} material | v2 shortfall | ${candidate} shortfall |`, '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
 for (const name of names) {
  const subset = samples.filter(s => s.scenario === name), a = metrics(subset, 'v2'), m = metrics(subset, candidate);
  lines.push(`| ${name} | ${subset.length} | ${pct(a.availability)} | ${pct(m.availability)} | ${m.comparableN} | ${pct(m.oldError)} | ${pct(m.newError)} | ${pct(m.oldBias)} | ${pct(m.bias)} | ${pct(m.oldUnderShare)} | ${pct(m.underShare)} | ${pct(m.oldMaterialUnder)} | ${pct(m.materialUnder)} | ${pct(m.oldMeanShortfall)} | ${pct(m.meanShortfall)} |`);
 }
 return lines.join('\n');
}
if (import.meta.url === `file://${process.argv[1]}`) {
 const design = backtest(designWorlds()), held = backtest(heldOutWorlds());
 const mode = process.argv[2] ?? 'summary';
 const cands = CANDIDATES.filter(c => c !== 'v2') as Candidate[];
 if (mode === 'summary') {
  console.log(table('Design scenarios (seeds 1-3)', design, cands));
  console.log('\n' + table('Held-out scenarios (new shapes, seeds 101-103, plus design shapes with seeds 201-202)', held, cands));
 } else {
  const candidate = (process.argv[3] ?? 'v3') as Candidate, segment = (process.argv[4] ?? 'all') as Segment;
  console.log(`#### Design, ${candidate}, segment ${segment}\n` + perScenario(design, candidate, segment));
  console.log(`\n#### Held-out, ${candidate}, segment ${segment}\n` + perScenario(held, candidate, segment));
 }
}
