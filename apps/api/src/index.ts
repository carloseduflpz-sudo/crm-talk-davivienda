/* Punto de entrada del Worker: /api/* lo atiende la API; lo demás, la app web. */
import { createApp } from "./app";
import type { Env } from "./env";

const api = createApp();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return api.handle(request, env, (p) => ctx.waitUntil(p));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
