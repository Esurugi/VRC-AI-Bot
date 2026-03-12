import { loadFacts, printJson } from "./_shared.ts";

printJson(loadFacts(process.argv.slice(2)));
