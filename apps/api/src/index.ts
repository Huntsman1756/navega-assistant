import { startLocalServer } from "./server";
import { loadConfig } from "./config";
import { createApp } from "./routes";

const config = loadConfig();
const app = createApp(config.provider, config.providerName, config.model, {
  providerTimeoutMs: config.providerTimeoutMs,
});

const server = startLocalServer(app, config.port);
server.on("listening", () => {
  const info = server.address();
  if (!info || typeof info === "string") return;
  console.log(
    `Guided Web Assistant API listening on http://127.0.0.1:${info.port} (provider: ${config.providerName})`,
  );
});
