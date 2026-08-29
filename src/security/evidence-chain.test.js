import test from "node:test";
import assert from "node:assert/strict";
import { EvidenceChain, verifyChain } from "./evidence-chain.js";

test("evidence chain appends links and finalizes with a verified head", () => {
  const chain = new EvidenceChain();
  chain.append("triage", { signal: "FB-1842" });
  chain.append("impact", { services: ["checkout-service"] });
  const frozen = chain.finalize();
  assert.equal(frozen.linkCount, 2);
  assert.equal(frozen.verified, true);
  assert.equal(frozen.head, frozen.links[1].linkHash);
  assert.equal(frozen.links[0].prevHash, frozen.genesis);
  assert.equal(frozen.links[1].prevHash, frozen.links[0].linkHash);
});

test("verifyChain accepts an untampered frozen chain", () => {
  const chain = new EvidenceChain();
  chain.append("triage", "payload-a");
  chain.append("rca", { score: 0.91 });
  chain.append("patch", [1, 2, 3]);
  const frozen = chain.finalize();
  assert.equal(verifyChain(frozen), true);
  assert.equal(verifyChain(structuredClone(frozen)), true);
});

test("verifyChain detects stageHash tampering", () => {
  const chain = new EvidenceChain();
  chain.append("triage", "a");
  chain.append("impact", "b");
  chain.append("rca", "c");
  const frozen = chain.finalize();
  const tampered = structuredClone(frozen);
  tampered.links[1].stageHash = "0".repeat(16);
  assert.equal(verifyChain(tampered), false);
});

test("verifyChain detects prevHash tampering", () => {
  const chain = new EvidenceChain();
  chain.append("triage", "a");
  chain.append("impact", "b");
  const frozen = chain.finalize();
  const tampered = structuredClone(frozen);
  tampered.links[1].prevHash = "f".repeat(16);
  assert.equal(verifyChain(tampered), false);
});

test("verifyChain detects linkHash tampering", () => {
  const chain = new EvidenceChain();
  chain.append("triage", "a");
  chain.append("impact", "b");
  const frozen = chain.finalize();
  const tampered = structuredClone(frozen);
  tampered.links[0].linkHash = "1".repeat(16);
  assert.equal(verifyChain(tampered), false);
});

test("verifyChain detects head tampering", () => {
  const chain = new EvidenceChain();
  chain.append("triage", "a");
  chain.append("impact", "b");
  const frozen = chain.finalize();
  const tampered = structuredClone(frozen);
  tampered.head = "0".repeat(16);
  assert.equal(verifyChain(tampered), false);
});

test("verifyChain detects an appended forged link without head update", () => {
  const chain = new EvidenceChain();
  chain.append("triage", "a");
  const frozen = chain.finalize();
  const tampered = structuredClone(frozen);
  tampered.links.push({ stage: "forged", stageHash: "0".repeat(16), prevHash: frozen.head, linkHash: "0".repeat(16), at: "1970-01-01T00:00:00.000Z" });
  assert.equal(verifyChain(tampered), false);
});

test("empty chain finalizes and verifies at genesis", () => {
  const chain = new EvidenceChain();
  const frozen = chain.finalize();
  assert.equal(frozen.linkCount, 0);
  assert.equal(frozen.head, frozen.genesis);
  assert.equal(frozen.verified, true);
  assert.equal(verifyChain(frozen), true);
});

test("single-link chain verifies and tampering breaks it", () => {
  const chain = new EvidenceChain();
  chain.append("triage", { x: 1 });
  const frozen = chain.finalize();
  assert.equal(verifyChain(frozen), true);
  const tampered = structuredClone(frozen);
  tampered.links[0].stageHash = "deadbeefdeadbeef";
  assert.equal(verifyChain(tampered), false);
});

test("verifyChain rejects malformed chain input", () => {
  assert.equal(verifyChain(null), false);
  assert.equal(verifyChain(undefined), false);
  assert.equal(verifyChain({}), false);
  assert.equal(verifyChain({ genesis: "0".repeat(16), head: "0".repeat(16), links: [] }), true);
  assert.equal(verifyChain({ genesis: "0".repeat(16), head: "bad", links: [] }), false);
});
