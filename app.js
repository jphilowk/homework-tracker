import { localDate, validAssignment, selectAssignments } from './model.js';
import { STATE_KEY, loadState, saveState, initialState, mergeCanvas, removeAssignment, restoreAssignment, importBackup, SCHOOL_TIME_ZONE, schoolDate } from './canvas-state.js';
const $ = id => document.getElementById(id);
let savedState = initialState();
let assignments = [], editingId = null, status = 'all', deleted = null, noticeTimer;
let storageBlocked = false;
const connected = document.querySelector('meta[name="daybook-mode"]').content === 'connected';
let syncing = false, lastRefresh = 0;
try {
  savedState = loadState(localStorage);
  assignments = savedState.assignments;
} catch {
  storageBlocked = true;
  $('form-error').textContent = 'Saved assignments could not be read. Allow browser storage or try another browser before adding work.';
}
function persist(next, state = savedState) {
  if (storageBlocked) return false;
  try { const updated = { ...state, assignments: next }; saveState(localStorage, updated); savedState = updated; assignments = next; return true; }
  catch { $('form-error').textContent = 'Your change could not be saved. Check that browser storage is enabled and has space, then try again.'; return false; }
}
function notify(message, undo = false) {
  if (deleted && !undo) return; // Keep the deletion's undo opportunity through sync.
  clearTimeout(noticeTimer); $('notice-text').textContent = message; $('undo-button').hidden = !undo; $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; deleted = null; }, undo ? 12000 : 4500);
}
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function resetForm() { $('edit-note').hidden = true; editingId = null; $('assignment-form').reset(); $('form-heading').textContent = 'New assignment'; $('save-button').replaceChildren(document.createTextNode('Add assignment'), element('span', '', '＋')); $('cancel-edit').hidden = true; if (!storageBlocked) $('form-error').textContent = ''; }
function render() {
  const today = connected ? schoolDate() : localDate();
  $('today').textContent = new Date().toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  const done = assignments.filter(a => a.done).length;
  const overdue = assignments.filter(a => !a.done && a.due < today).length;
  const total = assignments.length;
  $('total-count').textContent = total; $('all-count').textContent = total; $('open-count').textContent = total - done; $('done-count').textContent = done; $('overdue-count').textContent = overdue;
  const percent = total ? Math.round(done / total * 100) : 0;
  $('progress-fraction').textContent = `${done} of ${total} done`;
  $('progress-number').textContent = total ? `${percent}% complete` : 'A fresh start.';
  $('progress-fill').style.width = `${percent}%`;
  document.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', percent);
  $('progress-copy').textContent = !total ? 'Add your first assignment to get going.' : done === total ? 'All caught up. Enjoy a little breathing room.' : `${total - done} assignment${total - done === 1 ? '' : 's'} left. One step at a time.`;
  const classFilter = $('class-filter').value;
  const classes = [...new Set(assignments.map(a => a.className))].sort((a,b) => a.localeCompare(b));
  $('class-filter').replaceChildren(new Option('All classes', ''), ...classes.map(c => new Option(c, c)));
  $('class-filter').value = classes.includes(classFilter) ? classFilter : '';
  $('class-suggestions').replaceChildren(...classes.map(c => new Option(c, c)));
  const visible = selectAssignments(assignments, { status, className: $('class-filter').value, search: $('search').value, today });
  $('assignment-list').replaceChildren(...visible.map(a => {
    const row = element('article', `assignment-row${a.done ? ' completed' : ''}`);
    const checkbox = element('input', 'task-check'); checkbox.type = 'checkbox'; checkbox.checked = a.done; checkbox.setAttribute('aria-label', `Mark ${a.title} as ${a.done ? 'to do' : 'completed'}`);
    checkbox.addEventListener('change', () => { if (persist(assignments.map(item => item.id === a.id ? {...item, done: checkbox.checked, ...(item.source === 'canvas' ? {completionOverride: checkbox.checked} : {})} : item))) { render(); notify(checkbox.checked ? 'Assignment completed. Nice work!' : 'Assignment marked to do.'); } else checkbox.checked = a.done; });
    const info = element('div'); info.append(element('h3','task-title',a.title),element('span','class-badge',a.className));
    if (a.source === 'canvas') {
      const link = element('a', 'canvas-badge', 'Canvas'); link.href = a.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Open ${a.title} in Canvas`); info.append(link);
      const labels = [];
      if (a.availability === 'missing') labels.push('No longer listed in active Canvas courses; kept here.');
      if (a.availability === 'no_due_date') labels.push('Canvas removed the due date; showing the last known date.');
      if (a.submission === 'resubmit') labels.push('Canvas requests resubmission.');
      if (a.submission === 'excused') labels.push('Excused in Canvas.');
      if (labels.length) info.append(element('p', 'canvas-warning', labels.join(' ')));
    }
    const due = element('div', `due-label${!a.done && a.due < today ? ' late' : !a.done && a.due === today ? ' today' : ''}`, new Date(a.due + 'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric', ...(a.due.slice(0,4) !== today.slice(0,4) ? {year:'numeric'} : {})}));
    due.append(element('small','',a.done ? 'Completed' : a.due < today ? 'Overdue' : a.due === today ? 'Due today' : 'Upcoming'));
    if (a.source === 'canvas' && a.dueAt) due.title = new Date(a.dueAt).toLocaleString(undefined, {timeZone: SCHOOL_TIME_ZONE, timeZoneName: 'short'});
    const actions = element('div', 'row-actions');
    const edit = element('button','icon-button','✎'); edit.type='button'; edit.setAttribute('aria-label',`Edit ${a.title}`); edit.title='Edit assignment';
    edit.addEventListener('click',() => { editingId=a.id; $('title').value=a.title; $('class-name').value=a.className; $('due').value=a.due; $('completion').value=a.done?'done':'open'; $('form-heading').textContent='Edit assignment'; $('save-button').textContent='Save changes'; $('cancel-edit').hidden=false; $('edit-note').hidden=a.source!=='canvas'; $('title').focus(); });
    const remove = element('button','icon-button','×'); remove.type='button'; remove.setAttribute('aria-label',`Delete ${a.title}`); remove.title='Delete assignment';
    remove.addEventListener('click',() => { const next = removeAssignment(savedState, a.id); if (persist(next.assignments, next)) { deleted=a; if(editingId===a.id) resetForm(); render(); notify('Assignment deleted.',true); } });
    actions.append(edit, remove); row.append(checkbox,info,due,actions); return row;
  }));
  $('empty-state').hidden = visible.length > 0;
  $('empty-state').querySelector('h3').textContent = total ? 'No assignments here.' : 'A clean page, a clear head.';
  $('empty-state').querySelector('p').textContent = total ? 'Try another filter or search to find your assignments.' : 'Use the new assignment form to add your first task. Your next steps will show up right here.';
  $('list-summary').textContent = total ? `${visible.length} of ${total} assignment${total===1?'':'s'} shown · Soonest due first` : 'No assignments yet';
  $('last-sync').textContent = savedState.lastCanvasSync ? `Last successful Canvas sync: ${new Date(savedState.lastCanvasSync).toLocaleString()}` : 'Canvas has not synced yet.';
}
$('assignment-form').addEventListener('submit',event => {
  event.preventDefault();
  const previous = assignments.find(a => a.id === editingId);
  const assignment = {...previous,id:editingId || crypto.randomUUID(),title:$('title').value.trim(),className:$('class-name').value.trim(),due:$('due').value,done:$('completion').value==='done'};
  if (previous?.source === 'canvas' && assignment.done !== previous.done) assignment.completionOverride = assignment.done;
  if (!validAssignment(assignment)) { $('form-error').textContent='Enter an assignment, a class, and a valid due date.'; return; }
  const wasEditing = Boolean(editingId);
  if (persist(editingId ? assignments.map(a=>a.id===editingId?assignment:a) : [...assignments,assignment])) {
    resetForm(); status='all'; $('search').value=''; $('class-filter').value=''; syncTabs(); render(); notify(wasEditing?'Assignment updated.':'Assignment added.'); $('title').focus();
  }
});
function syncTabs() { document.querySelectorAll('[data-status]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.status===status))); }
document.querySelectorAll('[data-status]').forEach(button=>button.addEventListener('click',()=>{status=button.dataset.status;syncTabs();render();}));
$('class-filter').addEventListener('change',render); $('search').addEventListener('input',render); $('cancel-edit').addEventListener('click',resetForm);
$('undo-button').addEventListener('click',()=>{ if (!deleted) return; const next = restoreAssignment(savedState, deleted); if (persist(next.assignments, next)) {deleted=null;render();notify('Assignment restored.');} });
window.addEventListener('storage',event=>{if(event.key===STATE_KEY || event.key===null) {try {savedState=loadState(localStorage);assignments=savedState.assignments;resetForm();render();}catch{storageBlocked=true;$('form-error').textContent='Saved data changed in another tab and could not be read. Reload before making changes.';}}});
const syncMessages = {
  busy: 'Canvas was checked recently or a sync is running. Try again in two minutes.',
  configuration: 'Canvas connection needs setup. Your saved assignments are still available.',
  authentication: 'Your Canvas token expired or was revoked. It needs to be replaced securely.',
  forbidden: 'Canvas denied access. Your saved assignments have not been removed.',
  rate_limit: 'Canvas is busy. Try syncing again later.',
  sign_in_required: 'Your session needs sign-in. Reload this page to sign in again.',
  not_authorized: 'This account is not authorized to sync this Daybook.',
};
async function refreshCanvas(manual = false) {
  if (!connected || syncing || storageBlocked) return;
  syncing = true; lastRefresh = Date.now(); $('sync-canvas').disabled = true;
  $('sync-canvas').textContent = manual ? 'Syncing…' : 'Checking…';
  $('canvas-message').textContent = manual ? 'Checking Canvas for assignment updates…' : 'Loading your latest Canvas assignments…';
  try {
    const result = await fetch(manual ? './api/canvas/sync' : './api/canvas/status', {
      method: manual ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      ...(manual ? {headers:{'X-Daybook-Request':'sync'}} : {}), signal: AbortSignal.timeout(150000),
    });
    if (!(result.headers.get('content-type') || '').includes('application/json')) throw new Error('sign_in_required');
    const data = await result.json();
    if (!result.ok) throw new Error(Object.hasOwn(syncMessages,data.error) ? data.error : 'network');
    if (data.snapshot) {
      // Read again after the network wait so edits/deletions in other tabs survive.
      const latest = loadState(localStorage), merged = mergeCanvas(latest, data.snapshot);
      if (!persist(merged.assignments, merged)) throw new Error('storage');
      render();
    }
    $('canvas-message').textContent = data.configured === false ? syncMessages.configuration
      : data.error ? (syncMessages[data.error] || 'The last Canvas check failed. Showing the last saved assignments.')
      : data.syncing ? 'A Canvas sync is running. Check again shortly.'
      : data.snapshot ? 'Canvas is up to date. Due dates use your school’s Central time.' : 'Ready to import. Choose Sync Canvas.';
    if (manual) notify('Canvas assignments synced.');
  } catch (error) {
    $('canvas-message').textContent = syncMessages[error.message] || (error.message === 'storage'
      ? 'Canvas was checked, but this browser could not save the update. Free storage and try again.'
      : 'Could not reach Canvas. Your saved list is unchanged. Try again, or reload to sign in.');
  } finally { syncing = false; $('sync-canvas').disabled = false; $('sync-canvas').textContent = 'Sync Canvas'; }
}
$('sync-canvas').addEventListener('click', () => refreshCanvas(true));
$('export-data').addEventListener('click', () => {
  if (storageBlocked) { notify('Saved data could not be read. Reload before exporting.'); return; }
  const blob = new Blob([JSON.stringify(savedState, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob), link = element('a');
  link.href=url;link.download=`daybook-backup-${localDate()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify('Backup downloaded. Keep it private; it contains your assignments.');
});
$('import-data').addEventListener('click', () => $('backup-file').click());
$('backup-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || storageBlocked) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error();
    const content = JSON.parse(await file.text()), latest = loadState(localStorage);
    const merged = importBackup(latest, content);
    // Keep a recovery copy of this origin's state before merging a backup.
    localStorage.setItem('daybook.before-import.v2', JSON.stringify(latest));
    if (!persist(merged.assignments, merged)) throw new Error();
    render(); notify('Backup imported. Existing assignments were kept.');
  } catch { notify('Could not import this backup. Use a valid Daybook JSON file and check browser storage.'); }
  finally { event.target.value=''; }
});
window.addEventListener('focus', () => {render();if(Date.now()-lastRefresh>60000)refreshCanvas();});
setInterval(() => {if(document.visibilityState==='visible')refreshCanvas();},300000);
$('sync-canvas').disabled = !connected;
if (connected) {
  $('canvas-message').textContent='Loading your Canvas connection…';
  $('canvas-migration-note').textContent='Your manual list stays in this browser. Import a backup to bring assignments from the original Daybook site.';
}
render();
refreshCanvas();
