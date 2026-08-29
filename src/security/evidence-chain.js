import { createHash } from 'node:crypto';

const GENESIS_HASH = '0'.repeat(16);

function sha16(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 16);
}

export class EvidenceChain {
  constructor() {
    this.links = [];
    this.prevHash = GENESIS_HASH;
  }

  append(stage, payload) {
    const stageHash = sha16(payload);
    const linkHash = sha16(this.prevHash + stageHash);
    const link = { stage, stageHash, prevHash: this.prevHash, linkHash, at: new Date().toISOString() };
    this.links.push(link);
    this.prevHash = linkHash;
    return link;
  }

  finalize() {
    return {
      genesis: GENESIS_HASH,
      head: this.prevHash,
      links: this.links,
      verified: this.verify(),
      linkCount: this.links.length
    };
  }

  verify() {
    let prev = GENESIS_HASH;
    for (const link of this.links) {
      const expected = sha16(prev + link.stageHash);
      if (expected !== link.linkHash) return false;
      prev = link.linkHash;
    }
    return true;
  }

  snapshot() {
    return { genesis: GENESIS_HASH, head: this.prevHash, links: structuredClone(this.links) };
  }

  static fromSnapshot(snapshot) {
    const chain = new EvidenceChain();
    if (!snapshot) return chain;
    const links = Array.isArray(snapshot.links) ? snapshot.links : [];
    if (!verifyChain({ genesis: snapshot.genesis || GENESIS_HASH, head: snapshot.head, links })) {
      throw new Error('evidence chain snapshot failed verification; refusing to restore');
    }
    chain.links = structuredClone(links);
    chain.prevHash = links.length ? links[links.length - 1].linkHash : GENESIS_HASH;
    return chain;
  }
}

export function verifyChain(chain) {
  if (!chain?.links) return false;
  let prev = chain.genesis || GENESIS_HASH;
  for (const link of chain.links) {
    if (link.prevHash !== prev) return false;
    const expected = sha16(prev + link.stageHash);
    if (expected !== link.linkHash) return false;
    prev = link.linkHash;
  }
  return prev === chain.head;
}
