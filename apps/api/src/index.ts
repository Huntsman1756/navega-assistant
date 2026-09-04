import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { createApp } from "./routes";

const config = loadConfig();
const app = createApp(config.provider, config.providerName, config.model);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(
    `Guided Web Assistant API listening on http://localhost:${info.port} (provider: ${config.providerName})`,
  );
});
