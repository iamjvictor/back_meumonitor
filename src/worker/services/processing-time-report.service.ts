import { appendFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const reportPath = fileURLToPath(new URL('../../../../time.md', import.meta.url));

let writeQueue = Promise.resolve();

async function ensureReportHeader() {
  try {
    await access(reportPath, constants.F_OK);
  } catch {
    await appendFile(
      reportPath,
      '# Relatorio de tempo de processamento\n\n',
      'utf8',
    );
  }
}

export async function appendProcessingTimeReport(section: string) {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        await ensureReportHeader();
        await appendFile(reportPath, `${section.trim()}\n\n`, 'utf8');
      } catch (error) {
        // O relatorio e diagnostico e nunca deve interromper o processamento.
        console.error('Falha ao registrar relatorio de tempo', {
          event: 'monitor.processing_time_report_failed',
          reportPath,
          error,
        });
      }
    });

  await writeQueue;
}

export function formatDuration(durationMs: number) {
  return `${durationMs} ms (${(durationMs / 1000).toFixed(2)} s)`;
}
