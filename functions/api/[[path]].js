import { json } from "../../public/worker/http.js";
import worker from "../../public/worker/index.js";

/**
 * Cloudflare Pages Functions entry point.
 *
 * Delegates to the shared Worker handler so this branch never has to rewrite the
 * API implementation that `main` keeps evolving. The `[[path]]` catch-all routes
 * every `/api/*` request here, including `/api` itself. Static assets are served
 * by Pages directly and never reach a Function.
 */
export function onRequest({ request, env }) {
  // The Worker handler only claims "/api/...", anything else falls through to its
  // static-asset branch, which does not exist in Pages file-based routing.
  if (!new URL(request.url).pathname.startsWith("/api/"))
    return json({ error: "接口不存在" }, 404);
  return worker.fetch(request, env);
}
