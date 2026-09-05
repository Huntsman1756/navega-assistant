import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { createApp } from "./routes";

const config = loadConfig();
const app = createApp(config.provider, config.providerName, config.model, {
  providerTimeoutMs: config.providerTimeoutMs,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `Guided Web Assistant API listening on http://localhost:${info.port} (provider: ${config.providerName})`,
  );
});
