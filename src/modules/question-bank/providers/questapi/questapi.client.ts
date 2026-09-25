export type QuestApiAlternative = {
  letra: string;
  texto: string;
  imagens?: string[];
};

export type QuestApiQuestion = {
  id: string;
  numero?: string | null;
  enunciado: string;
  alternativas: QuestApiAlternative[];
  gabarito?: string | null;
  prova: {
    id?: string | null;
    orgao?: string | null;
    cargo?: string | null;
    ano?: string | number | null;
    banca?: string | null;
    alternative_type?: string | null;
  };
  classificacao?: { materia?: string | null } | null;
  textos_associados?: string[] | null;
  anexos?: Array<{ url?: string | null } | string> | null;
  sinalizadores?: Record<string, boolean>;
};

export type QuestApiPage = {
  data: {
    total: number;
    page: number;
    per_page: number;
    items: QuestApiQuestion[];
    next_cursor?: string | null;
  };
  meta?: { correlationId?: string; timestamp?: string };
};

export class QuestApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(input: {
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    minIntervalMs?: number;
  }) {
    this.apiKey = input.apiKey;
    this.baseUrl = input.baseUrl ?? 'https://api.quest.api.br';
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.minIntervalMs = input.minIntervalMs ?? 1_100;
  }

  async listQuestions(input: {
    page: number;
    perPage: number;
    board: string;
    subject: string;
  }): Promise<QuestApiPage> {
    const params = new URLSearchParams({
      banca: input.board,
      materia: input.subject,
      page: String(input.page),
      per_page: String(input.perPage),
      include_gabarito: 'true',
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.waitForRateLimit();
      const response = await this.fetchImpl(`${this.baseUrl}/v1/questoes?${params.toString()}`, {
        headers: { Accept: 'application/json', 'X-API-Key': this.apiKey },
      });
      this.lastRequestAt = Date.now();
      if (response.status === 429 && attempt < 4) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(60_000, 5_000 * (attempt + 1));
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      const body = await response.json() as unknown;
      if (!response.ok) throw new Error(`Quest API respondeu HTTP ${response.status}: ${JSON.stringify(body)}`);
      return body as QuestApiPage;
    }
    throw new Error('Quest API excedeu o limite de tentativas após HTTP 429.');
  }

  private async waitForRateLimit() {
    const waitMs = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
