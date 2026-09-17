/**
 * Backend source is never a public asset. The Vite build strips `dist/worker`,
 * so this only matters for `wrangler pages dev`, which serves ./public directly.
 */
export function onRequest() {
  return new Response("Not found", { status: 404 });
}
