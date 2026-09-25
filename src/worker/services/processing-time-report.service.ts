import { appendFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const reportPath = fileURLToPath(new URL('../../../../time.md', import.meta.url));

let writeQueue = Promise.resolve();

export type ProcessingStageStatus = 'READY' | 'PARTIAL_SUCCESS' | 'FAILED' | 'SKIPPED';

export type ProcessingStageTiming = {
  documentId: string;
  stage: string;
  status: ProcessingStageStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attempt?: number;
  jobId?: string;
  details?: Record<string, string | number | boolean | null>;
  error?: string;
};

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

export function formatProcessingStageReport(timing: ProcessingStageTiming) {
  const lines = [
    `### Etapa: ${timing.stage}`,
    `- Documento ID: \`${timing.documentId}\``,
    `- Status: ${timing.status}`,
    `- Iniciado em: ${timing.startedAt}`,
    `- Finalizado em: ${timing.finishedAt}`,
    `- Duracao: ${formatDuration(timing.durationMs)}`,
  ];

  if (timing.attempt !== undefined) lines.push(`- Tentativa: ${timing.attempt}`);
  if (timing.jobId) lines.push(`- Job ID: \`${timing.jobId}\``);
  if (timing.details && Object.keys(timing.details).length > 0) {
    lines.push(`- Detalhes: ${JSON.stringify(timing.details)}`);
  }
  if (timing.error) lines.push(`- Erro: ${timing.error.slice(0, 1000)}`);
  return lines.join('\n');
}

export async function appendProcessingStageReport(timing: ProcessingStageTiming) {
  const report = formatProcessingStageReport(timing);
  console.log('Etapa de processamento medida', {
    event: 'monitor.document_processing_stage_timed',
    ...timing,
  });
  await appendProcessingTimeReport(report);
}

export function formatDuration(durationMs: number) {
  return `${durationMs} ms (${(durationMs / 1000).toFixed(2)} s)`;
}
