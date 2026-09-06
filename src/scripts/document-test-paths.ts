import { resolve } from 'node:path';

export function resolveRepositoryTestPath(projectRoot: string, ...segments: string[]) {
  return resolve(projectRoot, '../test', ...segments);
}

export function resolveDocumentTestCorpusDirectory(projectRoot: string) {
  return resolveRepositoryTestPath(projectRoot, 'docsTeste');
}

export function resolveDocumentTestResultsDirectory(projectRoot: string) {
  return resolveRepositoryTestPath(projectRoot, 'resultados');
}
