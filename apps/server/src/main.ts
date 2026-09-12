import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "./app.js";

// pnpm runs this workspace script from apps/server. Resolve the repository-root
// file explicitly so the documented `./.env` is honored in both dev and build.
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(moduleDirectory, "../../../.env") });

const app = buildApp();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
