export function sortDocumentIdsForAdvisoryLock(documentIds: Iterable<string>) {
  return Array.from(new Set(documentIds)).sort();
}

export async function acquireDocumentAdvisoryLocks(
  transaction: { $executeRaw: (strings: TemplateStringsArray, ...values: string[]) => Promise<unknown> },
  documentIds: Iterable<string>,
) {
  // Both chunk replacement and source creation must use this exact key and
  // acquire every document lock in this order while staying in one transaction.
  for (const documentId of sortDocumentIdsForAdvisoryLock(documentIds)) {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${documentId}, 0))`;
  }
}
