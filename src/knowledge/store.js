import { readFileSync } from 'node:fs';
import { digest } from '../runtime/digest.js';

const seed = JSON.parse(readFileSync(new URL('../../knowledge/cases.json', import.meta.url), 'utf8'));

function tokens(value) {
  const normalized = String(value || '').toLowerCase();
  const latin = normalized.split(/[^a-z0-9-]+/).filter(token => token.length > 1);
  const chinese = [...normalized.matchAll(/[\u3400-\u9fff]+/g)].flatMap(match => {
    const text = match[0];
    const parts = [text];
    for (let i = 0; i < text.length - 1; i++) parts.push(text.slice(i, i + 2));
    return parts;
  });
  return new Set([...latin, ...chinese]);
}

function score(queryTokens, card) {
  const cardTokens = tokens([card.title, card.summary, card.pattern, ...(card.tags || []), ...(card.evidence || [])].join(' '));
  let overlap = 0;
  for (const token of queryTokens) if (cardTokens.has(token)) overlap += token.length > 2 ? 2 : 1;
  return queryTokens.size ? overlap / Math.max(queryTokens.size, 1) : 0;
}

export class KnowledgeStore {
  constructor(cards = seed) {
    this.cards = structuredClone(cards);
  }

  search({ query, tags = [], topK = 3 }) {
    const queryTokens = tokens(`${query} ${tags.join(' ')}`);
    return this.cards
      .map(card => ({ ...structuredClone(card), score: Number(score(queryTokens, card).toFixed(4)), citation: `knowledge://${card.id}` }))
      .filter(card => card.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, Math.min(Number(topK) || 3, 10)));
  }

  write(card) {
    const id = card.cardId || `KB-${digest(card)}`;
    const stored = { ...structuredClone(card), id, citation: `knowledge://${id}` };
    const index = this.cards.findIndex(item => item.id === id);
    if (index >= 0) this.cards[index] = stored;
    else this.cards.push(stored);
    return stored;
  }

  size() {
    return this.cards.length;
  }
}
