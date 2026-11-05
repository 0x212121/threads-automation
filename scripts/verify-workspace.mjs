// Isolated browser verification: synthetic data, fake SMTP/Meta, no production database or worker.
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,writeFile,mkdir,rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import session from 'express-session';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/password.ts';
import { ContentStore } from '../src/content-store.ts';
import { TokenVault } from '../src/token-vault.ts';
import { ThreadsAccounts } from '../src/threads-accounts.ts';
import { ThreadsOAuthClient } from '../src/threads-oauth-client.ts';

const chromePath=process.env.CHROME_BINARY || ['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
if (!chromePath) throw new Error('Set CHROME_BINARY to an installed Chrome/Chromium executable.');
const db=new PGlite(),profile=await mkdtemp(join(tmpdir(),'threads-workspace-qa-'));
let browser,ws,server;
const pending=new Map(),events=[],checks=[];let counter=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  for (const file of (await readdir('db/migrations')).filter(file=>file.endsWith('.sql')).sort()) await db.exec(await readFile(`db/migrations/${file}`,'utf8'));
  const query=async(sql,params)=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length || r.affectedRows || 0};};
  const pool={query,connect:async()=>({query,release(){}})},admin=randomUUID(),editor=randomUUID(),password='workspace verification password',hash=await hashPassword(password);
  await query("INSERT INTO local_users(id,email,password_hash,role,email_verified_at,created_at) VALUES ($1,'admin@example.test',$3,'admin',now(),now()-interval '2 days'),($2,'editor@example.test',$3,'editor',now(),now()-interval '1 day')",[admin,editor,hash]);
  for (let i=0;i<51;i++) {
    await query("INSERT INTO local_users(id,email,password_hash,role,email_verified_at) VALUES ($1,$2,$3,'editor',now())",[randomUUID(),`member${i}@example.test`,hash]);
    await query("INSERT INTO team_invitations(id,email,role,token_hash,invited_by,expires_at) VALUES ($1,$2,'editor',$3,$4,now()+interval '7 days')",[randomUUID(),`invite${i}@example.test`,randomUUID(),admin]);
  }
  const vault=new TokenVault(Buffer.alloc(32,4)),accounts=new ThreadsAccounts(pool,vault);
  const account=await accounts.register(admin,{threadsUserId:'123',username:'test.account',token:'fixture-only-token',expiresAt:new Date(Date.now()+86400000)});
  const content=new ContentStore(pool),actor={id:admin,role:'admin'};
  for (let i=0;i<51;i++) await content.create(actor,{body:`Draft uji ${i+1}`,destinationAccountId:account});
  const scheduled=await content.create(actor,{body:'Jadwal uji kalender',destinationAccountId:account});
  await content.transition(actor,scheduled.id,1,'submit');await content.transition(actor,scheduled.id,2,'approve');
  const schedule=new Date(Date.now()+86400000),job=randomUUID();
  await query("INSERT INTO publication_jobs(id,post_id,content_version,account_id,requested_by,status,scheduled_at,time_zone,next_attempt_at) VALUES ($1,$2,1,$3,$4,'scheduled',$5,'Asia/Makassar',$5)",[job,scheduled.id,account,admin,schedule]);
  const longHistory=await content.create(actor,{body:'Versi uji 1',destinationAccountId:account});
  for (let version=2;version<=55;version++) await content.edit(actor,longHistory.id,version-1,{body:`Versi uji ${version}`});
  await content.create(actor,{body:'Draft untuk dihapus melalui UI',destinationAccountId:account});
  let app;
  server=createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const client=new ThreadsOAuthClient({appId:'1234',appSecret:'fixture-secret',redirectUri:'https://example.test/api/threads/oauth/callback'},async(input)=>{
    const url=new URL(String(input));
    if (url.pathname==='/oauth/access_token') return Response.json({access_token:'fixture-app-token'});
    assert.equal(url.pathname,'/debug_token');
    return Response.json({data:{is_valid:true,app_id:'1234',scopes:['threads_basic','threads_content_publish','threads_manage_replies','threads_read_replies']}});
  });
  const mail=[];
  app=await createApp({pool,store:new session.MemoryStore(),secret:'v'.repeat(48),origin,secure:false,trustProxy:false,publishingEnabled:true,threads:{client,vault},mail:{from:'test@example.test',transport:{sendMail:async message=>{mail.push(message);return {accepted:[message.to],rejected:[]};}}}});
  browser=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{
    let stderr='';const timer=setTimeout(()=>reject(new Error('Chrome did not start')),15000);
    browser.once('error',reject);browser.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{const message=JSON.parse(event.data);if (message.id) {const p=pending.get(message.id);pending.delete(message.id);if (message.error)p.reject(new Error(JSON.stringify(message.error)));else p.resolve(message.result);}else events.push(message);};
  const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));});
  const {targetId}=await command('Target.createTarget',{url:origin}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
  const cdp=(method,params)=>command(method,params,sessionId);
  await cdp('Runtime.enable');await cdp('Page.enable');
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{const end=Date.now()+10000;while(!await evaluate(expression)){if(Date.now()>end)throw new Error(`UI did not reach: ${expression}`);await delay(40);}};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const action=(container,label)=>evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(container)})).find(e=>e.textContent===${JSON.stringify(label)}).click()`);
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:'window.confirm=()=>true;'});await cdp('Page.reload');
  await until("document.querySelector('#login-screen').hidden===false");
  await evaluate(`document.querySelector('#email').value='admin@example.test';document.querySelector('#password').value=${JSON.stringify(password)};document.querySelector('#login-form').requestSubmit();`);
  await until("!document.querySelector('#workspace').hidden && document.querySelector('#loading').hidden");
  await until("document.querySelectorAll('#post-list .post-row').length===50");await click('#load-more');await until("document.querySelectorAll('#post-list .post-row').length===54");checks.push('Content pagination');
  await action('#post-list .action','Hapus draft');await until("!document.querySelector('#post-list').textContent.includes('Draft untuk dihapus melalui UI')");checks.push('Confirmed draft deletion');
  await action('#post-list .action','Riwayat');await until("document.querySelectorAll('#history-versions article').length===50");await click('#history-more');await until("document.querySelectorAll('#history-versions article').length===55");
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until("!document.querySelector('#history-dialog').open");checks.push('Version/audit history pagination and keyboard Escape');
  await click('[data-panel="calendar"]');await evaluate(`document.querySelector('#calendar-month').value=${JSON.stringify(schedule.toISOString().slice(0,7))};document.querySelector('#calendar-month').dispatchEvent(new Event('change'));`);
  await until("document.querySelector('.calendar-entry')!==null");await click('.calendar-entry');await until("document.querySelector('#history-list').textContent.includes('Jadwal uji kalender')");
  await click('#close-history');checks.push('Monthly calendar and content history');
  await click('[data-panel="content"]');await until("document.querySelector('#loading').hidden");
  await evaluate(`document.querySelector('#filter-account').value=${JSON.stringify(account)};document.querySelector('#filter').value='scheduled';document.querySelector('#content-filters').requestSubmit();`);
  await until("document.querySelectorAll('#post-list .post-row').length===1");await click('#reset-filters');await until("document.querySelectorAll('#post-list .post-row').length===50");checks.push('Server account/status/date filters and reset');
  await click('[data-panel="team"]');await until("document.querySelectorAll('#member-list .management-row').length===50");await click('#members-more');await until("document.querySelectorAll('#member-list .management-row').length===53");await click('#invitations-more');await until("document.querySelectorAll('#invitation-list .management-row').length===51");
  await evaluate("const r=Array.from(document.querySelectorAll('#member-list .management-row')).find(e=>e.querySelector('h3').textContent==='editor@example.test');r.querySelector('select').value='reviewer';Array.from(r.querySelectorAll('button')).find(e=>e.textContent==='Simpan peran').click()");
  await until("document.querySelector('#team-status').textContent==='Data anggota dan undangan dimuat.'");
  assert.equal((await query('SELECT role FROM local_users WHERE id=$1',[editor])).rows[0].role,'reviewer');
  await action('#member-list .action','Nonaktifkan anggota');await until("document.querySelector('#team-status').textContent==='Data anggota dan undangan dimuat.'");await until("document.querySelector('#member-list').textContent.includes('Nonaktif')");
  await action('#member-list .action','Aktifkan anggota');await until("!document.querySelector('#member-list').textContent.includes('Aktifkan anggota')");
  await action('#invitation-list .action','Cabut undangan');await until("document.querySelector('#invitation-list').textContent.includes('Dicabut')");
  await click('#invite-member');await evaluate("document.querySelector('#invite-email').value='new@example.test';document.querySelector('#invite-form').requestSubmit()");await until("!document.querySelector('#invite-dialog').open");assert.equal(mail.length,1);
  await click('#refresh-team');await until("document.querySelector('#invitation-list').textContent.includes('new@example.test')");checks.push('Team pagination, roles, disable/reactivate, invitation issue/revoke');
  await click('[data-panel="accounts"]');await until("document.querySelector('#account-list').textContent.includes('@test.account')");await action('#account-list .action','Periksa izin');await until("document.querySelector('.permission-details').textContent.includes('Izin kurang: tidak ada')");
  await action('#account-list .action','Putuskan koneksi');await until("document.querySelector('#account-list').textContent.includes('Terputus')");await click('#refresh-accounts');await until("document.querySelector('#accounts-status').textContent==='Status akun dimuat.'");checks.push('Account permission check and local disconnect');
  await click('[data-panel="content"]');await until("document.querySelector('#loading').hidden");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('#post-list .post-row')).find(row=>row.querySelector('.post-text').textContent==='Jadwal uji kalender').textContent.includes('Terbitkan sekarang')"),false);checks.push('Disconnected accounts cannot be selected for publishing in the UI');
  await click('[data-panel="audit"]');await until("document.querySelectorAll('#audit-list li').length===50");await click('#audit-more');await until("document.querySelectorAll('#audit-list li').length>50");await click('#refresh-audit');await until("document.querySelectorAll('#audit-list li').length===50");checks.push('Audit history and pagination');
  await cdp('Page.bringToFront');await evaluate("document.querySelector('#refresh-audit').focus()");
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await evaluate("document.activeElement.matches('a,button,input,select,textarea')"),true);checks.push('Native keyboard Tab focus');
  const folder=resolve('.local-data/verification');await mkdir(folder,{recursive:true});
  const screenshots=[];
  const contrastFailures=[];
  for (const [width,height] of [[1440,1000],[390,844]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<640});
    for (const panel of ['content','calendar','team','accounts','audit']) {
      await click(`[data-panel="${panel}"]`);await delay(250);await evaluate(`document.querySelector(${JSON.stringify(panel==='content' ? '#konten' : `#${panel}-panel`)}).scrollIntoView({block:'start'})`);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`Horizontal overflow: ${panel} at ${width}px`);
      const failures=await evaluate(`(()=>{
        const rgb=value=>{const values=value.match(/[\\d.]+/g)?.map(Number);return values?.length>=3 ? values : [0,0,0,0];};
        const luminance=values=>values.slice(0,3).map(v=>v/255).map(v=>v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((sum,v,index)=>sum+v*[.2126,.7152,.0722][index],0);
        const failures=[];
        for (const element of document.querySelectorAll('body *')) {
          if (!element.getClientRects().length || element.closest('[hidden],[aria-hidden="true"],button:disabled,input:disabled,select:disabled') || !Array.from(element.childNodes).some(node=>node.nodeType===3 && node.textContent.trim())) continue;
          const style=getComputedStyle(element);let parent=element,bg;
          while (parent) {bg=rgb(getComputedStyle(parent).backgroundColor);if(bg.length===3 || bg[3]>0) break;parent=parent.parentElement;}
          const fg=luminance(rgb(style.color)),back=luminance(bg || [255,255,255]),ratio=(Math.max(fg,back)+.05)/(Math.min(fg,back)+.05),large=parseFloat(style.fontSize)>=24 || (parseFloat(style.fontSize)>=18.66 && Number(style.fontWeight)>=700);
          if (ratio<(large ? 3 : 4.5)) failures.push({tag:element.tagName,selector:element.id || element.className,text:element.textContent.trim().slice(0,70),ratio:Number(ratio.toFixed(2))});
        }return failures;
      })()`);
      contrastFailures.push(...failures.map(failure=>({...failure,panel,width})));
      const image=await cdp('Page.captureScreenshot',{format:'png'}),name=`workspace-${panel}-${width}.png`;
      await writeFile(join(folder,name),Buffer.from(image.data,'base64'));screenshots.push(name);
    }
  }
  checks.push('Desktop/mobile overflow checks across five panels');
  await writeFile(join(folder,'workspace-contrast.json'),JSON.stringify(contrastFailures,null,2));
  assert.equal(contrastFailures.length,0,`Contrast failures: ${JSON.stringify(contrastFailures.slice(0,15))}`);checks.push('Computed WCAG AA text contrast on all five panels');
  await click('#logout');await until("!document.querySelector('#login-screen').hidden");
  const exceptions=events.filter(event=>event.method==='Runtime.exceptionThrown');assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  await writeFile(join(folder,'workspace-report.json'),JSON.stringify({checks,screenshots,scope:'Isolated synthetic data; fake Meta and SMTP; no production publishing'},null,2));
  console.log(JSON.stringify({checks,screenshots:folder,uncaughtErrors:exceptions.length},null,2));
} finally {
  ws?.close();browser?.kill();if(server)await new Promise(resolve=>server.close(resolve));await db.close();
  if (resolve(profile).startsWith(resolve(tmpdir())+'\\threads-workspace-qa-') || resolve(profile).startsWith(resolve(tmpdir())+'/threads-workspace-qa-')) await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
