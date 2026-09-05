import { serve } from "@hono/node-server";
import type { Hono } from "hono";

/** Shared production/test listener. P0 has no remote bind option. */
export function startLocalServer(app: Hono, port: number) {
  return serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
}
