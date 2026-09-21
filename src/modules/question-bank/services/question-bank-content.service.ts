import { createHash } from 'node:crypto';

const difficultyMap: Record<string, string> = {
  facil: 'EASY',
  medio: 'MEDIUM',
  media: 'MEDIUM',
  dificil: 'HARD',
};

export function splitTaxonomyPath(value: string | null | undefined) {
  return (value ?? '')
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeDifficulty(value: string | null | undefined) {
  const normalized = value
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  return normalized ? difficultyMap[normalized] ?? null : null;
}

export function extractImageUrls(html: string) {
  const urls: string[] = [];
  const imagePattern = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(imagePattern)) {
    const url = match[1]?.trim();
    if (url && /^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function sanitizeQuestionHtml(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:href|src)\s*=\s*["']\s*javascript:[^"']*["']/gi, '')
    .replace(/<img\b([^>]*?)\s*\/?>/gi, (_match, attributes: string) => {
      const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
      return src && /^https?:\/\//i.test(src) ? `<img src="${src}">` : '';
    });
}

export function htmlToPlainText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}

export function computeQuestionContentHash(input: {
  provider: string;
  providerQuestionId: string;
  subject: string;
  topic: string;
  statementText: string;
  alternatives: Array<{ label: string; text: string }>;
  correctAnswer: string;
}) {
  return createHash('sha256')
    .update(JSON.stringify({
      subject: input.subject,
      topic: input.topic,
      statementText: input.statementText,
      alternatives: input.alternatives,
      correctAnswer: input.correctAnswer,
    }))
    .digest('hex');
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}
