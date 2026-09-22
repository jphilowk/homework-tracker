import test from 'node:test';
import assert from 'node:assert/strict';
import {localDate, validAssignment, selectAssignments} from '../model.js';
const task = {id:'1',title:'Essay',className:'English',due:'2026-09-22',done:false};
test('validates user input and real calendar dates',()=>{assert.ok(validAssignment(task)); for(const change of [{title:' '},{className:''},{due:'2026-02-30'},{done:'false'},{due:'not a date'}]) assert.ok(!validAssignment({...task,...change}));});
test('formats local calendar dates without UTC conversion',()=>{assert.equal(localDate(new Date(2026,8,22,23,59)),'2026-09-22');});
test('sorts open assignments by due date before completed work',()=>{assert.deepEqual(selectAssignments([{...task,id:'done',done:true,due:'2026-01-01'},task,{...task,id:'early',due:'2026-09-21'}]).map(a=>a.id),['early','1','done']);});
test('combines class, text, and status filters',()=>{const items=[task,{...task,id:'2',className:'Math',title:'Worksheet'}, {...task,id:'3',done:true}];assert.deepEqual(selectAssignments(items,{className:'English',search:'ESS',status:'open'}).map(a=>a.id),['1']);assert.equal(selectAssignments(items,{status:'done'}).length,1);});
test('overdue excludes completed work and tasks due today',()=>{const items=[task,{...task,id:'2',due:'2026-09-21'}, {...task,id:'3',done:true,due:'2026-09-20'}];assert.deepEqual(selectAssignments(items,{status:'overdue',today:'2026-09-22'}).map(a=>a.id),['2']);});
