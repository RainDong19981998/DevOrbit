import { KnowledgeStore } from './store.js';
import { cosineSimilarity } from '../models/embedding.js';

function cardText(card) {
  return [card.title, card.summary, card.pattern, ...(card.tags || []), ...(card.evidence || [])].join(' ');
}

export class HybridKnowledgeStore extends KnowledgeStore {
  constructor(cards, embeddingProvider = null, alpha = 0.5) {
    super(cards);
    this.embeddingProvider = embeddingProvider;
    this.alpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0.5;
    this._cardVectors = null;
    this._cardTexts = null;
  }

  async _ensureCardVectors() {
    if (!this.embeddingProvider || this._cardVectors) return;
    const texts = this.cards.map(cardText);
    this._cardTexts = texts;
    const { embeddings } = await this.embeddingProvider.embed(texts.slice(0, 10));
    this._cardVectors = embeddings;
  }

  async search({ query, tags = [], topK = 3 }) {
    const lexicalResults = this.scoreAll({ query, tags });
    if (!this.embeddingProvider) return lexicalResults.filter(card => card.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, topK);
    await this._ensureCardVectors();
    const queryText = `${query} ${tags.join(' ')}`;
    const { embeddings: queryVectors } = await this.embeddingProvider.embed([queryText]);
    const queryVec = queryVectors[0];
    const scored = lexicalResults.map((card, index) => {
      const cardVec = this._cardVectors[index] || null;
      const vecScore = cosineSimilarity(queryVec, cardVec);
      const combined = this.alpha * card.score + (1 - this.alpha) * vecScore;
      return { ...card, vecScore, combinedScore: Number(combined.toFixed(4)) };
    });
    return scored.sort((a, b) => b.combinedScore - a.combinedScore || a.id.localeCompare(b.id)).slice(0, Math.max(1, Math.min(Number(topK) || 3, 10)));
  }
}
