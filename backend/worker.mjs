import { syncCanvas, readCanvasStatus } from './sync.mjs';
import assets from './generated-assets.mjs';

function response(body, status = 200, type = 'application/json; charset=utf-8') {
  return new Response(type.startsWith('application/json') ? JSON.stringify(body) : body, { status, headers: {
    'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  } });
}
export function createWorker({ sync = syncCanvas, read = readCanvasStatus, staticFiles = assets } = {}) {
  return {
    async fetch(request, env, ctx) {
      try {
        // ctx.access is supplied by Cloudflare itself, not a client-controlled
        // header. No Static Assets binding: its router drops this identity context.
        if (!env.OWNER_EMAIL || !ctx.access) return response({ error: 'sign_in_required' }, 403);
        const identity = await ctx.access.getIdentity();
        if (!identity?.email || identity.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) return response({ error: 'not_authorized' }, 403);
        const url = new URL(request.url);
        if (request.method === 'POST') {
          if (request.headers.get('origin') !== url.origin || request.headers.get('x-daybook-request') !== 'sync'
              || request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'invalid_origin' }, 403);
          if (url.pathname !== '/api/canvas/sync') return response({ error: 'not_found' }, 404);
          // Ignore request bodies; the browser cannot supply tokens or Canvas URLs.
          const result = await sync(env);
          if (!result.ok) return response({ error: result.code }, result.code === 'busy' ? 429 : 503);
          return response(await read(env.DB));
        }
        if (request.method !== 'GET') return response({ error: 'method_not_allowed' }, 405);
        if (url.pathname === '/api/canvas/status') return response({ ...await read(env.DB), configured: Boolean(env.CANVAS_TOKEN) });
        if (url.pathname === '/api/config') return response({ connected: true });
        const file = staticFiles[url.pathname === '/index.html' ? '/' : url.pathname];
        if (!file) return response({ error: 'not_found' }, 404);
        return response(file.content, 200, file.type);
      } catch { return response({ error: 'service_unavailable' }, 503); }
    },
    async scheduled(_controller, env, ctx) {
      // Disabled until an authenticated real-account manual sync is verified.
      if (env.AUTO_SYNC_ENABLED !== 'true' || !env.OWNER_EMAIL || !env.CANVAS_TOKEN) return;
      ctx.waitUntil(sync(env).catch(() => undefined));
    },
  };
}
export default createWorker();
