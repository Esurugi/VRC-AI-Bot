import { loadFacts, printJson } from "./_shared.ts";

const facts = loadFacts(process.argv.slice(2));
printJson({
  request_id: facts.request_id ?? null,
  place: facts.place ?? null,
  thread_context: facts.thread_context ?? null
});
