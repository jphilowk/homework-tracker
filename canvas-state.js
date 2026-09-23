import { validAssignment } from './model.js';

export const CANVAS_ORIGIN = 'https://naperville.instructure.com';
export const SCHOOL_TIME_ZONE = 'America/Chicago';
export const STATE_KEY = 'daybook.state.v2';
export const LEGACY_KEY = 'daybook.assignments.v1';
const identityPattern = /^canvas:naperville:[1-9]\d*:[1-9]\d*$/;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const fail = () => { throw new Error('Invalid Daybook data. Your saved list has not been changed.'); };

export function schoolDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = key => parts.find(part => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validateCanvasItem(item) {
  return Boolean(item && item.source === 'canvas' && item.origin === CANVAS_ORIGIN
    && /^[1-9]\d*$/.test(item.courseId) && /^[1-9]\d*$/.test(item.assignmentId)
    && item.id === `canvas:naperville:${item.courseId}:${item.assignmentId}`
    && item.url === `${CANVAS_ORIGIN}/courses/${item.courseId}/assignments/${item.assignmentId}`
    && typeof item.title === 'string' && item.title.trim() && item.title.length <= 2000
    && typeof item.className === 'string' && item.className.trim() && item.className.length <= 2000
    && (item.dueAt === null || timestamp(item.dueAt))
    && ['submitted', 'unknown', 'excused', 'resubmit'].includes(item.submission)
    && (item.availability === undefined || ['available', 'missing', 'no_due_date'].includes(item.availability)));
}
export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || snapshot.origin !== CANVAS_ORIGIN || !timestamp(snapshot.fetchedAt)
      || !Array.isArray(snapshot.items) || snapshot.items.length > 10000 || !snapshot.items.every(validateCanvasItem)
      || new Set(snapshot.items.map(item => item.id)).size !== snapshot.items.length) fail();
  return snapshot;
}
export function validateState(state) {
  if (!state || state.version !== 2 || !Array.isArray(state.assignments) || !Array.isArray(state.dismissed)
      || state.assignments.length > 20000 || state.dismissed.length > 20000
      || !state.assignments.every(item => validAssignment(item) && (item.source !== 'canvas' || (validateCanvasItem(item)
        && (item.completionOverride == null || typeof item.completionOverride === 'boolean'))))
      || !state.dismissed.every(id => typeof id === 'string' && identityPattern.test(id))
      || new Set(state.assignments.map(item => item.id)).size !== state.assignments.length
      || (state.lastCanvasSync !== null && !timestamp(state.lastCanvasSync))) fail();
  return state;
}
export function initialState(assignments = []) {
  return validateState({ version: 2, assignments, dismissed: [], lastCanvasSync: null });
}
export function loadState(storage) {
  const current = storage.getItem(STATE_KEY);
  if (current !== null) return validateState(JSON.parse(current));
  // The legacy key remains untouched as a recovery copy. First save writes v2.
  return initialState(JSON.parse(storage.getItem(LEGACY_KEY) || '[]'));
}
export function saveState(storage, state) {
  validateState(state);
  // Assignments, dismissals, and sync timestamp succeed or fail as one write.
  storage.setItem(STATE_KEY, JSON.stringify(state));
}
export function retainCanvasHistory(previous, current) {
  validateSnapshot(current);
  if (!previous) return { ...current, items: current.items.map(item => ({ ...item, availability: item.dueAt ? 'available' : 'no_due_date' })) };
  validateSnapshot(previous);
  const seen = new Set(current.items.map(item => item.id));
  const old = new Map(previous.items.map(item => [item.id, item]));
  return { ...current, items: [
    ...current.items.map(item => ({ ...item, dueAt: item.dueAt || old.get(item.id)?.dueAt || null, availability: item.dueAt ? 'available' : 'no_due_date' })),
    ...previous.items.filter(item => !seen.has(item.id)).map(item => ({ ...item, availability: 'missing' })),
  ] };
}
export function mergeCanvas(state, snapshot) {
  validateState(state); validateSnapshot(snapshot);
  if (state.lastCanvasSync && Date.parse(snapshot.fetchedAt) <= Date.parse(state.lastCanvasSync)) return state;
  const incoming = new Map(snapshot.items.map(item => [item.id, item]));
  const existing = new Set(state.assignments.map(item => item.id));
  const dismissed = new Set(state.dismissed);
  function merge(previous, item) {
    const availability = item.availability || (item.dueAt ? 'available' : 'no_due_date');
    const override = previous?.completionOverride ?? null;
    const evidence = item.submission;
    const done = override ?? (evidence === 'submitted' ? true : evidence === 'resubmit' ? false : previous?.done || false);
    return { ...previous, ...item, dueAt: item.dueAt || previous?.dueAt || null,
      due: item.dueAt ? schoolDate(item.dueAt) : previous.due,
      done, completionOverride: override, availability };
  }
  const assignments = state.assignments.map(previous => {
    if (previous.source !== 'canvas') {
      if (incoming.has(previous.id)) fail(); // Never replace unrelated local work.
      return previous;
    }
    const item = incoming.get(previous.id);
    return item ? merge(previous, item) : { ...previous, availability: 'missing' };
  });
  for (const item of snapshot.items) {
    if (!existing.has(item.id) && !dismissed.has(item.id) && item.dueAt) assignments.push(merge(null, item));
  }
  return validateState({ ...state, assignments, lastCanvasSync: snapshot.fetchedAt });
}
export function removeAssignment(state, id) {
  const item = state.assignments.find(item => item.id === id);
  return { ...state, assignments: state.assignments.filter(item => item.id !== id),
    dismissed: item?.source === 'canvas' ? [...new Set([...state.dismissed, id])] : state.dismissed };
}
export function restoreAssignment(state, item) {
  return { ...state, assignments: [...state.assignments.filter(existing => existing.id !== item.id), item], dismissed: state.dismissed.filter(id => id !== item.id) };
}
export function importBackup(state, data) {
  const imported = Array.isArray(data) ? initialState(data) : validateState(data);
  const assignments = new Map(state.assignments.map(item => [item.id, item]));
  for (const item of imported.assignments) {
    if (!assignments.has(item.id) && !state.dismissed.includes(item.id)) assignments.set(item.id, item);
  }
  return validateState({ ...state, assignments: [...assignments.values()],
    dismissed: [...new Set([...state.dismissed, ...imported.dismissed])].filter(id => !assignments.has(id)),
    // Keep this origin's sync watermark. Imported items will refresh on next sync.
  });
}
