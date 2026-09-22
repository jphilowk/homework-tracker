const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://localhost:4173');
  await page.screenshot({path:'tests/desktop-empty.png',fullPage:true});
  assert.equal(await page.locator('#empty-state').isVisible(),true);
  async function add(title, className, due, status='open') {
    await page.locator('#title').fill(title); await page.locator('#class-name').fill(className); await page.locator('#due').fill(due); await page.locator('#completion').selectOption(status); await page.locator('#save-button').click();
  }
  await add('Read chapter 4','English literature','2026-09-24');
  await add('Quadratic equations','Mathematics','2026-09-21');
  await add('Lab report','Biology','2026-09-25','done');
  assert.equal(await page.locator('.assignment-row').count(),3);
  await page.reload(); assert.equal(await page.locator('.assignment-row').count(),3);
  await page.getByRole('checkbox',{name:'Mark Read chapter 4 as completed',exact:true}).click();
  assert.equal(await page.locator('#done-count').textContent(),'2');
  await page.locator('[data-status="done"]').click(); assert.equal(await page.locator('.assignment-row').count(),2);
  await page.locator('[data-status="all"]').click();
  await page.locator('#class-filter').selectOption('Mathematics'); assert.equal(await page.locator('.assignment-row').count(),1);
  await page.locator('#class-filter').selectOption('');
  await page.locator('#search').fill('chapter'); assert.equal(await page.locator('.assignment-row').count(),1);
  await page.locator('#search').fill('');
  await page.getByRole('button',{name:'Edit Read chapter 4',exact:true}).click();
  await page.locator('#title').fill('Read chapters 4–5'); await page.locator('#completion').selectOption('open'); await page.locator('#save-button').click();
  assert.equal(await page.getByRole('heading',{name:'Read chapters 4–5',exact:true}).count(),1);
  await page.getByRole('button',{name:'Delete Lab report',exact:true}).click(); assert.equal(await page.locator('.assignment-row').count(),2);
  await page.locator('#undo-button').click(); assert.equal(await page.locator('.assignment-row').count(),3);
  await add('<img src=x onerror=alert(1)>','Safety test','2026-09-28');
  assert.equal(await page.locator('.task-title img').count(),0);
  await page.getByRole('button',{name:'Delete <img src=x onerror=alert(1)>',exact:true}).click();
  await page.locator('#notice').evaluate(node=>node.hidden=true);
  await page.screenshot({path:'tests/desktop-populated.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:'tests/mobile.png',fullPage:true});
  await add('Mobile assignment','History','2026-09-30');
  await page.reload(); assert.equal(await page.locator('.assignment-row').count(),4);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: add, reload persistence, completion, filters, search, editing, deletion, undo, safe text, mobile layout and mobile entry. No browser errors.');
} finally { await browser.close(); }
