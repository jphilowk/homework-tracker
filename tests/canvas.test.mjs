import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CANVAS_ORIGIN, CanvasError, canvasTimestamp, fetchCanvasSnapshot, normalizeAssignment, safeCanvasError, submissionEvidence } from '../backend/canvas.mjs';

// Entirely fabricated fixtures. No real token or student data is used in tests.
const course = { id: '41', name: 'Example science' };
const raw = { id: '72', course_id: '41', name: 'Example worksheet', due_at: '2026-09-25T04:59:00Z', published: true };
const json = (data, headers = {}) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', ...headers } });
function setup(responses, options = {}) {
  const calls = [], delays = [], token = randomUUID();
  return { calls, delays, run: () => fetchCanvasSnapshot({
    token, now: () => new Date('2026-09-23T12:00:00Z'), sleep: async ms => { delays.push(ms); },
    fetchImpl: async (url, init) => {
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual');
      // Compare as booleans so assertion diagnostics cannot print credentials.
      assert.ok(init.headers.Authorization === `Bearer ${token}`);
      assert.equal(new URL(url).origin, CANVAS_ORIGIN);
      assert.ok(!url.includes(token)); calls.push(url);
      const next = responses.shift(); if (next instanceof Error) throw next;
      assert.ok(next, 'Unexpected extra request'); return next;
    }, ...options,
  }) };
}
test('fetches active student courses and current-user submissions, stripping private payload fields', async () => {
  const s = setup([json([course]), json([{ ...raw, description: '<p>Not stored</p>', submission: { body: 'Not stored', grade: 'A', workflow_state: 'submitted', submitted_at: '2026-09-23T10:00:00Z' } }])]);
  const result = await s.run();
  assert.equal(result.courseCount, 1); assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], { id: 'canvas:naperville:41:72', source: 'canvas', origin: CANVAS_ORIGIN, assignmentId: '72', courseId: '41', title: 'Example worksheet', className: 'Example science', dueAt: raw.due_at.replace('Z', '.000Z'), url: `${CANVAS_ORIGIN}/courses/41/assignments/72`, submission: 'submitted' });
  const first = new URL(s.calls[0]), second = new URL(s.calls[1]);
  assert.equal(first.searchParams.get('enrollment_type'), 'student');
  assert.equal(first.searchParams.get('enrollment_state'), 'active');
  assert.equal(second.searchParams.get('include[]'), 'submission');
  assert.equal(second.searchParams.get('override_assignment_dates'), 'true');
});
test('follows both course and assignment pagination; deduplicates repeated records', async () => {
  const s = setup([json([course], { link: `<${CANVAS_ORIGIN}/api/v1/courses?page=2>; rel="next"` }), json([course]), json([raw], {link:`<${CANVAS_ORIGIN}/api/v1/courses/41/assignments?page=2>; rel="next"`}), json([raw])]);
  const result = await s.run();
  assert.equal(result.courseCount, 1); assert.equal(result.items.length, 1); assert.equal(s.calls.length, 4);
  assert.equal(new URL(s.calls[1]).searchParams.get('enrollment_type'), 'student');
  assert.equal(new URL(s.calls[3]).searchParams.get('include[]'), 'submission');
});
test('rejects unsafe pagination before sending another authenticated request', async () => {
  for (const destination of ['https://other.example/api/v1/courses?page=2', 'http://naperville.instructure.com/api/v1/courses?page=2', `${CANVAS_ORIGIN}/api/v1/users`, `${CANVAS_ORIGIN}/api/v1/courses?access_token=not-a-credential`, 'https://user:pass@naperville.instructure.com/api/v1/courses']) {
    const s = setup([json([], { link: `<${destination}>; rel="next"` })]);
    await assert.rejects(s.run, { code: 'pagination' }); assert.equal(s.calls.length, 1);
  }
});
test('rejects pagination cycles and ambiguous next links', async () => {
  const initial = `${CANVAS_ORIGIN}/api/v1/courses?enrollment_type=student&enrollment_state=active&state%5B%5D=available&per_page=100`;
  await assert.rejects(setup([json([], { link: `<${initial}>; rel="next"` })]).run, { code: 'pagination' });
  await assert.rejects(setup([json([], { link: '<https://example.com>; rel="next", <https://example.org>; rel="next"' })]).run, { code: 'pagination' });
});
test('does not follow Canvas API redirects', async () => {
  const s = setup([new Response('Do not log this body', {status:302,headers:{location:'https://example.com/login'}})]);
  await assert.rejects(s.run, { code:'redirect' }); assert.equal(s.calls.length, 1);
});
test('returns safe errors for authentication, permissions, and malformed upstream responses', async () => {
  for (const [response, code] of [[new Response('private upstream content', {status:401}), 'authentication'], [new Response('private upstream content', {status:403}), 'forbidden'], [new Response('<html>Login</html>', {headers:{'content-type':'text/html'}}), 'response'], [json({errors:['private upstream content']}), 'response'], [new Response('{', {headers:{'content-type':'application/json'}}), 'response']]) {
    await assert.rejects(setup([response]).run, error => error.code === code && !error.message.includes('private upstream content'));
  }
  assert.equal(safeCanvasError(new Error('private transport content')).code,'response');
  assert.ok(!JSON.stringify(safeCanvasError(new Error('private transport content'))).includes('private transport content'));
});
test('retries a rate limit with bounded backoff, and fails persistent rate limiting safely', async () => {
  const s = setup([new Response('',{status:429,headers:{'retry-after':'1'}}),json([course]),json([raw])]);
  assert.equal((await s.run()).items.length,1); assert.deepEqual(s.delays,[1000]);
  await assert.rejects(setup(Array.from({length:3},()=>new Response('',{status:429}))).run,{code:'rate_limit'});
  const long = setup([new Response('',{status:429,headers:{'retry-after':'60'}})]);
  await assert.rejects(long.run,{code:'rate_limit'}); assert.equal(long.delays.length,0);
});
test('handles network failures, service errors and request budgets without returning partial data', async () => {
  await assert.rejects(setup([new Error('private transport details')]).run,{code:'network'});
  await assert.rejects(setup(Array.from({length:3},()=>new Response('',{status:503}))).run,{code:'unavailable'});
  await assert.rejects(setup([json([course]),json([raw])],{requestLimit:1}).run,{code:'limit'});
  await assert.rejects(setup([json([course,{id:'42',name:'Other course'}]),json([raw]),new Response('',{status:403})]).run,{code:'forbidden'});
});
test('rejects missing or whitespace-containing configuration without making requests', async () => {
  for (const token of [undefined, '', ' ', 'contains whitespace']) await assert.rejects(fetchCanvasSnapshot({token,fetchImpl:()=>{throw Error('must not fetch');}}), {code:'configuration'});
});
test('validates IDs, course association, calendar dates, and safe canonical links', () => {
  for (const id of ['../users', 1.5, 0, Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>normalizeAssignment({...raw,id},course),CanvasError);
  assert.throws(()=>normalizeAssignment({...raw,course_id:'42'},course),CanvasError);
  assert.equal(normalizeAssignment({...raw,html_url:'javascript:alert(1)'},course).url,`${CANVAS_ORIGIN}/courses/41/assignments/72`);
  assert.equal(canvasTimestamp('2026-02-30T12:00:00Z'),null);
  assert.equal(canvasTimestamp('2026-09-24'),null);
  assert.equal(canvasTimestamp('2026-09-24T23:59:00-05:00'),'2026-09-25T04:59:00.000Z');
  assert.equal(canvasTimestamp('2026-12-24T23:59:00-06:00'),'2026-12-25T05:59:00.000Z');
});
test('retains undated identity for conservative merging and skips unpublished/invisible work', async () => {
  const s=setup([json([course]),json([{...raw,due_at:null},{...raw,id:'73',published:false},{...raw,id:'74',submission:{assignment_visible:false}}])]);
  const result=await s.run();assert.equal(result.items.length,1);assert.equal(result.items[0].dueAt,null);
});
test('completion uses actual submission evidence, never a grade or another student submission', () => {
  for (const submission of [null, {}, {workflow_state:'unsubmitted'}, {workflow_state:'graded',grade:'0'}, {workflow_state:'graded',grade:'A'}, {workflow_state:'submitted',submitted_at:'invalid'}]) assert.equal(submissionEvidence(submission),'unknown');
  assert.equal(normalizeAssignment({...raw,has_submitted_submissions:true},course).submission,'unknown');
  for (const workflow_state of ['submitted','pending_review','graded']) assert.equal(submissionEvidence({workflow_state,submitted_at:'2026-09-23T10:00:00Z'}),'submitted');
  assert.equal(submissionEvidence({workflow_state:'graded',submitted_at:'2026-09-23T10:00:00Z',redo_request:true}),'resubmit');
  assert.equal(submissionEvidence({workflow_state:'graded',submitted_at:'2026-09-23T10:00:00Z',missing:true}),'unknown');
  assert.equal(submissionEvidence({excused:true}),'excused');
});
