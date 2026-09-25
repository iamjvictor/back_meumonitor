import { writeFile } from "node:fs/promises";

const apiKey = process.env.QUESTAPI_API_KEY;
if (!apiKey) throw new Error("QUESTAPI_API_KEY não configurada.");

const terms = [
  "portugu", "gramát", "gramat", "norma culta", "classe de palavra", "classe gramatical",
  "grafia", "ortograf", "sintax", "morfolog", "semânt", "semant", "fonét", "fonet",
  "fonolog", "pontua", "acentua", "concordân", "concordan", "regênc", "regenc", "crase",
  "coesão", "coesao", "coerência", "coerencia", "interpretação de texto", "interpretacao de texto",
  "produção textual", "producao textual", "redação", "redacao", "literatura", "linguag",
  "texto", "discurso", "discurs", "verbo", "substantivo", "pronome", "adjetivo", "advérb",
  "adverb", "preposição", "preposicao", "conjunção", "conjuncao", "oração", "oracao",
  "período", "periodo", "regência", "regencia", "vocabulário", "vocabulario", "semiótica", "semiotica",
];

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const candidates = new Map<string, string[]>();
let page = 1;
let pages = 0;
let records = 0;
let retries = 0;

while (true) {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    response = await fetch(`https://api.quest.api.br/v1/filtros/materias?page=${page}&per_page=100`, {
      headers: { "X-API-Key": apiKey },
    });
    if (response.ok) break;
    if (response.status !== 429 && response.status >= 400 && response.status < 500) {
      throw new Error(`Quest API HTTP ${response.status}: ${await response.text()}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(60_000, 5_000 * (attempt + 1));
    retries += 1;
    await sleep(waitMs);
  }
  if (!response?.ok) throw new Error(`Não foi possível obter a página ${page}.`);

  const body = await response.json() as { data?: { items?: unknown[]; has_more?: boolean } };
  const items = body.data?.items ?? [];
  for (const item of items) {
    const value = String(
      typeof item === "string" ? item : (item as { nome?: string; name?: string; materia?: string })?.nome
        ?? (item as { name?: string })?.name
        ?? (item as { materia?: string })?.materia
        ?? "",
    ).trim();
    if (!value) continue;
    records += 1;
    const normalized = normalize(value);
    const matchedTerms = terms.filter((term) => normalized.includes(normalize(term)));
    if (matchedTerms.length > 0) candidates.set(value, matchedTerms);
  }

  pages += 1;
  process.stderr.write(`Lote ${page}: ${items.length} registros; candidatos ${candidates.size}\n`);
  if (!body.data?.has_more || items.length === 0) break;
  page += 1;
  await sleep(1_500);
}

const sorted = [...candidates.entries()].sort(([a], [b]) =>
  a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
);
const lines = [
  "# Candidatos de matérias relacionadas a Português — Quest API",
  "",
  `Consulta global concluída em ${new Date().toISOString()}.`,
  `Registros percorridos: **${records}** em **${pages}** lotes.`,
  `Candidatos únicos por triagem lexical: **${sorted.length}**.`,
  "",
  "> Esta lista é uma triagem inicial. Ela contém falsos positivos como Cartografia, Radiografia e Criptografia, que precisam ser removidos durante a revisão manual.",
  "",
  "| # | Matéria retornada | Termo(s) detectado(s) |",
  "|---:|---|---|",
  ...sorted.map(([subject, matchedTerms], index) =>
    `| ${index + 1} | ${subject.replaceAll("|", "\\|")} | ${matchedTerms.join(", ")} |`,
  ),
  "",
  `Retentativas por limite da API: ${retries}.`,
];

await writeFile("questapi-materias-portugues-candidatas.md", `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ output: "questapi-materias-portugues-candidatas.md", pages, records, candidates: sorted.length, retries }));
