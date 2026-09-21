export type EnemHubAlternative = {
  id?: string | null;
  letter: string;
  text: string;
  isCorrect: boolean;
};

export type EnemHubQuestion = {
  id: string;
  externalId?: string | null;
  year?: number | null;
  difficulty?: string | null;
  statement: string;
  correctAlternative: string;
  exam?: { id?: string | null; name?: string | null; institution?: string | null } | null;
  subject: { id?: string | null; name: string; area?: string | null };
  alternatives: EnemHubAlternative[];
};

export type EnemHubPage = {
  data: EnemHubQuestion[];
  meta?: { page?: number; limit?: number; total?: number | null } | null;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class EnemHubClient {
  private readonly fetchImpl: FetchLike;
  private lastRequestAt = 0;

  constructor(private readonly options: {
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    minIntervalMs?: number;
  }) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listQuestions(input: { page: number; limit: number; year?: number; subjectId?: string }): Promise<EnemHubPage> {
    const url = new URL('/v1/enem/questions/', this.options.baseUrl ?? 'https://api.enemhub.com.br');
    url.searchParams.set('page', String(input.page));
    url.searchParams.set('limit', String(input.limit));
    if (input.year !== undefined) url.searchParams.set('year', String(input.year));
    if (input.subjectId) url.searchParams.set('subjectId', input.subjectId);

    await this.waitForRateLimit();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await this.waitForRateLimit();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 90_000);
      try {
        this.lastRequestAt = Date.now();
        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            headers: { Accept: 'application/json', 'X-API-Key': this.options.apiKey },
            signal: controller.signal,
          });
        } catch (error) {
          if (attempt >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
          continue;
        }
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get('Retry-After') ?? 60);
          await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 60) * 1_000));
          continue;
        }
        if (!response.ok) throw new Error(`EnemHub respondeu HTTP ${response.status}.`);
        const payload: unknown = await response.json();
        if (!isEnemHubPage(payload)) throw new Error('Resposta inválida da API EnemHub.');
        return payload;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error('EnemHub respondeu HTTP 429 após três tentativas.');
  }

  private async waitForRateLimit() {
    const minimumIntervalMs = this.options.minIntervalMs ?? 6_500;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < minimumIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, minimumIntervalMs - elapsed));
    }
  }
}

function isEnemHubPage(value: unknown): value is EnemHubPage {
  if (!value || typeof value !== 'object') return false;
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data);
}
