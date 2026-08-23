import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// Keep a margin below the Storage limit instead of targeting the exact boundary.
export const STORAGE_FILE_LIMIT_BYTES = 50 * 1024 * 1024;
const COMPRESSION_TARGET_BYTES = 49_000_000;

type CompressionProfile = {
  name: 'ebook' | 'screen' | 'printer';
  pdfSettings: '/ebook' | '/screen' | '/printer';
  dpi: number;
};

const compressionProfiles: CompressionProfile[] = [
  { name: 'ebook', pdfSettings: '/ebook', dpi: 150 },
  { name: 'screen', pdfSettings: '/screen', dpi: 72 },
  { name: 'printer', pdfSettings: '/printer', dpi: 300 },
];

export type CompressedPdf = {
  buffer: Buffer;
  originalSizeBytes: number;
  finalSizeBytes: number;
  compressed: boolean;
  profile: CompressionProfile['name'] | null;
  localDiagnosticPath: string | null;
};

export async function compressPdfForStorage(input: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  diagnosticFileName?: string;
}): Promise<CompressedPdf> {
  const originalSizeBytes = input.buffer.length;
  if (originalSizeBytes <= COMPRESSION_TARGET_BYTES) {
    return {
      buffer: input.buffer,
      originalSizeBytes,
      finalSizeBytes: originalSizeBytes,
      compressed: false,
      profile: null,
      localDiagnosticPath: null,
    };
  }

  const isPdf = input.mimeType === 'application/pdf' || /\.pdf$/i.test(input.originalName);
  if (!isPdf) {
    throw new Error(`Arquivo excede o limite de ${COMPRESSION_TARGET_BYTES} bytes e nao e um PDF compactavel.`);
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'meumonitor-pdf-'));
  const inputPath = join(temporaryDirectory, basename(input.originalName).replace(/[^a-zA-Z0-9._-]/g, '_'));
  const outputPath = join(temporaryDirectory, 'compressed-output.pdf');

  try {
    await writeFile(inputPath, input.buffer);

    for (const profile of compressionProfiles) {
      try {
        await execFileAsync('gs', [
          '-q',
          '-dSAFER',
          '-dBATCH',
          '-dNOPAUSE',
          '-sDEVICE=pdfwrite',
          '-dCompatibilityLevel=1.4',
          `-dPDFSETTINGS=${profile.pdfSettings}`,
          '-dAutoRotatePages=/None',
          `-dDownsampleColorImages=true`,
          `-dColorImageResolution=${profile.dpi}`,
          `-dDownsampleGrayImages=true`,
          `-dGrayImageResolution=${profile.dpi}`,
          `-dDownsampleMonoImages=true`,
          `-dMonoImageResolution=${Math.max(profile.dpi, 300)}`,
          `-sOutputFile=${outputPath}`,
          inputPath,
        ], { maxBuffer: 1024 * 1024 });

        const compressedBuffer = await readFile(outputPath);
        if (compressedBuffer.length <= COMPRESSION_TARGET_BYTES && compressedBuffer.subarray(0, 5).toString() === '%PDF-') {
          const localDiagnosticPath = await saveDiagnosticCopy(
            compressedBuffer,
            input.diagnosticFileName ?? `compressed-${Date.now()}.pdf`,
          );
          return {
            buffer: compressedBuffer,
            originalSizeBytes,
            finalSizeBytes: compressedBuffer.length,
            compressed: true,
            profile: profile.name,
            localDiagnosticPath,
          };
        }
      } catch {
        // Try the next profile. The original upload is never modified.
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  throw new Error(
    `Nao foi possivel compactar ${input.originalName} para menos de ${COMPRESSION_TARGET_BYTES} bytes.`,
  );
}

async function saveDiagnosticCopy(buffer: Buffer, fileName: string) {
  const diagnosticDirectory = fileURLToPath(new URL('../../../compressed-files/', import.meta.url));
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const diagnosticPath = join(diagnosticDirectory, safeFileName);
  try {
    await mkdir(diagnosticDirectory, { recursive: true });
    await writeFile(diagnosticPath, buffer);
    return diagnosticPath;
  } catch (error) {
    console.warn('Falha ao salvar copia comprimida para diagnostico', {
      event: 'monitor.document_compressed_copy_failed',
      diagnosticPath,
      error,
    });
    return null;
  }
}
