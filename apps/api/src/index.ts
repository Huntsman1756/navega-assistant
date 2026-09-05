import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { createApp } from "./routes";

const config = loadConfig();
const app = createApp(config.provider, config.providerName, config.model, {
  providerTimeoutMs: config.providerTimeoutMs,
});

serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  console.log(
    `Guided Web Assistant API listening on http://127.0.0.1:${info.port} (provider: ${config.providerName})`,
  );
});
