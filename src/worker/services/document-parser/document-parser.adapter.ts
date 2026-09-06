import type {
  DocumentParserName,
  LayoutDocument,
  ParseInput,
  ParseStatus,
  ParseSubmission,
} from './document-parser.types.js';

export interface DocumentParserAdapter {
  readonly name: DocumentParserName;
  parse(input: ParseInput): Promise<ParseSubmission>;
  getStatus(parseRunId: string, statusUrl?: string): Promise<ParseStatus>;
  getResult(parseRunId: string, resultUrl?: string): Promise<LayoutDocument>;
}

export class DocumentParserAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'DocumentParserAdapterError';
  }
}
