import { createApplication } from "./app/bot-app.js";

const app = createApplication();

async function main(): Promise<void> {
  await app.start();
}

main().catch(async (error) => {
  console.error(error);
  await app.stop().catch(() => undefined);
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.stop().catch(() => undefined);
    process.exit(0);
  });
}
