// Server-only: never import this module into the browser or log API payloads.
export const CANVAS_ORIGIN = 'https://naperville.instructure.com';
const messages = Object.freeze({
  configuration: 'Canvas secret is missing or invalid.',
  authentication: 'Canvas rejected the token. It may have expired or been revoked.',
  forbidden: 'Canvas does not permit this request for the current account.',
  rate_limit: 'Canvas is busy. Try again later.',
  network: 'Canvas could not be reached. Try again later.',
  response: 'Canvas returned an unexpected response. No assignments were changed.',
  redirect: 'Canvas redirected an API request. Authentication needs review.',
  pagination: 'Canvas pagination could not be safely completed.',
  limit: 'The Canvas request limit was reached. No partial sync was saved.',
  unavailable: 'Canvas is temporarily unavailable. Try again later.',
});
export class CanvasError extends Error {
  constructor(code) { super(messages[code] || messages.response); this.name = 'CanvasError'; this.code = Object.hasOwn(messages, code) ? code : 'response'; }
}
export function safeCanvasError(error) {
  // Never stringify a fetch error, its cause, a URL, or an upstream response body.
  const code = error instanceof CanvasError && Object.hasOwn(messages, error.code) ? error.code : 'response';
  return { code, message: messages[code] };
}
function canvasId(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) throw new CanvasError('response');
  if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) throw new CanvasError('response');
  return String(value);
}
export function canvasTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value);
  const calendarDate = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return date.toISOString();
}
export function submissionEvidence(submission) {
  if (!submission || typeof submission !== 'object') return 'unknown';
  if (submission.redo_request === true) return 'resubmit';
  if (submission.excused === true) return 'excused';
  // A grade may be an automatic zero, and missing submission data is not proof
  // of unfinished work (paper/external assignments may never have a timestamp).
  if (['submitted', 'pending_review', 'graded'].includes(submission.workflow_state)
      && canvasTimestamp(submission.submitted_at) && submission.missing !== true) return 'submitted';
  return 'unknown';
}
export function normalizeAssignment(raw, course) {
  if (!raw || typeof raw !== 'object') throw new CanvasError('response');
  const assignmentId = canvasId(raw.id), courseId = canvasId(course.id);
  if (raw.course_id != null && canvasId(raw.course_id) !== courseId) throw new CanvasError('response');
  if (typeof raw.name !== 'string' || !raw.name.trim() || typeof course.name !== 'string' || !course.name.trim()) throw new CanvasError('response');
  return {
    id: `canvas:naperville:${courseId}:${assignmentId}`,
    source: 'canvas', origin: CANVAS_ORIGIN, assignmentId, courseId,
    title: raw.name.trim(), className: course.name.trim(),
    dueAt: canvasTimestamp(raw.due_at),
    // Build a safe canonical link, avoiding API-provided query credentials or HTML.
    url: `${CANVAS_ORIGIN}/courses/${courseId}/assignments/${assignmentId}`,
    submission: submissionEvidence(raw.submission),
  };
}
function safePage(value, expectedPath) {
  let url;
  try { url = new URL(value, CANVAS_ORIGIN); } catch { throw new CanvasError('pagination'); }
  if (url.origin !== CANVAS_ORIGIN || url.pathname !== expectedPath || url.username || url.password || url.hash
      || [...url.searchParams.keys()].some(key => /token|secret|authorization/i.test(key))) throw new CanvasError('pagination');
  return url;
}
function nextPage(header) {
  if (!header) return null;
  const entries = [...header.matchAll(/<([^>]+)>\s*((?:;\s*[^,]+)*)/g)];
  const next = entries.filter(([, , attributes]) => /;\s*rel\s*=\s*"?next"?(?:\s*;|\s*$)/i.test(attributes));
  if (next.length > 1 || (/\bnext\b/i.test(header) && next.length === 0)) throw new CanvasError('pagination');
  return next[0]?.[1] || null;
}
async function jsonArray(response) {
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new CanvasError('response');
  const reader = response.body?.getReader();
  if (!reader) throw new CanvasError('response');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new CanvasError('limit'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(data)) throw new CanvasError('response');
    return data;
  } catch (error) { throw error instanceof CanvasError ? error : new CanvasError('response'); }
}
export async function fetchCanvasSnapshot({ token, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => new Date(), requestLimit = 45 } = {}) {
  if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) throw new CanvasError('configuration');
  let requests = 0;
  const deadline = Date.now() + 120_000;
  async function get(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (++requests > requestLimit || Date.now() >= deadline) throw new CanvasError('limit');
      let response;
      try {
        response = await fetchImpl(url.href, {
          method: 'GET', redirect: 'manual',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json+canvas-string-ids' },
          signal: AbortSignal.timeout(15_000),
        });
      } catch { throw new CanvasError('network'); }
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new CanvasError('redirect'); }
      if (response.status === 429 || response.status >= 500) {
        const retrySeconds = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        if (attempt === 2 || retrySeconds > 10) throw new CanvasError(response.status === 429 ? 'rate_limit' : 'unavailable');
        await sleep(Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds * 1000 : 500 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new CanvasError(response.status === 401 ? 'authentication' : response.status === 403 ? 'forbidden' : 'response');
      }
      return response;
    }
  }
  async function list(path, parameters) {
    const initial = new URL(path, CANVAS_ORIGIN);
    for (const [key, value] of parameters) initial.searchParams.append(key, value);
    initial.searchParams.set('per_page', '100');
    const visited = new Set(), items = [];
    let next = initial.href;
    while (next) {
      const url = safePage(next, path);
      // Pagination must retain the current-user submission and enrollment filters.
      for (const [key, value] of parameters) url.searchParams.set(key, value);
      if (visited.has(url.href) || visited.size >= 20) throw new CanvasError('pagination');
      visited.add(url.href);
      const response = await get(url);
      const following = nextPage(response.headers.get('link'));
      items.push(...await jsonArray(response));
      if (items.length > 5000) throw new CanvasError('limit');
      next = following;
    }
    return items;
  }
  const courses = await list('/api/v1/courses', [['enrollment_type', 'student'], ['enrollment_state', 'active'], ['state[]', 'available']]);
  const items = new Map(), courseIds = new Set();
  for (const course of courses) {
    const id = canvasId(course?.id);
    if (courseIds.has(id)) continue;
    courseIds.add(id);
    const assignments = await list(`/api/v1/courses/${id}/assignments`, [['include[]', 'submission'], ['override_assignment_dates', 'true']]);
    for (const raw of assignments) {
      if (raw?.published === false || raw?.submission?.assignment_visible === false) continue;
      const normalized = normalizeAssignment(raw, course);
      items.set(normalized.id, normalized);
      if (items.size > 5000) throw new CanvasError('limit');
    }
  }
  return { version: 1, origin: CANVAS_ORIGIN, fetchedAt: now().toISOString(), courseCount: courseIds.size, items: [...items.values()] };
}
