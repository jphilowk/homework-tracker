export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validAssignment(item) {
  return item && typeof item.id === 'string' && typeof item.title === 'string' && item.title.trim().length > 0 && typeof item.className === 'string' && item.className.trim().length > 0 && typeof item.done === 'boolean' && /^\d{4}-\d{2}-\d{2}$/.test(item.due) && localDate(new Date(item.due + 'T12:00:00')) === item.due;
}
export function selectAssignments(items, { status = 'all', className = '', search = '', today = localDate() } = {}) {
  return items.filter(a => (!className || a.className === className) && `${a.title} ${a.className}`.toLowerCase().includes(search.toLowerCase()) && (status === 'all' || (status === 'open' && !a.done) || (status === 'done' && a.done) || (status === 'overdue' && !a.done && a.due < today)))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}
