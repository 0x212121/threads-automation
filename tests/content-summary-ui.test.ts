import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM,VirtualConsole } from 'jsdom';

async function waitFor(check:()=>boolean) {
  const deadline=Date.now()+3000;
  while (!check()) {if (Date.now()>deadline) throw new Error('Antarmuka tidak siap.');await new Promise(resolve=>setTimeout(resolve,10));}
}

test('daftar merangkum rangkaian dan video baru mendapatkan sumber setelah pemutar diminta',async()=>{
  const [html,script]=await Promise.all([readFile('public/index.html','utf8'),readFile('public/app.js','utf8')]);
  const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),win=dom.window;
  try {
    for (const id of ['detail-dialog','editor']) {
      const dialog=win.document.getElementById(id) as HTMLDialogElement;
      dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new win.Event('close'));};
    }
    let objectUrls=0;
    win.URL.createObjectURL=()=>{objectUrls++;return 'blob:https://example.test/test';};win.URL.revokeObjectURL=()=>{};
    const rows=[
      {id:'video-post',body:'Teks pertama\nbaris kedua\nbaris ketiga\nbaris keempat',replies:['Balasan kedua','Balasan ketiga'],media:[{id:'video-id',kind:'VIDEO'}],status:'draft',revision:1,created_by:'user1',created_at:new Date().toISOString()},
      {id:'image-post',body:'Carousel',replies:[],media:[{id:'image1',kind:'IMAGE'},{id:'image2',kind:'IMAGE'},{id:'image3',kind:'IMAGE'}],status:'draft',revision:1,created_by:'user1',created_at:new Date().toISOString()}
    ];
    win.fetch=(async(path:string)=>{
      let result:unknown={};
      if (path==='/api/auth/csrf') result={csrfToken:'csrf'};
      else if (path==='/api/auth/me') result={user:{id:'user1',email:'user@example.test',role:'editor',emailVerified:true}};
      else if (path==='/api/threads/accounts') result={accounts:[]};
      else if (path==='/api/threads/config') result={configured:false,publishingEnabled:false};
      else if (path.startsWith('/api/posts?')) result={posts:rows,nextOffset:null};
      else throw new Error(`Unexpected endpoint ${path}`);
      return Response.json(result);
    }) as typeof fetch;
    win.eval(script);
    await waitFor(()=>win.document.querySelectorAll('#post-list .post-row').length===2);
    const [videoRow,imageRow]=[...win.document.querySelectorAll<HTMLElement>('#post-list .post-row')];
    assert.match(videoRow!.textContent!,/3 bagian · 1 video/);
    assert.doesNotMatch(videoRow!.textContent!,/Balasan kedua|Balasan ketiga/);
    assert.equal(videoRow!.querySelector('video'),null);
    assert.equal(imageRow!.querySelectorAll('img').length,1);
    assert.match(imageRow!.textContent!,/3 gambar/);
    const action=(row:HTMLElement,label:string)=>[...row.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===label)!.click();
    action(videoRow!,'Lihat lengkap');
    const detail=win.document.querySelector('#detail-dialog') as HTMLDialogElement;
    assert.equal(detail.open,true);assert.match(detail.textContent!,/baris keempat/);assert.match(detail.textContent!,/Balasan kedua/);assert.match(detail.textContent!,/Balasan ketiga/);
    assert.equal(detail.querySelector('video'),null);
    ([...detail.querySelectorAll('button')].find(button=>button.textContent==='Tampilkan pemutar video') as HTMLButtonElement).click();
    const video=detail.querySelector('video')!;assert.equal(video.getAttribute('preload'),'none');assert.equal(video.getAttribute('src'),'/api/media/video-id/content');
    (win.document.querySelector('#close-detail') as HTMLButtonElement).click();assert.equal(detail.querySelector('video'),null);
    action(imageRow!,'Lihat lengkap');assert.equal(detail.querySelectorAll('img').length,3);detail.close();
    action(videoRow!,'Ubah');assert.equal(win.document.querySelector('#media-preview video'),null);assert.equal(objectUrls,0);
    const button=[...win.document.querySelectorAll<HTMLButtonElement>('#media-preview button')].find(item=>item.textContent==='Tampilkan pemutar video')!;button.click();
    assert.equal(win.document.querySelector('#media-preview video')?.getAttribute('preload'),'none');assert.equal(win.document.querySelector('#media-preview video')?.getAttribute('src'),'/api/media/video-id/content');
  } finally {win.close();}
});
