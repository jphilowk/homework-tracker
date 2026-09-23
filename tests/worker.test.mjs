import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { syncCanvas, readCanvasStatus } from '../backend/sync.mjs';
import { createWorker } from '../backend/worker.mjs';
import { CanvasError } from '../backend/canvas.mjs';

// Exercise real SQL against an isolated, in-memory database, never production D1.
function database() {
  const sql = new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_canvas.sql',import.meta.url),'utf8'));
  return {close:()=>sql.close(),prepare(query){const stmt=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return stmt.get(...args)??null;},async run(){return stmt.run(...args);}};}};
}
const snapshot={version:1,origin:'https://naperville.instructure.com',fetchedAt:'2026-09-23T12:00:00Z',items:[]};
const clock=()=>new Date('2026-09-23T12:00:00Z');
test('sync atomically saves a full snapshot and successful timestamp',async()=>{
  const db=database();try {const result=await syncCanvas({DB:db,CANVAS_TOKEN:crypto.randomUUID()},{now:clock,fetchSnapshot:async()=>snapshot});assert.equal(result.ok,true);
    const status=await readCanvasStatus(db);assert.deepEqual(status.snapshot,snapshot);assert.equal(status.lastSuccess,snapshot.fetchedAt);assert.equal(status.error,null);
  }finally{db.close();}
});
test('failed sync retains the previous snapshot and success time, exposing only a safe error code',async()=>{
  const db=database(),env={DB:db,CANVAS_TOKEN:crypto.randomUUID()};try{
    await syncCanvas(env,{now:clock,fetchSnapshot:async()=>snapshot});
    const result=await syncCanvas(env,{now:()=>new Date('2026-09-23T12:03:00Z'),fetchSnapshot:async()=>{throw new CanvasError('authentication');}});
    assert.equal(result.code,'authentication');const status=await readCanvasStatus(db);assert.deepEqual(status.snapshot,snapshot);assert.equal(status.lastSuccess,snapshot.fetchedAt);assert.equal(status.error,'authentication');
  }finally{db.close();}
});
test('concurrent and repeated requests share a lease and cooldown',async()=>{
  const db=database(),env={DB:db,CANVAS_TOKEN:crypto.randomUUID()};let finish;let calls=0;try{
    const pending=syncCanvas(env,{now:clock,fetchSnapshot:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await syncCanvas(env,{now:clock,fetchSnapshot:async()=>{calls++;return snapshot;}})).code,'busy');
    finish(snapshot);await pending;assert.equal(calls,1);
    assert.equal((await syncCanvas(env,{now:clock})).code,'busy');
  }finally{db.close();}
});
test('missing secret does not request Canvas or touch the database',async()=>{assert.equal((await syncCanvas({})).code,'configuration');});
const authenticated={access:{getIdentity:async()=>({email:'student@example.com'})}};
const env={OWNER_EMAIL:'student@example.com',CANVAS_TOKEN:crypto.randomUUID(),DB:{}};
test('worker denies unauthenticated and wrong-user access even with spoofed identity headers',async()=>{
  const worker=createWorker();
  for(const path of ['/','/app.js','/api/canvas/status','/api/canvas/sync']) {
    const response=await worker.fetch(new Request('https://daybook.example'+path,{headers:{'Cf-Access-Authenticated-User-Email':env.OWNER_EMAIL,'Cf-Access-Jwt-Assertion':'fabricated-header'}}),env,{});
    assert.equal(response.status,403);assert.match(response.headers.get('cache-control'),/no-store/);
  }
  const wrong={access:{getIdentity:async()=>({email:'other@example.com'})}};
  assert.equal((await worker.fetch(new Request('https://daybook.example/'),env,wrong)).status,403);
  assert.equal((await worker.fetch(new Request('https://daybook.example/'),{},authenticated)).status,403);
});
test('worker protects mutations against cross-origin requests and disallows CORS',async()=>{
  let calls=0;const worker=createWorker({sync:async()=>{calls++;return {ok:true};},read:async()=>({snapshot})});
  for(const headers of [{},{origin:'https://other.example','x-daybook-request':'sync'},{origin:'https://daybook.example'},{origin:'https://daybook.example','x-daybook-request':'sync','sec-fetch-site':'cross-site'}]) {
    assert.equal((await worker.fetch(new Request('https://daybook.example/api/canvas/sync',{method:'POST',headers}),env,authenticated)).status,403);
  }
  assert.equal(calls,0);
  const good=await worker.fetch(new Request('https://daybook.example/api/canvas/sync',{method:'POST',headers:{origin:'https://daybook.example','x-daybook-request':'sync'}}),env,authenticated);
  assert.equal(good.status,200);assert.equal(calls,1);assert.equal(good.headers.get('access-control-allow-origin'),null);
  assert.ok(!JSON.stringify(await good.json()).includes(env.CANVAS_TOKEN));
});
test('worker serves only allowlisted public UI sources after sign-in; no server files or secrets',async()=>{
  const worker=createWorker();
  const page=await worker.fetch(new Request('https://daybook.example/'),env,authenticated);
  assert.equal(page.status,200);assert.ok((await page.text()).includes('content="connected"'));
  for(const path of ['/backend/canvas.mjs','/.env','/wrangler.jsonc','/package-lock.json','/scripts/check-canvas.mjs'])assert.equal((await worker.fetch(new Request('https://daybook.example'+path),env,authenticated)).status,404);
});
test('worker masks unexpected failures, returns cooldowns correctly, and does not expose the secret',async()=>{
  const failing=createWorker({read:async()=>{throw Error('private server detail');}});
  const result=await failing.fetch(new Request('https://daybook.example/api/canvas/status'),env,authenticated);assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'service_unavailable'});
  const busy=createWorker({sync:async()=>({ok:false,code:'busy'})});
  assert.equal((await busy.fetch(new Request('https://daybook.example/api/canvas/sync',{method:'POST',headers:{origin:'https://daybook.example','x-daybook-request':'sync'}}),env,authenticated)).status,429);
});
test('background sync is disabled until deliberately enabled and does not depend on browser activity',async()=>{
  let calls=0;const tasks=[];const worker=createWorker({sync:async()=>{calls++;}});const ctx={waitUntil:task=>tasks.push(task)};
  await worker.scheduled({},env,ctx);assert.equal(calls,0);
  await worker.scheduled({},{...env,AUTO_SYNC_ENABLED:'true'},ctx);await Promise.all(tasks);assert.equal(calls,1);
});
