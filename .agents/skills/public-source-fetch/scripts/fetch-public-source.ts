import { parseArgs } from "node:util";

import { fetchPublicSource } from "../../../../implementation/src/knowledge/public-source-fetch.js";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    url: {
      type: "string"
    }
  },
  strict: true,
  allowPositionals: false
});

const rawUrl = values.url?.trim();
if (!rawUrl) {
  throw new Error("Missing required flag --url");
}

const result = await fetchPublicSource(rawUrl);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
