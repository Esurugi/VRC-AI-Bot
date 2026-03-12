import { loadFacts, printJson } from "./_shared.ts";

const facts = loadFacts(process.argv.slice(2));
printJson({
  request_id: facts.request_id ?? null,
  actor: facts.actor ?? null,
  message: facts.message ?? null,
  capabilities: facts.capabilities ?? null
});
