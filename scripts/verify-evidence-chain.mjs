import { readFile } from "node:fs/promises";
import { EvidenceChain, verifyChain } from "../src/security/evidence-chain.js";
import { runPipeline } from "../src/orchestrator.js";

function printChain(chain, label) {
  console.log(label + " evidence chain");
  console.log("  genesis: " + chain.genesis);
  console.log("  head:    " + chain.head);
  console.log("  links:   " + chain.linkCount);
  let i = 0;
  for (const link of chain.links) {
    console.log("    [" + i + "] stage=" + link.stage + " stageHash=" + link.stageHash + " prevHash=" + link.prevHash + " linkHash=" + link.linkHash);
    i = i + 1;
  }
};

async function verifyReport(report, label) {
  const chain = report.evidenceChain;
  if (!chain) {
    console.log("FAIL " + label + ": report has no evidenceChain field");
    return false;
  }
  const ok = verifyChain(chain);
  console.log((ok ? "PASS" : "FAIL") + " " + label + ": verifyChain=" + ok);
  printChain(chain, label);
  return ok;
};

function runTamperCheck(report) {
  const chain = report.evidenceChain;
  if (!chain || !chain.links || chain.links.length === 0) {
    console.log("SKIP tamper check: no links to tamper");
    return false;
  }
  const tampered = structuredClone(chain);
  tampered.links[0].stageHash = "f".repeat(16);
  const ok = verifyChain(tampered);
  const detected = !ok;
  console.log((detected ? "PASS" : "FAIL") + " tamper detection: modified stageHash, verifyChain=" + ok + " (expected false)");
  return detected;
};

async function main() {
  const file = process.argv[2];
  if (file) {
    const raw = await readFile(file, "utf8");
    const report = JSON.parse(raw);
    const ok = await verifyReport(report, file);
    const tamperOk = runTamperCheck(report);
    return ok && tamperOk;
  }
  console.log("Running happy-path pipeline to freeze a fresh evidence chain...");
  const report = await runPipeline({ scenario: "happy-path", approvalState: "approved" });
  const ok = await verifyReport(report, "happy-path");
  const tamperOk = runTamperCheck(report);
  return ok && tamperOk;
};

main().then(function (ok) { process.exit(ok ? 0 : 1);
}).catch(function (error) { console.error(error);
process.exit(1);
});
