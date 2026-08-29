import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HybridKnowledgeStore } from './hybrid-store.js';
import { digest } from '../runtime/digest.js';

const episodeSeed = JSON.parse(readFileSync(fileURLToPath(new URL('../../knowledge/episodes.json', import.meta.url)), 'utf8'));

function episodeText(ep) {
  return [ep.title, ep.summary, ep.pattern, ...(ep.tags || []), ...(ep.evidence || [])].join(' ');
}

function matchesContext(ep, context) {
  if (!context) return true;
  for (const key of ['tenant', 'service', 'environment', 'gitRevision', 'configRevision']) {
    if (context[key] && ep[key] && context[key] !== ep[key]) return false;
  }
  return true;
}

export class EpisodeStore extends HybridKnowledgeStore {
  constructor(episodes = episodeSeed, embeddingProvider = null, alpha = 0.5) {
    super(episodes, embeddingProvider, alpha);
    this._isEpisode = episodes === episodeSeed || (Array.isArray(episodes) && episodes.length > 0 && episodes[0].recallStatus);
  }

  search({ query, tags = [], topK = 3, context = null, includeNegative = true }) {
    const recallFilter = context?.recallFilter || ['active', 'negative'];
    const originalCards = this.cards;
    this.cards = this.cards.filter(ep => {
      if (!ep.recallStatus) return true;
      if (!recallFilter.includes(ep.recallStatus)) return false;
      if (!includeNegative && ep.recallStatus === 'negative') return false;
      if (!matchesContext(ep, context)) return false;
      return true;
    });

    const scored = this.scoreAll({ query, tags });
    this.cards = originalCards;

    const sorted = scored.filter(ep => ep.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const results = sorted.slice(0, Math.max(1, Math.min(Number(topK) || 3, 10)));

    for (const ep of results) {
      if (ep.recallStatus === 'negative' && ep.negativeLessons?.length) {
        ep.warningMessage = ep.negativeLessons.map(l => l.description).join('; ');
      }
    }

    return results;
  }

  searchWithWarnings({ query, tags = [], topK = 3, context = null }) {
    const results = this.search({ query, tags, topK, context });
    const recommendations = results.filter(ep => ep.recallStatus !== 'negative');
    const warnings = results.filter(ep => ep.recallStatus === 'negative');
    // 负面证据注入：context 硬过滤匹配且与当前事故标签重叠的 negative Episode，
    // 即使未进入 topK 也始终作为警示附加，防止重复踩坑。
    const queryTags = new Set(tags || []);
    const queryTokens = this._tokens(query);
    const additionalWarnings = this.cards
      .filter(ep => ep.recallStatus === 'negative')
      .filter(ep => !warnings.some(w => w.id === ep.id))
      .filter(ep => matchesContext(ep, context))
      .filter(ep => (ep.tags || []).some(t => queryTags.has(t)) || [...queryTokens].some(t => t.length > 2 && this._tokens(episodeText(ep)).has(t)))
      .map(ep => {
        const cloned = structuredClone(ep);
        cloned.citation = `knowledge://${ep.id}`;
        cloned.score = cloned.score || 0;
        if (cloned.negativeLessons?.length) cloned.warningMessage = cloned.negativeLessons.map(l => l.description).join('; ');
        return cloned;
      });
    return { results, recommendations, warnings: [...warnings, ...additionalWarnings] };
  }

  write(episode) {
    const id = episode.episodeId || episode.cardId || `EP-${digest(episode)}`;
    const stored = { ...structuredClone(episode), id, citation: `knowledge://${id}` };
    if (!stored.recallStatus) stored.recallStatus = 'pending';
    const index = this.cards.findIndex(item => item.id === id);
    if (index >= 0) this.cards[index] = stored;
    else this.cards.push(stored);
    return stored;
  }

  promoteToActive(id, observation) {
    const ep = this.cards.find(item => item.id === id);
    if (ep) {
      ep.recallStatus = 'active';
      ep.observation = observation;
      ep.confidence = 'high';
    }
    return ep;
  }

  markNegative(id, observation) {
    const ep = this.cards.find(item => item.id === id);
    if (ep) {
      ep.recallStatus = 'negative';
      ep.observation = observation;
    }
    return ep;
  }

  _tokens(value) {
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
}
