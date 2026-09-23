import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, mergeCanvas, retainCanvasHistory, schoolDate, removeAssignment, restoreAssignment, importBackup, loadState, saveState, STATE_KEY, LEGACY_KEY } from '../canvas-state.js';

const manual = {id:'manual-1',title:'My reading',className:'English',due:'2026-09-26',done:true};
const item = {id:'canvas:naperville:41:72',source:'canvas',origin:'https://naperville.instructure.com',courseId:'41',assignmentId:'72',title:'Example worksheet',className:'Example science',dueAt:'2026-09-25T04:59:00.000Z',url:'https://naperville.instructure.com/courses/41/assignments/72',submission:'unknown'};
const snapshot = (items=[item], fetchedAt='2026-09-23T12:00:00Z') => ({version:1,origin:item.origin,fetchedAt,items});
const later = items => snapshot(items, '2026-09-23T14:00:00Z');
function memoryStorage() {const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}

test('imports once by Canvas identity and preserves unrelated manual work',()=>{
  const first=mergeCanvas(initialState([manual]),snapshot());
  assert.equal(first.assignments.length,2);assert.deepEqual(first.assignments[0],manual);
  assert.equal(first.assignments[1].done,false);assert.equal(first.assignments[1].due,'2026-09-24');
  assert.equal(mergeCanvas(first,later([item])).assignments.length,2);
});
test('updates title, class and personalized due date without duplicating',()=>{
  const first=mergeCanvas(initialState(),snapshot());
  const next=mergeCanvas(first,later([{...item,title:'Revised task',className:'New class name',dueAt:'2026-09-27T04:59:00Z'}]));
  assert.equal(next.assignments.length,1);assert.equal(next.assignments[0].title,'Revised task');assert.equal(next.assignments[0].due,'2026-09-26');
});
test('completion evidence is conservative and explicit user choices survive sync',()=>{
  let state=mergeCanvas(initialState(),snapshot([{...item,submission:'submitted'}]));assert.equal(state.assignments[0].done,true);
  assert.equal(mergeCanvas(state,later([item])).assignments[0].done,true);
  assert.equal(mergeCanvas(state,later([{...item,submission:'resubmit'}])).assignments[0].done,false);
  state.assignments[0].completionOverride=false;state.assignments[0].done=false;
  assert.equal(mergeCanvas(state,later([{...item,submission:'submitted'}])).assignments[0].done,false);
  state.assignments[0].completionOverride=true;state.assignments[0].done=true;
  assert.equal(mergeCanvas(state,later([{...item,submission:'resubmit'}])).assignments[0].done,true);
  assert.equal(mergeCanvas(initialState(),snapshot([{...item,submission:'excused'}])).assignments[0].done,false);
});
test('retains missing assignments and last known dates; does not add new undated assignments',()=>{
  const first=mergeCanvas(initialState(),snapshot());
  const missing=mergeCanvas(first,later([]));assert.equal(missing.assignments[0].availability,'missing');
  const undated=mergeCanvas(first,later([{...item,dueAt:null}]));assert.equal(undated.assignments[0].due,'2026-09-24');assert.equal(undated.assignments[0].availability,'no_due_date');
  assert.equal(mergeCanvas(initialState(),snapshot([{...item,dueAt:null}])).assignments.length,0);
});
test('server snapshot retains records even if browser was closed when Canvas removed them',()=>{
  const old=snapshot();const kept=retainCanvasHistory(old,later([]));
  assert.equal(kept.items[0].availability,'missing');
  assert.equal(mergeCanvas(initialState(),kept).assignments.length,1);
  const undated=retainCanvasHistory(old,later([{...item,dueAt:null}]));
  assert.equal(undated.items[0].dueAt,item.dueAt);assert.equal(undated.items[0].availability,'no_due_date');
  const recovered=retainCanvasHistory(undated,snapshot([item],'2026-09-23T16:00:00Z'));assert.equal(recovered.items[0].availability,'available');
});
test('deletion survives future syncs and undo restores the import',()=>{
  const first=mergeCanvas(initialState([manual]),snapshot());const removed=removeAssignment(first,item.id);
  assert.equal(mergeCanvas(removed,later([item])).assignments.length,1);
  const restored=restoreAssignment(removed,first.assignments[1]);assert.equal(restored.dismissed.length,0);assert.equal(restored.assignments.length,2);
});
test('invalid or stale snapshots never change saved assignments or last-success time',()=>{
  const first=mergeCanvas(initialState([manual]),snapshot());const copy=structuredClone(first);
  for(const bad of [{...snapshot(),items:[item,item]},snapshot([{...item,url:'javascript:alert(1)'}]),snapshot([{...item,dueAt:'invalid'}]),{...snapshot(),version:9}])assert.throws(()=>mergeCanvas(first,bad));
  assert.deepEqual(first,copy);assert.equal(mergeCanvas(first,snapshot([], '2026-09-22T12:00:00Z')),first);
  assert.throws(()=>mergeCanvas(initialState([{...manual,id:item.id}]),snapshot()));
});
test('uses Central time across UTC midnight and daylight saving transitions',()=>{
  assert.equal(schoolDate('2026-09-25T04:59:00Z'),'2026-09-24');
  assert.equal(schoolDate('2026-12-25T05:59:00Z'),'2026-12-24');
  assert.equal(schoolDate('2026-03-08T07:30:00Z'),'2026-03-08');
  assert.equal(schoolDate('2026-11-01T07:30:00Z'),'2026-11-01');
});
test('v1 migration preserves the original local data and v2 reload preserves all metadata',()=>{
  const storage=memoryStorage();const legacy=JSON.stringify([manual]);storage.setItem(LEGACY_KEY,legacy);
  const loaded=loadState(storage);assert.deepEqual(loaded.assignments,[manual]);
  const merged=removeAssignment(mergeCanvas(loaded,snapshot()),item.id);saveState(storage,merged);
  assert.deepEqual(loadState(storage),merged);assert.equal(storage.getItem(LEGACY_KEY),legacy);assert.ok(storage.getItem(STATE_KEY));
});
test('malformed saved data is rejected; failed writes do not replace prior saved state',()=>{
  const storage=memoryStorage();saveState(storage,initialState([manual]));const before=storage.getItem(STATE_KEY);
  assert.throws(()=>saveState({setItem(){throw new Error('Quota');}},mergeCanvas(initialState(),snapshot())));
  assert.equal(storage.getItem(STATE_KEY),before);
  storage.setItem(STATE_KEY,'broken');assert.throws(()=>loadState(storage));
});
test('backup import is additive, repeatable, and respects current deletions',()=>{
  const state=initialState([manual]);const backup=mergeCanvas(initialState([{...manual,title:'Older reading'}]),snapshot());
  const merged=importBackup(state,backup);assert.equal(merged.assignments.length,2);assert.equal(merged.assignments[0].title,manual.title);
  assert.deepEqual(importBackup(merged,backup),merged);
  const removed=removeAssignment(merged,item.id);assert.equal(importBackup(removed,backup).assignments.length,1);
  assert.throws(()=>importBackup(state,{assignments:[],version:99}));
});
