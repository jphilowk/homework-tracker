import { localDate, validAssignment, selectAssignments } from './model.js';
const $ = id => document.getElementById(id);
const storageKey = 'daybook.assignments.v1';
let assignments = [], editingId = null, status = 'all', deleted = null, noticeTimer;
let storageBlocked = false;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (!Array.isArray(saved) || !saved.every(validAssignment)) throw new Error('Invalid saved data');
  assignments = saved;
} catch {
  storageBlocked = true;
  $('form-error').textContent = 'Saved assignments could not be read. Allow browser storage or try another browser before adding work.';
}
function persist(next) {
  if (storageBlocked) return false;
  try { localStorage.setItem(storageKey, JSON.stringify(next)); assignments = next; return true; }
  catch { $('form-error').textContent = 'Your change could not be saved. Check that browser storage is enabled and has space, then try again.'; return false; }
}
function notify(message, undo = false) {
  clearTimeout(noticeTimer); $('notice-text').textContent = message; $('undo-button').hidden = !undo; $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; deleted = null; }, undo ? 12000 : 4500);
}
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function resetForm() { editingId = null; $('assignment-form').reset(); $('form-heading').textContent = 'New assignment'; $('save-button').replaceChildren(document.createTextNode('Add assignment'), element('span', '', '＋')); $('cancel-edit').hidden = true; if (!storageBlocked) $('form-error').textContent = ''; }
function render() {
  const today = localDate();
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
    checkbox.addEventListener('change', () => { if (persist(assignments.map(item => item.id === a.id ? {...item, done: checkbox.checked} : item))) { render(); notify(checkbox.checked ? 'Assignment completed. Nice work!' : 'Assignment marked to do.'); } else checkbox.checked = a.done; });
    const info = element('div'); info.append(element('h3','task-title',a.title),element('span','class-badge',a.className));
    const due = element('div', `due-label${!a.done && a.due < today ? ' late' : !a.done && a.due === today ? ' today' : ''}`, new Date(a.due + 'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric', ...(a.due.slice(0,4) !== today.slice(0,4) ? {year:'numeric'} : {})}));
    due.append(element('small','',a.done ? 'Completed' : a.due < today ? 'Overdue' : a.due === today ? 'Due today' : 'Upcoming'));
    const actions = element('div', 'row-actions');
    const edit = element('button','icon-button','✎'); edit.type='button'; edit.setAttribute('aria-label',`Edit ${a.title}`); edit.title='Edit assignment';
    edit.addEventListener('click',() => { editingId=a.id; $('title').value=a.title; $('class-name').value=a.className; $('due').value=a.due; $('completion').value=a.done?'done':'open'; $('form-heading').textContent='Edit assignment'; $('save-button').textContent='Save changes'; $('cancel-edit').hidden=false; $('title').focus(); });
    const remove = element('button','icon-button','×'); remove.type='button'; remove.setAttribute('aria-label',`Delete ${a.title}`); remove.title='Delete assignment';
    remove.addEventListener('click',() => { if (persist(assignments.filter(item => item.id !== a.id))) { deleted=a; if(editingId===a.id) resetForm(); render(); notify('Assignment deleted.',true); } });
    actions.append(edit, remove); row.append(checkbox,info,due,actions); return row;
  }));
  $('empty-state').hidden = visible.length > 0;
  $('empty-state').querySelector('h3').textContent = total ? 'No assignments here.' : 'A clean page, a clear head.';
  $('empty-state').querySelector('p').textContent = total ? 'Try another filter or search to find your assignments.' : 'Use the new assignment form to add your first task. Your next steps will show up right here.';
  $('list-summary').textContent = total ? `${visible.length} of ${total} assignment${total===1?'':'s'} shown · Soonest due first` : 'No assignments yet';
}
$('assignment-form').addEventListener('submit',event => {
  event.preventDefault();
  const assignment = {id:editingId || crypto.randomUUID(),title:$('title').value.trim(),className:$('class-name').value.trim(),due:$('due').value,done:$('completion').value==='done'};
  if (!validAssignment(assignment)) { $('form-error').textContent='Enter an assignment, a class, and a valid due date.'; return; }
  const wasEditing = Boolean(editingId);
  if (persist(editingId ? assignments.map(a=>a.id===editingId?assignment:a) : [...assignments,assignment])) {
    resetForm(); status='all'; $('search').value=''; $('class-filter').value=''; syncTabs(); render(); notify(wasEditing?'Assignment updated.':'Assignment added.'); $('title').focus();
  }
});
function syncTabs() { document.querySelectorAll('[data-status]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.status===status))); }
document.querySelectorAll('[data-status]').forEach(button=>button.addEventListener('click',()=>{status=button.dataset.status;syncTabs();render();}));
$('class-filter').addEventListener('change',render); $('search').addEventListener('input',render); $('cancel-edit').addEventListener('click',resetForm);
$('undo-button').addEventListener('click',()=>{ if(deleted && persist([...assignments,deleted])) {deleted=null;render();notify('Assignment restored.');} });
window.addEventListener('storage',event=>{if(event.key===storageKey || event.key===null) {try {const next=JSON.parse(event.newValue||'[]');if(!Array.isArray(next)||!next.every(validAssignment)) return;assignments=next;resetForm();render();}catch{}}});
window.addEventListener('focus', render);
render();
