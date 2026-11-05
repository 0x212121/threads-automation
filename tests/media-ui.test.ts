import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

async function waitFor(check: () => boolean) {
  const deadline=Date.now()+3000;
  while (!check()) { if (Date.now()>deadline) throw new Error('Antarmuka media tidak mencapai status yang diharapkan.'); await new Promise(resolve=>setTimeout(resolve,10)); }
}

test('komposer mengunggah lampiran, menangani kegagalan simpan, dan membersihkan unggahan yang tidak dipakai', async () => {
  const [html,script]=await Promise.all([readFile('public/index.html','utf8'),readFile('public/app.js','utf8')]);
  const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only',virtualConsole:new VirtualConsole()}), win=dom.window;
  try {
    const editor=win.document.querySelector('#editor') as HTMLDialogElement;
    editor.showModal=()=>{editor.open=true;}; editor.close=()=>{editor.open=false; editor.dispatchEvent(new win.Event('close'));};
    win.URL.createObjectURL=()=> 'blob:https://example.test/test-preview'; win.URL.revokeObjectURL=()=>{};
    const posts: Record<string,unknown>[]=[]; const requests: {path:string; method:string; body?:unknown}[]=[];
    let failOnce=true, uploads=0, deletes=0;
    win.fetch=(async (path:string,init:RequestInit={}) => {
      const method=init.method ?? 'GET'; requests.push({path,method,body:init.body});
      let value:unknown={},status=200;
      if (path==='/api/auth/csrf') value={csrfToken:'test-csrf'};
      else if (path==='/api/auth/me') value={user:{id:'user1',email:'admin@example.test',role:'admin',emailVerified:true}};
      else if (path==='/api/threads/accounts') value={accounts:[]};
      else if (path==='/api/threads/config') value={configured:false,publishingEnabled:false};
      else if (path.startsWith('/api/posts?')) value={posts,nextOffset:null};
      else if (path==='/api/media' && method==='POST') {
        assert.ok(init.body instanceof win.FormData);
        assert.equal((init.headers as Record<string,string>)['X-CSRF-Token'],'test-csrf');
        assert.equal((init.headers as Record<string,string>)['Content-Type'],undefined);
        uploads++; value={media:{id:`media-${uploads}`,kind:'IMAGE'}}; status=201;
      } else if (path.startsWith('/api/media/') && method==='DELETE') { deletes++; status=204; }
      else if (path==='/api/posts' && method==='POST') {
        if (failOnce) { failOnce=false; status=409; value={error:'Draft berubah, coba kembali.'}; }
        else {
          const payload=JSON.parse(String(init.body));
          posts.push({id:`post-${posts.length}`,body:payload.body,media_id:payload.mediaId,media_kind:payload.mediaId?'IMAGE':null,status:'draft',revision:1,created_by:'user1',created_at:new Date().toISOString()});
          status=201; value={post:{id:'post-test'}};
        }
      } else throw new Error(`Endpoint tidak diharapkan: ${path}`);
      return new Response(status===204?null:JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    }) as typeof fetch;
    win.eval(script);
    const get=(selector:string)=>win.document.querySelector(selector) as HTMLElement;
    await waitFor(()=>!get('#workspace').hidden && get('#loading').hidden);
    const setFile=()=>{
      const input=get('#post-media') as HTMLInputElement;
      Object.defineProperty(input,'files',{configurable:true,value:[new win.File([new Uint8Array([1,2,3])],'gambar.png',{type:'image/png'})]});
      input.dispatchEvent(new win.Event('change',{bubbles:true}));
    };
    get('#new-post').click(); setFile();
    assert.equal(get('#remove-media').hidden,false);
    assert.ok(win.document.querySelector('#media-preview img'));
    get('#post-form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>!get('#form-error').hidden);
    assert.equal(uploads,1); assert.match(get('#form-error').textContent ?? '',/Draft berubah/);
    get('#remove-media').click(); (get('#post-text') as HTMLTextAreaElement).value='Teks pengganti';
    get('#post-form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>!editor.open && posts.length===1);
    assert.equal(deletes,1); assert.equal(posts[0]?.media_id,null);
    await waitFor(()=>get('#loading').hidden && !(get('#new-post') as HTMLButtonElement).disabled);
    get('#new-post').click(); setFile();
    get('#post-form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>!editor.open && posts.length===2);
    assert.equal(uploads,2); assert.equal(deletes,1); assert.equal(posts[1]?.media_id,'media-2');
    assert.ok(requests.some(call=>call.path==='/api/media/media-1' && call.method==='DELETE'));
  } finally { win.close(); }
});
