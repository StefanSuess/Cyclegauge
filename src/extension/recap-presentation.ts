import { escapeHtml } from './labels.ts';
import { CARD_HEIGHT, CARD_WIDTH } from './recap-card.ts';
import { RECAP_TITLE, type Recap } from './recap.ts';

// Static, script-free markup for the recap card and the export section. The text is the card image's full text alternative and is complete
// without any script. The buttons are hidden: only the dashboard script, once it runs, reveals them and wires them to its fixed messages.
const hiddenButton = (id: string, label: string) => `<button type="button" id="${id}" hidden>${label}</button>`;

export function recapSection(recap: Recap): string {
 const items = recap.lines.map(line => `<li>${escapeHtml(line)}</li>`).join('');
 return `<section id="recap-card" aria-labelledby="recap-title"><h2 id="recap-title">${RECAP_TITLE}</h2><p id="recap-period" class="muted small">${escapeHtml(recap.period)}</p><ul id="recap-lines">${items}</ul>`
  + `<figure id="recap-preview" hidden><canvas id="recap-canvas" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" role="img" aria-labelledby="recap-title" aria-describedby="recap-lines"></canvas><figcaption class="muted small">Preview of the image that Save image… writes. The text above is its text alternative.</figcaption></figure>`
  + `<p class="recap-actions">${hiddenButton('recap-save', 'Save image…')} ${hiddenButton('recap-copy', 'Copy text')} ${hiddenButton('recap-dismiss', 'Dismiss')}</p>`
  + `<p id="recap-status" role="status"></p></section>`;
}

export const EXPORT_SECTION = `<section id="export-tools" aria-labelledby="export-heading"><h2 id="export-heading">Export your observed history</h2><p class="muted small">Save your retained account updates as a CSV file. You choose where it goes; Cyclegauge never writes to your workspace or to Kiro's folders. It contains only times, credit amounts, reset times and fixed quality codes.</p><p class="recap-actions">${hiddenButton('export-csv', 'Export CSV…')}</p><p id="export-status" role="status"></p></section>`;
