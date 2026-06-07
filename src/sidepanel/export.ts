import { escapeHtml, pretty, SessionExport } from '../shared';

export function renderExportSummary(exportData: SessionExport): string {
  return `
    <strong>${pretty(exportData.outcome)}</strong><br>
    Deliverable: ${exportData.deliverable ? 'available' : 'none'}<br>
    Operations used: ${exportData.stats.operationsUsed}<br>
    Final context: ${escapeHtml(exportData.stats.finalContextLoad)}
  `;
}

export function downloadDeliverableFile(task: string, exportData: SessionExport): void {
  if (!exportData.deliverable) return;
  const safeTask = slugifyTask(task || 'deliverable');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Deliverable</title></head><body><h1>${escapeHtml(task || 'Deliverable')}</h1><div>${escapeHtml(exportData.deliverable).replace(/\n/g, '<br>')}</div></body></html>`;
  triggerDownload(new Blob([html], { type: 'application/msword' }), `${safeTask}-deliverable.doc`);
}

export function downloadSessionExportFile(exportData: SessionExport): void {
  triggerDownload(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }), 'human-mode-export.json');
}

function slugifyTask(task: string): string {
  return task
    .slice(0, 40)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'deliverable';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
