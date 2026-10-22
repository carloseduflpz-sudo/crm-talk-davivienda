/* Punto de entrada del Worker: /api/* lo atiende la API; lo demás, la app web. */
import { createApp } from "./app";
import type { Env } from "./env";

const app = createApp();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
