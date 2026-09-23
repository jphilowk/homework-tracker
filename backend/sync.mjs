import { fetchCanvasSnapshot, safeCanvasError } from './canvas.mjs';
import { retainCanvasHistory } from '../canvas-state.js';

export async function readCanvasStatus(db) {
  const row = await db.prepare('SELECT snapshot, last_success, last_error, lease_until FROM canvas_sync WHERE id = 1').first();
  if (!row) throw new Error('Storage unavailable');
  return { snapshot: row.snapshot ? JSON.parse(row.snapshot) : null, lastSuccess: row.last_success,
    error: row.last_error, syncing: row.lease_until > Date.now() };
}
export async function syncCanvas(env, { fetchSnapshot = fetchCanvasSnapshot, now = () => new Date() } = {}) {
  if (!env.CANVAS_TOKEN) return { ok: false, code: 'configuration' };
  const at = now().getTime(), lease = crypto.randomUUID();
  // An atomic compare-and-set keeps cron and manual syncs from racing. Failed
  // attempts also count toward the two-minute cooldown to avoid hammering Canvas.
  const acquired = await env.DB.prepare(`UPDATE canvas_sync SET lease = ?, lease_until = ?, last_attempt = ?
    WHERE id = 1 AND lease_until <= ? AND last_attempt <= ? RETURNING id`)
    .bind(lease, at + 180000, at, at, at - 120000).first();
  if (!acquired) return { ok: false, code: 'busy' };
  try {
    const current = await fetchSnapshot({ token: env.CANVAS_TOKEN });
    const previous = await readCanvasStatus(env.DB);
    const snapshot = retainCanvasHistory(previous.snapshot, current);
    if (snapshot.items.length > 10000 || JSON.stringify(snapshot).length > 1800000) throw new Error('Snapshot limit');
    const saved = await env.DB.prepare(`UPDATE canvas_sync SET snapshot = ?, last_success = ?, last_error = NULL, lease = NULL, lease_until = 0
      WHERE id = 1 AND lease = ? RETURNING id`).bind(JSON.stringify(snapshot), snapshot.fetchedAt, lease).first();
    return saved ? { ok: true } : { ok: false, code: 'busy' };
  } catch (error) {
    const safe = safeCanvasError(error);
    await env.DB.prepare('UPDATE canvas_sync SET last_error = ?, lease = NULL, lease_until = 0 WHERE id = 1 AND lease = ?').bind(safe.code, lease).run();
    return { ok: false, code: safe.code };
  }
}
