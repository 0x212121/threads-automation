const $ = selector => document.querySelector(selector);
const statusLabels = { draft: 'Draft', submitted: 'Menunggu tinjauan', approved: 'Disetujui', rejected: 'Ditolak' };
let csrf = '', user = null, posts = [], accounts = [], accountsAvailable = true, threadsConfigured = null, publishingEnabled = false, nextOffset = null, editing = null, scheduling = null, busy = false;
let threadsConnecting = false;
let threadsAttention = [];
let filterAccounts=[];
let editorMedia = [], previewObjectUrls = [], uploadedMediaIds = new Set();
let workspacePanel='content',calendarOffset=null,historyPost=null,historyOffset=null;
const managementOffsets={members:null,invitations:null,audit:null};
let postLoadSequence=0;
const linkParams = new URLSearchParams(location.hash.slice(1));
let verificationToken = linkParams.get('verify'), invitationToken = linkParams.get('invite'), resetToken = linkParams.get('reset');
let threadsResult = linkParams.get('threads');
if (verificationToken || invitationToken || resetToken || threadsResult) history.replaceState(null, '', location.pathname + location.search);

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.method && options.method !== 'GET') { if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrf; }
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers });
  let data = {};
  if (response.status !== 204) { try { data = await response.json(); } catch { /* The generic error is shown below. */ } }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') { user = null; csrf = ''; showLogin(); }
    const failure = new Error(data.error || 'Permintaan gagal. Coba lagi.'); failure.status = response.status; throw failure;
  }
  return data;
}
function errorAt(id, message) { const element = $(id); element.textContent = message; element.hidden = !message; }
function setBusy(value) {
  busy = value;
  $('#save-post').disabled = value;
  for (const id of ['#post-media','#remove-media','#split-post','#add-reply','#close-editor','#cancel-editor','#logout','#new-post','#empty-create']) $(id).disabled = value;
  document.querySelectorAll('.action').forEach(button => { button.disabled = value || button.dataset.edge === 'true'; });
}
function showLogin() { for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();historyPost=null;historySequence++;postLoadSequence++;calendarSequence++; $('#initial-loading').hidden = true; $('#workspace').hidden = true; $('#login-screen').hidden = false; $('#password').value = ''; $('#login-form').hidden = !!invitationToken || !!resetToken; $('#accept-invitation-form').hidden = !invitationToken; $('#reset-request-form').hidden = true; $('#reset-confirm-form').hidden = !resetToken; }
function showWorkspace() {
  $('#initial-loading').hidden = true; $('#login-screen').hidden = true; $('#workspace').hidden = false;
  $('#sidebar-email').textContent = user.email;
  $('#sidebar-role').textContent = ({ admin: 'Admin', editor: 'Editor', reviewer: 'Reviewer' })[user.role] || user.role;
  $('#verified-notice').hidden = user.emailVerified;
  $('#confirm-verification').hidden = !verificationToken || user.emailVerified;
  $('#invite-team').hidden = workspacePanel!=='team' || user.role !== 'admin' || !user.emailVerified;
  document.querySelectorAll('[data-admin]').forEach(element=>{element.hidden=user.role!=='admin' || !user.emailVerified;});
  if (user.role!=='admin' && ['team','audit','accounts'].includes(workspacePanel)) activateWorkspace('content');
  renderThreadsConnection();
  $('#invitation-pending').hidden = !invitationToken;
  $('#reset-pending').hidden = !resetToken;
  if (threadsResult === 'connected') errorAt('#verification-status', 'Akun Threads berhasil dihubungkan.');
  if (threadsResult === 'failed') {
    const reasons = {
      session: 'Sesi koneksi telah kedaluwarsa atau berbeda. Klik Hubungkan akun Threads lagi dan selesaikan pada browser yang sama dalam 10 menit.',
      denied: 'Otorisasi ditolak atau dibatalkan di Threads. Klik Hubungkan akun Threads untuk mencoba lagi.',
      callback: 'Meta tidak mengirim kode otorisasi. Mulai koneksi kembali dari aplikasi.',
      configuration: 'Konfigurasi Threads di server belum lengkap. Periksa konfigurasi dan buat ulang container.',
      access: 'Koneksi memerlukan administrator dengan email terverifikasi.',
      code_exchange: 'Pertukaran kode otorisasi ditolak atau responsnya tidak valid. Periksa Threads App ID, Threads App Secret, dan callback, lalu mulai koneksi baru.',
      long_token: 'Token jangka panjang belum dapat diperoleh. Periksa rincian berikut dan mulai koneksi baru setelah penyebabnya diselesaikan.',
      profile: 'Identitas profil Threads belum dapat diverifikasi. Periksa akses akun dan izin threads_basic, lalu mulai koneksi baru.',
      storage: 'Akun Threads belum dapat disimpan. Periksa migrasi database, koneksi database, dan kunci enkripsi di server.'
    };
    const reason = linkParams.get('reason');
    const message = Object.hasOwn(reasons, reason) ? reasons[reason] : 'Akun Threads belum dapat dihubungkan. Mulai koneksi kembali atau periksa konfigurasi server.';
    const metaCode = linkParams.get('meta_code');
    const metaSubcode = linkParams.get('meta_subcode');
    const metaReasons = {
      tester_or_review: 'Meta meminta akses pengujian atau App Review. Tambahkan akun sebagai Threads Tester dan terima undangannya di Threads, atau pastikan akses App Review sesuai.',
      permissions: 'Meta menolak izin yang diperlukan. Periksa threads_basic dan threads_content_publish pada use case Threads dan otorisasi ulang.',
      app_credentials: 'Meta menolak kredensial aplikasi. Periksa pasangan Threads App ID dan Threads App Secret pada aplikasi yang sama.',
      token: 'Meta menolak token sementara. Mulai koneksi baru dari aplikasi.',
      unsupported_request: 'Meta menolak format permintaan pada endpoint ini. Periksa versi aplikasi dan diagnosis server.'
    };
    const metaReason = linkParams.get('meta_reason');
    const detail = Object.hasOwn(metaReasons, metaReason) ? ` ${metaReasons[metaReason]}` : '';
    errorAt('#threads-connect-error', message + detail + (metaCode && /^[0-9]{1,12}$/.test(metaCode) ? ` Kode Meta: ${metaCode}.` : '') + (metaSubcode && /^[0-9]{1,12}$/.test(metaSubcode) ? ` Subkode Meta: ${metaSubcode}.` : ''));
  }
  threadsResult = null;
}
async function loadPosts(append = false) {
  const sequence=++postLoadSequence;
  $('#loading').hidden = false; errorAt('#workspace-error', '');
  try {
    const params=contentFilterParams(append ? nextOffset : 0);
    const result = await api(`/api/posts?${params}`);
    if (sequence!==postLoadSequence || !user) return;
    posts = append ? [...posts, ...result.posts] : result.posts;
    nextOffset = result.nextOffset;
    render();
  } catch (error) { errorAt('#workspace-error', error.message); }
  finally { if (sequence===postLoadSequence) $('#loading').hidden = true; }
}
async function loadAccounts() {
  threadsConfigured = null; publishingEnabled = false; renderThreadsConnection();
  try { const result = await api('/api/threads/accounts'); accounts = result.accounts; filterAccounts=result.filterAccounts || accounts;threadsAttention = result.attention || []; accountsAvailable = true; const config = await api('/api/threads/config'); threadsConfigured = config.configured === true; publishingEnabled = config.publishingEnabled === true; }
  catch (error) { if (error.status === 401) throw error; accounts = []; threadsAttention = []; accountsAvailable = false; threadsConfigured = 'error'; }
  finally { if (user) {renderThreadsConnection();renderAccountFilter();} }
}
function renderThreadsConnection() {
  const button = $('#connect-threads'), message = $('#threads-config-message');
  button.disabled = !user || user.role !== 'admin' || threadsConnecting;
  button.textContent = threadsConnecting ? 'Menghubungkan...' : 'Hubungkan akun Threads';
  message.hidden = false;
  if (!user) message.textContent = 'Masuk untuk melihat koneksi Threads.';
  else if (user.role !== 'admin') message.textContent = 'Hanya admin yang dapat menghubungkan akun Threads.';
  else if (!user.emailVerified) message.textContent = 'Verifikasi email administrator untuk menghubungkan akun Threads.';
  else if (threadsConfigured === null) message.textContent = 'Memeriksa koneksi Threads...';
  else if (threadsConfigured === 'error') message.textContent = 'Status koneksi tidak dapat diperiksa. Muat ulang halaman dan coba lagi.';
  else if (!threadsConfigured) message.textContent = 'Koneksi belum dikonfigurasi. Atur THREADS_APP_ID, THREADS_APP_SECRET, dan THREADS_TOKEN_KEY di server.';
  else if (threadsAttention.length) message.textContent = `Akun yang perlu diperiksa: ${threadsAttention.map(account => `@${account.username} (${account.reason === 'retry' ? 'pembaruan token akan dicoba lagi' : 'hubungkan ulang'})`).join(', ')}.`;
  else message.hidden = true;
}
function render() {
  const filter = $('#filter').value;
  const visible = filter === 'all' ? posts : posts.filter(post => post.status === filter || post.job_status===filter);
  $('#empty').hidden = visible.length > 0;
  $('#empty-create').hidden = posts.length > 0;
  $('#list-wrap').hidden = visible.length === 0;
  $('#load-more').hidden = nextOffset === null;
  const list = $('#post-list'); list.replaceChildren();
  for (const post of visible) {
    const row = $('#post-template').content.firstElementChild.cloneNode(true);
    row.querySelector('.post-text').textContent = post.body || (post.media_kind === 'VIDEO' ? 'Post video' : 'Post gambar');
    let mediaAnchor = row.querySelector('.post-text');
    for (const item of post.media || (post.media_id ? [{id:post.media_id,kind:post.media_kind}] : [])) {
      const preview = document.createElement(item.kind === 'IMAGE' ? 'img' : 'video');
      preview.src = `/api/media/${encodeURIComponent(item.id)}/content`; preview.width = 160; preview.height = 120; preview.className = 'media-preview';
      if (item.kind === 'IMAGE') { preview.alt = 'Lampiran gambar'; preview.loading = 'lazy'; }
      else { preview.controls = true; preview.preload = 'metadata'; }
      mediaAnchor.after(preview); mediaAnchor = preview;
    }
    for (const [index,reply] of (post.replies || []).entries()) { const line=document.createElement('p'); line.textContent=`Bagian ${index+2}: ${reply}`; mediaAnchor.after(line); mediaAnchor=line; }
    const created = new Date(post.created_at);
    row.querySelector('.post-created').textContent = `${Number.isNaN(created.getTime()) ? '' : `Dibuat ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(created)}`}${post.destination_username ? ` · @${post.destination_username}` : ''}`;
    const status = row.querySelector('.status'); status.textContent = statusLabels[post.status] || post.status; status.classList.add(post.status);
    const jobLabels = { scheduled: 'Terjadwal', preparing: 'Menyiapkan publikasi', prepared: 'Menyiapkan publikasi', publishing: 'Sedang menerbitkan', published: 'Terbit', confirmed_published: 'Terbit, dikonfirmasi anggota', uncertain: 'Hasil belum pasti, periksa Threads sebelum menentukan hasil', needs_action: 'Perlu tindakan', cancelled: 'Jadwal dibatalkan' };
    if (post.job_status && jobLabels[post.job_status]) {
      const extra = document.createElement('div'); extra.className = 'field-help';
      let when = '';
      try { if (post.scheduled_at && post.time_zone) when = ` · ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: post.time_zone }).format(new Date(post.scheduled_at))} (${post.time_zone})`; } catch { when = ''; }
      extra.textContent = jobLabels[post.job_status] + when; status.after(extra);
      if (post.replies?.length && post.part_index != null) extra.textContent += ` · Bagian ${Math.min(post.part_index+1,post.replies.length+1)} dari ${post.replies.length+1}`;
      if (post.job_status === 'needs_action') {
        const reasons = { meta_auth: 'Meta menolak akses. Periksa izin dan hubungkan ulang akun Threads.', meta_rejected: 'Meta menolak konten atau permintaan. Periksa isi dan izin akun sebelum mencoba lagi.', meta_unavailable: 'Meta tidak dapat dihubungi atau membatasi permintaan. Coba kembali nanti.', preconditions: 'Persetujuan, akses pengguna, atau akun Threads tidak lagi tersedia. Periksa kembali sebelum mencoba.', token_unreadable: 'Token tidak dapat dibaca. Periksa kunci server atau hubungkan ulang akun.', deadline: 'Batas percobaan satu jam telah lewat. Periksa konten dan jadwalkan kembali.' };
        if (reasons[post.failure_code]) extra.textContent += ` · ${reasons[post.failure_code]}`;
      }
    }
    const actions = row.querySelector('.post-actions');
    const own = post.created_by === user.id;
    const partial = post.job_status === 'needs_action' && post.part_index > 0;
    const blocked = partial || ['scheduled', 'preparing', 'prepared', 'publishing', 'published', 'confirmed_published', 'uncertain'].includes(post.job_status);
    const mayManage = own || user.role === 'admin' || user.role === 'reviewer';
    const mayPublish = user.emailVerified && mayManage;
    const accountReady=accountsAvailable && accounts.some(account=>account.id===post.destination_account_id);
    addAction(actions,'Riwayat',()=>openHistory(post));
    if (own && ['draft','rejected'].includes(post.status) && !blocked) addAction(actions,'Hapus draft',()=>deleteDraft(post));
    if (own && post.status !== 'submitted' && !blocked) addAction(actions, 'Ubah', () => openEditor(post));
    if (own && (post.status === 'draft' || post.status === 'rejected') && !blocked) addAction(actions, 'Ajukan', () => transition(post, 'submit'));
    if (post.status === 'submitted' && (user.role === 'admin' || user.role === 'reviewer')) {
      addAction(actions, 'Setujui', () => transition(post, 'approve'));
      addAction(actions, 'Tolak', () => transition(post, 'reject'));
    }
    if (post.status === 'approved' && mayPublish && accountReady && !blocked && publishingEnabled) {
      addAction(actions, 'Jadwalkan', () => openSchedule(post));
      addAction(actions, 'Terbitkan sekarang', () => publishNow(post));
    }
    if (post.job_status === 'scheduled' && mayManage && !post.part_index) {
      if (publishingEnabled && mayPublish) addAction(actions, 'Ubah jadwal', () => openSchedule(post));
      addAction(actions, 'Batalkan jadwal', () => cancelSchedule(post));
    }
    if (post.job_status === 'uncertain' && mayManage) {
      addAction(actions, 'Sudah terbit', () => resolvePublication(post, 'published'));
      addAction(actions, 'Tidak terbit', () => resolvePublication(post, 'not_published'));
    }
    if (partial && mayPublish && accountReady && publishingEnabled) addAction(actions, 'Lanjutkan rangkaian', () => resumePublication(post));
    list.append(row);
  }
}
function addAction(container, label, fn) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'action'; button.textContent = label; button.disabled = busy;
  button.addEventListener('click', fn); container.append(button);
}
async function transition(post, action) {
  if (busy) return;
  setBusy(true); errorAt('#workspace-error', '');
  try { await api(`/api/posts/${encodeURIComponent(post.id)}/${action}`, { method: 'POST', body: JSON.stringify({ revision: post.revision }) }); await loadPosts(); }
  catch (error) { errorAt('#workspace-error', error.message); }
  finally { setBusy(false); }
}
function openEditor(post = null) {
  if (busy) return;
  editing = post; $('#post-text').value = post?.body || ''; $('#editor-title').textContent = post ? 'Ubah draft' : 'Buat draft';
  editorMedia = post?.media ? post.media.map(item => ({...item})) : post?.media_id ? [{ id: post.media_id, kind: post.media_kind }] : []; uploadedMediaIds = new Set(); $('#post-media').value = ''; renderEditorMedia();
  renderReplies(post?.replies || []);
  const select = $('#post-account'); select.replaceChildren();
  const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Belum dipilih'; select.append(blank);
  for (const account of accounts) { const option = document.createElement('option'); option.value = account.id; option.textContent = `@${account.username}`; select.append(option); }
  if (post?.destination_account_id && !accounts.some(account => account.id === post.destination_account_id)) { const option = document.createElement('option'); option.value = post.destination_account_id; option.textContent = `@${post.destination_username || 'akun'} (tidak tersedia)`; select.append(option); }
  select.value = post?.destination_account_id || '';
  select.disabled = !accountsAvailable;
  $('#account-help').textContent = !accountsAvailable ? 'Daftar akun tidak dapat dimuat. Akun tujuan draft yang ada akan dipertahankan.' : accounts.length ? 'Pilih akun tujuan yang terhubung atau biarkan kosong.' : 'Belum ada akun Threads yang terhubung.';
  errorAt('#form-error', ''); $('#editor').showModal(); $('#post-text').focus();
}
function readReplies() { return [...$('#post-replies').querySelectorAll('textarea')].map(input => input.value); }
function renderReplies(replies) {
  const container=$('#post-replies'); container.replaceChildren();
  replies.forEach((text,index) => {
    const wrapper=document.createElement('div'), label=document.createElement('label'), input=document.createElement('textarea'), remove=document.createElement('button');
    input.id=`reply-${index}`; input.rows=4; input.maxLength=1000; input.value=text; label.htmlFor=input.id; label.textContent=`Bagian ${index+2}`;
    remove.type='button'; remove.className='action'; remove.textContent=`Hapus bagian ${index+2}`;
    remove.addEventListener('click',() => { const next=readReplies(); next.splice(index,1); renderReplies(next); });
    wrapper.append(label,input,remove); container.append(wrapper);
  });
}
function splitPost() {
  const characters=Array.from($('#post-text').value.trim()), current=readReplies();
  if (characters.length <= 500) { errorAt('#form-error','Teks bagian pertama belum melebihi 500 karakter.'); return false; }
  const chunks=[];
  while (characters.length) { let cut=Math.min(450,characters.length); if (cut<characters.length) { const space=characters.slice(0,cut).lastIndexOf(' '); if (space>225) cut=space+1; } chunks.push(characters.splice(0,cut).join('').trim()); }
  if (chunks.length+current.length>10) { errorAt('#form-error','Maksimal 10 bagian dalam satu rangkaian.'); return false; }
  $('#post-text').value=chunks.shift(); renderReplies([...chunks,...current]); errorAt('#form-error','Teks telah dibagi. Periksa dan sesuaikan setiap bagian sebelum menyimpan.'); return true;
}
$('#split-post').addEventListener('click',splitPost);
$('#add-reply').addEventListener('click',() => { const replies=readReplies(); if (replies.length>=9) { errorAt('#form-error','Maksimal 10 bagian dalam satu rangkaian.'); return; } renderReplies([...replies,'']); });
function renderEditorMedia() {
  for (const url of previewObjectUrls) URL.revokeObjectURL(url); previewObjectUrls = [];
  const container = $('#media-preview'); container.replaceChildren();
  $('#remove-media').hidden = !editorMedia.length;
  editorMedia.forEach((item,index) => {
    const wrapper = document.createElement('div');
    const element = document.createElement(item.kind === 'IMAGE' ? 'img' : 'video');
    if (item.file) { const url = URL.createObjectURL(item.file); previewObjectUrls.push(url); element.src = url; }
    else element.src = `/api/media/${encodeURIComponent(item.id)}/content`;
    element.width = 160; element.height = 120; element.className = 'media-preview';
    if (item.kind === 'IMAGE') element.alt = `Lampiran ${index+1}`; else { element.controls = true; element.preload = 'metadata'; }
    wrapper.append(element);
    if (editorMedia.length > 1) {
      const label=document.createElement('span'); label.textContent=`Gambar ${index+1}`; wrapper.append(label);
      for (const [text,offset] of [['Naik',-1],['Turun',1],['Hapus',0]]) {
        const button=document.createElement('button'); button.type='button'; button.className='action'; button.textContent=`${text} gambar ${index+1}`;
        button.dataset.edge=String((offset < 0 && index === 0) || (offset > 0 && index === editorMedia.length-1)); button.disabled=busy || button.dataset.edge === 'true';
        button.addEventListener('click',() => { if (busy) return; if (!offset) editorMedia.splice(index,1); else [editorMedia[index],editorMedia[index+offset]]=[editorMedia[index+offset],editorMedia[index]]; renderEditorMedia(); });
        wrapper.append(button);
      }
    }
    container.append(wrapper);
  });
}
$('#post-media').addEventListener('change', () => {
  const files = [...$('#post-media').files];
  if (!files.length) return;
  if (files.some(file => !['image/jpeg','image/png','video/mp4'].includes(file.type) || file.size > (file.type === 'video/mp4' ? 100 : 8)*1024*1024)) { errorAt('#form-error','Pilih JPEG/PNG maksimal 8 MiB atau MP4 maksimal 100 MiB.'); $('#post-media').value = ''; return; }
  const incoming = files.map(file => ({file,kind:file.type === 'video/mp4' ? 'VIDEO' : 'IMAGE'}));
  if (editorMedia.length + incoming.length > 10 || (editorMedia.length + incoming.length > 1 && [...editorMedia,...incoming].some(item => item.kind !== 'IMAGE'))) { errorAt('#form-error','Pilih maksimal 10 gambar, atau satu video tanpa gambar.'); $('#post-media').value = ''; return; }
  editorMedia.push(...incoming); $('#post-media').value = ''; renderEditorMedia(); errorAt('#form-error','');
});
$('#remove-media').addEventListener('click', () => { editorMedia = []; $('#post-media').value = ''; renderEditorMedia(); });
async function closeEditor() {
  if (busy) return;
  setBusy(true);
  try { await cleanupUnusedMedia(); $('#editor').close(); }
  finally { setBusy(false); }
}
async function cleanupUnusedMedia() {
  let success = true;
  for (const id of uploadedMediaIds) {
    try { await api(`/api/media/${encodeURIComponent(id)}`,{ method: 'DELETE' }); uploadedMediaIds.delete(id); }
    catch { success = false; }
  }
  if (!success) errorAt('#workspace-error', 'Sebagian unggahan belum dapat dibersihkan dari penyimpanan.');
  return success;
}
$('#editor').addEventListener('cancel', event => { event.preventDefault(); void closeEditor(); });
$('#editor').addEventListener('close', () => { for (const url of previewObjectUrls) URL.revokeObjectURL(url); previewObjectUrls = []; });
function openSchedule(post) {
  scheduling = post; $('#schedule-form').reset();
  $('#schedule-title').textContent = post.job_status === 'scheduled' ? 'Ubah jadwal' : 'Jadwalkan posting';
  $('#schedule-zone').value = post.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  errorAt('#schedule-error', ''); $('#schedule-dialog').showModal(); $('#schedule-time').focus();
}
async function publishNow(post) {
  if (busy || !confirm('Terbitkan konten ini ke akun Threads yang dipilih sekarang?')) return;
  setBusy(true); errorAt('#workspace-error', '');
  try { await api(`/api/posts/${encodeURIComponent(post.id)}/publish-now`, { method: 'POST', body: JSON.stringify({ revision: post.revision, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }) }); await loadPosts(); }
  catch (error) { errorAt('#workspace-error', error.message); }
  finally { setBusy(false); }
}
async function cancelSchedule(post) {
  if (busy || !confirm('Batalkan jadwal posting ini?')) return;
  setBusy(true); errorAt('#workspace-error', '');
  try { await api(`/api/posts/${encodeURIComponent(post.id)}/schedules/${encodeURIComponent(post.job_id)}/cancel`, { method: 'POST', body: JSON.stringify({ revision: post.revision }) }); await loadPosts(); }
  catch (error) { errorAt('#workspace-error', error.message); }
  finally { setBusy(false); }
}
async function resolvePublication(post, decision) {
  const prompt = decision === 'published' ? 'Apakah kamu sudah memeriksa akun Threads dan memastikan posting ini sudah terbit?' : 'Apakah kamu sudah memeriksa akun Threads dan memastikan posting ini tidak terbit? Jika keliru, percobaan berikutnya dapat membuat posting ganda.';
  if (busy || !confirm(prompt)) return;
  let publishedId;
  if (decision === 'published' && post.replies?.length > post.part_index) { publishedId=window.prompt('Masukkan ID numerik posting Threads yang sudah terbit agar balasan berikutnya dapat dilanjutkan.'); if (publishedId === null) return; if (!/^[0-9]+$/.test(publishedId)) { errorAt('#workspace-error','ID posting harus berupa angka.'); return; } }
  setBusy(true); errorAt('#workspace-error', '');
  try { await api(`/api/posts/${encodeURIComponent(post.id)}/schedules/${encodeURIComponent(post.job_id)}/resolve`, { method: 'POST', body: JSON.stringify({ revision: post.revision, decision, acknowledged: true, ...(publishedId ? {publishedId} : {}) }) }); await loadPosts(); }
  catch (error) { errorAt('#workspace-error', error.message); }
  finally { setBusy(false); }
}
async function resumePublication(post) {
  if (busy || !confirm('Lanjutkan dari bagian yang belum terbit? Bagian sebelumnya tidak akan dikirim ulang.')) return;
  setBusy(true); errorAt('#workspace-error','');
  try { await api(`/api/posts/${encodeURIComponent(post.id)}/schedules/${encodeURIComponent(post.job_id)}/resume`,{method:'POST',body:JSON.stringify({revision:post.revision})}); await loadPosts(); }
  catch (error) { errorAt('#workspace-error',error.message); }
  finally { setBusy(false); }
}
$('#schedule-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !scheduling) return;
  setBusy(true); $('#save-schedule').disabled = true; errorAt('#schedule-error', '');
  try {
    const path = scheduling.job_status === 'scheduled' ? `/api/posts/${encodeURIComponent(scheduling.id)}/schedules/${encodeURIComponent(scheduling.job_id)}/reschedule` : `/api/posts/${encodeURIComponent(scheduling.id)}/schedule`;
    await api(path, { method: 'POST', body: JSON.stringify({ revision: scheduling.revision, localTime: $('#schedule-time').value, timeZone: $('#schedule-zone').value.trim() }) });
    $('#schedule-dialog').close(); await loadPosts();
  } catch (error) { errorAt('#schedule-error', error.message); }
  finally { setBusy(false); $('#save-schedule').disabled = false; }
});
$('#close-schedule').addEventListener('click', () => $('#schedule-dialog').close());
$('#cancel-schedule-dialog').addEventListener('click', () => $('#schedule-dialog').close());
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#login-form button[type="submit"]'); button.disabled = true; errorAt('#login-error', '');
  try {
    if (!csrf) csrf = (await api('/api/auth/csrf')).csrfToken;
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
    csrf = result.csrfToken; user = result.user; $('#password').value = ''; showWorkspace(); await loadAccounts(); await loadPosts();
  } catch (error) { errorAt('#login-error', error.message); }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  const button = $('#logout'); button.disabled = true;
  try { await api('/api/auth/logout', { method: 'POST' }); csrf = ''; posts = []; user = null; showLogin(); }
  catch (error) { errorAt('#workspace-error', error.message); }
  finally { button.disabled = false; }
});
$('#request-verification').addEventListener('click', async () => {
  const button = $('#request-verification'); button.disabled = true; errorAt('#verification-status', '');
  try { await api('/api/auth/verification/request', { method: 'POST' }); errorAt('#verification-status', 'Jika email belum diverifikasi, periksa kotak masuk untuk tautan verifikasi.'); }
  catch (error) { errorAt('#verification-status', error.message); }
  finally { button.disabled = false; }
});
$('#confirm-email').addEventListener('click', async () => {
  const button = $('#confirm-email'); button.disabled = true; errorAt('#verification-status', '');
  try {
    await api('/api/auth/verification/confirm', { method: 'POST', body: JSON.stringify({ token: verificationToken }) });
    verificationToken = null; user.emailVerified = true; $('#confirm-verification').hidden = true; $('#verified-notice').hidden = true; $('#invite-team').hidden = user.role !== 'admin'; renderThreadsConnection();
    errorAt('#verification-status', 'Email berhasil diverifikasi.');
  } catch (error) { errorAt('#verification-status', error.message); }
  finally { button.disabled = false; }
});
$('#connect-threads').addEventListener('click', async () => {
  if (threadsConnecting) return;
  threadsConnecting = true; renderThreadsConnection(); errorAt('#threads-connect-error', '');
  const link = $('#continue-threads'); link.hidden = true; link.removeAttribute('href');
  try {
    const current = await api('/api/auth/me'); user = current.user; showWorkspace();
    if (user.role !== 'admin') throw new Error('Hanya admin yang dapat menghubungkan akun Threads.');
    if (!user.emailVerified) {
      $('#request-verification').focus();
      throw new Error('Verifikasi email administrator terlebih dahulu melalui tombol Kirim email verifikasi, lalu klik Hubungkan akun Threads lagi.');
    }
    const config = await api('/api/threads/config'); threadsConfigured = config.configured === true;
    if (!threadsConfigured) throw new Error('Konfigurasi Threads belum tersedia. Atur THREADS_APP_ID, THREADS_APP_SECRET, dan THREADS_TOKEN_KEY, lalu buat ulang container aplikasi.');
    const result = await api('/api/threads/oauth/start', { method: 'POST' });
    const url = new URL(result.authorizationUrl);
    const allowedHosts = ['www.threads.com', 'threads.com', 'www.threads.net', 'threads.net'];
    if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname) || url.pathname !== '/oauth/authorize' || url.username || url.password || url.port || url.hash) throw new Error('Alamat otorisasi Threads tidak valid.');
    if (!/^[0-9]+$/.test(url.searchParams.get('client_id') || '') || url.searchParams.get('response_type') !== 'code' || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state') || '') || url.searchParams.get('redirect_uri') !== `${location.origin}/api/threads/oauth/callback`) throw new Error('Parameter otorisasi Threads tidak lengkap atau callback berbeda. Periksa konfigurasi aplikasi di server.');
    link.href = url.toString(); link.hidden = false;
    window.location.assign(url.toString());
  } catch (error) { errorAt('#threads-connect-error', error.message); }
  finally { threadsConnecting = false; if (user) renderThreadsConnection(); }
});
$('#invite-member').addEventListener('click', () => { $('#invite-form').reset(); errorAt('#invite-error', ''); $('#invite-dialog').showModal(); $('#invite-email').focus(); });
$('#close-invite').addEventListener('click', () => $('#invite-dialog').close());
$('#cancel-invite-dialog').addEventListener('click', () => $('#invite-dialog').close());
$('#invite-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#send-invitation'); button.disabled = true; errorAt('#invite-error', '');
  try {
    await api('/api/invitations', { method: 'POST', body: JSON.stringify({ email: $('#invite-email').value, role: $('#invite-role').value }) });
    $('#invite-dialog').close(); errorAt('#verification-status', 'Undangan berhasil dikirim.');
  } catch (error) { errorAt('#invite-error', error.message); }
  finally { button.disabled = false; }
});
$('#cancel-invite').addEventListener('click', () => { invitationToken = null; $('#accept-invitation-form').reset(); showLogin(); });
$('#forgot-password').addEventListener('click', () => { $('#login-form').hidden = true; $('#reset-request-form').hidden = false; errorAt('#login-message', ''); $('#reset-email').focus(); });
$('#cancel-reset-request').addEventListener('click', () => { $('#reset-request-form').reset(); showLogin(); });
$('#cancel-reset-confirm').addEventListener('click', () => { resetToken = null; $('#reset-confirm-form').reset(); showLogin(); });
$('#reset-request-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#reset-request-form button[type="submit"]'); button.disabled = true; errorAt('#reset-request-error', '');
  try {
    if (!csrf) csrf = (await api('/api/auth/csrf')).csrfToken;
    await api('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email: $('#reset-email').value }) });
    $('#reset-request-form').reset(); showLogin(); errorAt('#login-message', 'Jika akun tersedia, tautan pemulihan akan dikirim ke email tersebut.');
  } catch (error) { errorAt('#reset-request-error', error.message); }
  finally { button.disabled = false; }
});
$('#reset-confirm-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#reset-confirm-form button[type="submit"]'); button.disabled = true; errorAt('#reset-confirm-error', '');
  try {
    if ($('#reset-password').value !== $('#reset-password-confirm').value) throw new Error('Kata sandi tidak cocok.');
    if (!csrf) csrf = (await api('/api/auth/csrf')).csrfToken;
    await api('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token: resetToken, password: $('#reset-password').value }) });
    csrf = ''; resetToken = null; $('#reset-confirm-form').reset(); showLogin(); errorAt('#login-message', 'Kata sandi diperbarui. Silakan masuk kembali.');
  } catch (error) { errorAt('#reset-confirm-error', error.message); }
  finally { button.disabled = false; }
});
$('#accept-invitation-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#accept-invitation-form button[type="submit"]'); button.disabled = true; errorAt('#accept-error', '');
  try {
    if ($('#invite-password').value !== $('#invite-password-confirm').value) throw new Error('Kata sandi tidak cocok.');
    if (!csrf) csrf = (await api('/api/auth/csrf')).csrfToken;
    await api('/api/invitations/accept', { method: 'POST', body: JSON.stringify({ token: invitationToken, password: $('#invite-password').value }) });
    invitationToken = null; $('#accept-invitation-form').reset(); showLogin(); errorAt('#login-message', 'Undangan diterima. Masuk menggunakan email yang menerima undangan dan kata sandi baru.');
  } catch (error) { errorAt('#accept-error', error.message); }
  finally { button.disabled = false; }
});
$('#post-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const body = $('#post-text').value.trim();
  if (Array.from(body).length>500) { splitPost(); return; }
  const replies=readReplies();
  if (replies.some(reply => !reply.trim() || Array.from(reply).length>500)) { errorAt('#form-error','Isi setiap bagian dengan maksimal 500 karakter.'); return; }
  if (!body && !editorMedia.length) { errorAt('#form-error', 'Isi teks atau lampirkan media.'); return; }
  setBusy(true); errorAt('#form-error', '');
  try {
    for (let i=0; i<editorMedia.length; i++) if (editorMedia[i].file) {
      const form = new FormData(); form.append('file',editorMedia[i].file);
      editorMedia[i] = (await api('/api/media',{ method: 'POST', body: form })).media; uploadedMediaIds.add(editorMedia[i].id); renderEditorMedia();
    }
    const payload = editing ? { body, revision: editing.revision } : { body };
    payload.replies = replies;
    if (editorMedia.length <= 1) payload.mediaId = editorMedia[0]?.id ?? null;
    else payload.mediaIds = editorMedia.map(item => item.id);
    if (accountsAvailable) payload.destinationAccountId = $('#post-account').value || null;
    await api(editing ? `/api/posts/${encodeURIComponent(editing.id)}` : '/api/posts', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    for (const item of editorMedia) uploadedMediaIds.delete(item.id);
    const cleaned = await cleanupUnusedMedia();
    $('#editor').close(); await loadPosts();
    if (!cleaned) errorAt('#workspace-error', 'Sebagian unggahan belum dapat dibersihkan dari penyimpanan.');
  } catch (error) { errorAt('#form-error', error.message); }
  finally { setBusy(false); }
});
$('#new-post').addEventListener('click', () => openEditor());
$('#empty-create').addEventListener('click', () => openEditor());
$('#close-editor').addEventListener('click', closeEditor);
$('#cancel-editor').addEventListener('click', closeEditor);
$('#filter').addEventListener('change',()=>refreshContentView());
$('#load-more').addEventListener('click', async () => { const button = $('#load-more'); button.disabled = true; try { await loadPosts(true); } finally { button.disabled = false; } });
function textElement(tag,text,className='') {
  const element=document.createElement(tag);element.textContent=text;if (className) element.className=className;return element;
}
function displayTime(value,zone=$('#filter-zone').value || 'UTC') {
  if (!value) return '';
  try {return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:zone}).format(new Date(value));} catch {return String(value);}
}
function renderAccountFilter() {
  const select=$('#filter-account'),selected=select.value,existing=[...select.options].map(option=>({id:option.value,username:option.textContent}));
  select.replaceChildren(new Option('Semua akun',''));
  const available=new Map(existing.filter(item=>item.id).map(item=>[item.id,item.username]));
  for (const account of filterAccounts) available.set(account.id,`@${account.username}`);
  for (const [id,name] of available) select.append(new Option(name,id));
  select.value=selected;
}
function contentFilterParams(offset=0) {
  const params=new URLSearchParams({offset:String(offset ?? 0),timeZone:$('#filter-zone').value.trim() || 'UTC'});
  for (const [key,id] of [['status','filter'],['accountId','filter-account'],['dateField','filter-date-field'],['dateFrom','filter-from'],['dateTo','filter-to']]) if ($( `#${id}`).value) params.set(key,$(`#${id}`).value);
  return params;
}
async function refreshContentView() {if (workspacePanel==='calendar') await loadCalendar();else await loadPosts();}
async function activateWorkspace(panel) {
  if (busy || !user) return;
  if (['team','audit','accounts'].includes(panel) && (user.role!=='admin' || !user.emailVerified)) return;
  workspacePanel=panel;
  $('.breadcrumb strong').textContent=({content:'Konten',calendar:'Kalender',team:'Anggota tim',accounts:'Akun Threads',audit:'Audit'})[panel];
  $('#threads-connect-panel').hidden=!['content','accounts'].includes(panel);
  $('#invite-team').hidden=panel!=='team' || user.role!=='admin' || !user.emailVerified;
  $('#verification-status').hidden=true;
  if (panel!=='content') document.querySelectorAll('[data-view]').forEach(link=>link.classList.remove('active'));
  $('#konten').hidden=panel!=='content';$('#ringkasan').hidden=panel!=='content';
  $('#content-filters').hidden=!['content','calendar'].includes(panel);
  for (const name of ['calendar','team','accounts','audit']) $(`#${name}-panel`).hidden=name!==panel;
  document.querySelectorAll('[data-panel]').forEach(button=>{if (button.dataset.panel===panel) button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  for (const id of ['filter-date-field','filter-from','filter-to']) $(`#${id}`).disabled=panel==='calendar';
  if (panel==='calendar') await loadCalendar();
  else if (panel==='team') await loadTeam();
  else if (panel==='accounts') await loadManagedAccounts();
  else if (panel==='audit') await loadAudit();
  else await loadPosts();
}
for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click',()=>activateWorkspace(button.dataset.panel));
$('#content-filters').addEventListener('submit',event=>{event.preventDefault();void refreshContentView();});
$('#reset-filters').addEventListener('click',()=>{$('#content-filters').reset();void refreshContentView();});
let calendarSequence=0;
async function loadCalendar(append=false) {
  const sequence=++calendarSequence,status=$('#calendar-status'),button=$('#calendar-more');button.disabled=true;status.textContent='Memuat jadwal...';
  try {
    const month=$('#calendar-month').value;if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Pilih bulan kalender.');
    const [year,number]=month.split('-').map(Number),days=new Date(Date.UTC(year,number,0)).getUTCDate();
    $('#filter-from').value=`${month}-01`;$('#filter-to').value=`${month}-${days}`;$('#filter-date-field').value='scheduled';
    const result=await api(`/api/posts?${contentFilterParams(append ? calendarOffset : 0)}`);
    if (sequence!==calendarSequence || !user) return;
    if (!append) {
      const grid=$('#calendar-grid');grid.replaceChildren();
      for (const label of ['Sen','Sel','Rab','Kam','Jum','Sab','Min']) {const heading=textElement('div',label,'calendar-weekday');heading.setAttribute('aria-hidden','true');grid.append(heading);}
      const startsOn=(new Date(Date.UTC(year,number-1,1)).getUTCDay()+6)%7;
      for (let index=0;index<startsOn;index++) {const spacer=textElement('div','','calendar-spacer');spacer.setAttribute('aria-hidden','true');grid.append(spacer);}
      for (let day=1;day<=days;day++) {
        const cell=textElement('section','', 'calendar-day');cell.dataset.day=`${month}-${String(day).padStart(2,'0')}`;
        cell.setAttribute('aria-label',cell.dataset.day);
        cell.append(textElement('h3',String(day)));grid.append(cell);
      }
    }
    for (const post of result.posts) {
      if (!post.scheduled_at) continue;
      const date=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:$('#filter-zone').value}).format(new Date(post.scheduled_at));
      const cell=[...$('#calendar-grid').children].find(element=>element.dataset.day===date);if (!cell) continue;
      const item=document.createElement('button');item.type='button';item.className='calendar-entry';
      const time=new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:$('#filter-zone').value}).format(new Date(post.scheduled_at));
      item.textContent=`${time} · @${post.destination_username || 'akun'} · ${publicationLabel(post.job_status)}\n${post.body || 'Posting media'}`;
      item.addEventListener('click',()=>openHistory(post));cell.append(item);
    }
    calendarOffset=result.nextOffset;button.hidden=calendarOffset===null;
    status.textContent=result.posts.length || append ? `Zona waktu: ${$('#filter-zone').value}. Klik posting untuk membuka riwayat.${calendarOffset!==null ? ' Masih ada jadwal yang belum dimuat.' : ''}` : 'Belum ada jadwal pada bulan dan filter ini.';
  } catch(error) {status.textContent=error.message;}
  finally {if (sequence===calendarSequence) button.disabled=false;}
}
$('#calendar-month').value=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
$('#calendar-month').addEventListener('change',()=>loadCalendar());
for (const [id,offset] of [['calendar-prev',-1],['calendar-next',1]]) $(`#${id}`).addEventListener('click',()=>{
  const value=$('#calendar-month').value;if (!value) return;
  const [year,month]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1+offset,1));$('#calendar-month').value=date.toISOString().slice(0,7);void loadCalendar();
});
$('#calendar-more').addEventListener('click',()=>loadCalendar(true));
async function deleteDraft(post) {
  if (busy || !confirm('Hapus draft ini dari daftar konten? Riwayatnya tetap disimpan untuk audit.')) return;
  setBusy(true);errorAt('#workspace-error','');
  try {await api(`/api/posts/${post.id}`,{method:'DELETE',body:JSON.stringify({revision:post.revision})});await loadPosts();}
  catch(error) {errorAt('#workspace-error',error.message);} finally {setBusy(false);}
}
const actionNames={'post.created':'Draft dibuat','post.edited':'Konten diubah','post.submit':'Konten diajukan','post.approve':'Konten disetujui','post.reject':'Konten ditolak','post.deleted':'Draft dihapus','member.updated':'Anggota diperbarui','invitation.issued':'Undangan dibuat','invitation.accepted':'Undangan diterima','invitation.revoked':'Undangan dicabut','threads.connected':'Akun Threads dihubungkan','threads.reconnected':'Akun Threads dihubungkan ulang','threads.disconnected':'Akun Threads diputus','threads.permissions_checked':'Izin Threads diperiksa'};
Object.assign(actionNames,{'post.scheduled':'Publikasi dijadwalkan','post.publish_requested':'Publikasi diminta','post.schedule_cancelled':'Jadwal dibatalkan','post.rescheduled':'Jadwal diubah','post.resumed':'Rangkaian dilanjutkan','post.resolved':'Hasil publikasi dikonfirmasi'});
function publicationLabel(value) {return ({scheduled:'Terjadwal',preparing:'Menyiapkan',prepared:'Menunggu kesiapan',publishing:'Sedang menerbitkan',published:'Terbit',confirmed_published:'Terbit, dikonfirmasi',uncertain:'Hasil belum pasti',needs_action:'Perlu tindakan',cancelled:'Dibatalkan'})[value] || value;}
function historyDetails(entry,item) {
  const labels={job_id:'Pekerjaan',content_version:'Versi konten',reviewer_id:'Reviewer',resolved_by:'Dikonfirmasi oleh',resumed_by:'Dilanjutkan oleh',actor_id:'Pelaku',failure_reason:'Kategori kegagalan',failure_http_status:'HTTP',failure_meta_code:'Kode Meta',failure_meta_subcode:'Subkode Meta',failure_code:'Alasan tindakan',previous_id:'ID sebelumnya',corrected_id:'ID pengganti'};
  for (const [key,label] of Object.entries(labels)) if (item[key]!=null) entry.append(textElement('p',`${label}: ${item[key]}`,'field-help'));
  if (item.part_index!=null || item.position!=null) entry.append(textElement('p',`Bagian ${Number(item.part_index ?? item.position)+1}`,'field-help'));
  if (item.scheduled_at) entry.append(textElement('p',`Jadwal: ${displayTime(item.scheduled_at,item.time_zone)} (${item.time_zone})`,'field-help'));
  for (const part of item.parts || []) entry.append(textElement('p',`Bagian ${part.position+1}: ${publicationLabel(part.status)}${part.publishedId ? ` · ID ${part.publishedId}` : ''}`,'field-help'));
  if (item.details) for (const [key,label] of Object.entries({version:'Versi',previousRole:'Peran sebelumnya',role:'Peran baru',disabled:'Nonaktif',pausedJobs:'Pekerjaan dihentikan',jobId:'Pekerjaan',scheduledAt:'Jadwal UTC',timeZone:'Zona waktu',decision:'Konfirmasi',part:'Bagian'})) if (item.details[key]!=null) entry.append(textElement('p',`${label}: ${item.details[key]}`,'field-help'));
}
let historySequence=0;
async function openHistory(post) {
  historyPost=post;historyOffset=0;$('#history-list').replaceChildren();$('#history-dialog').showModal();await loadHistory();
}
async function loadHistory() {
  const sequence=++historySequence,post=historyPost,offset=historyOffset;$('#history-status').textContent='Memuat riwayat...';$('#history-more').disabled=true;
  try {
    const result=await api(`/api/posts/${post.id}/history?offset=${offset}`);if (sequence!==historySequence || historyPost!==post || !user) return;
    let more=false;
    const headings={versions:'Versi konten',reviews:'Keputusan tinjauan',jobs:'Pekerjaan publikasi',attempts:'Percobaan publikasi',events:'Aktivitas konten',resolutions:'Konfirmasi hasil',resumptions:'Kelanjutan rangkaian',repairs:'Pemulihan referensi'};
    for (const [name,title] of Object.entries(headings)) {
      const page=result[name];if (!page) continue;
      more ||= page.nextOffset!==null;
      let section=$(`#history-${name}`);
      if (!section) {section=document.createElement('section');section.id=`history-${name}`;section.append(textElement('h3',title));$('#history-list').append(section);}
      if (!page.items.length && offset===0) section.append(textElement('p','Belum ada catatan.','field-help'));
      for (const item of page.items) {
        const entry=document.createElement('article');entry.className='history-entry';
        if (name==='versions') {
          entry.append(textElement('h4',`Versi ${item.version} · ${displayTime(item.created_at)} · ${item.created_by}`),textElement('p',item.destination_username ? `@${item.destination_username}` : 'Tanpa akun tujuan'),textElement('p',item.body || 'Tanpa teks','history-body'));
          for (const [index,reply] of (item.replies || []).entries()) entry.append(textElement('p',`Bagian ${index+2}: ${reply}`,'history-body'));
          for (const asset of item.media || []) {const link=document.createElement('a');link.href=`/api/media/${encodeURIComponent(asset.id)}/content`;link.target='_blank';link.rel='noopener';link.textContent=`Buka ${asset.kind==='IMAGE' ? 'gambar' : 'video'}`;entry.append(link);}
        } else {
          const when=item.created_at || item.scheduled_at;
          const label=item.action ? actionNames[item.action] || item.action : [publicationLabel(item.status),({prepare:'Persiapan',publish:'Publikasi'})[item.stage],({started:'Dimulai',succeeded:'Berhasil',safe_failure:'Gagal sebelum publikasi',uncertain:'Hasil belum pasti'})[item.outcome],({approved:'Disetujui',rejected:'Ditolak',published:'Terbit dikonfirmasi',not_published:'Tidak terbit dikonfirmasi'})[item.decision]].filter(Boolean).join(' · ');
          entry.append(textElement('h4',`${label} · ${displayTime(when)}`));
          historyDetails(entry,item);
        }
        section.append(entry);
      }
    }
    historyOffset=offset+50;$('#history-more').hidden=!more;$('#history-status').textContent='Seluruh waktu ditampilkan pada zona waktu filter. Catatan lama sebelum audit diaktifkan dapat tidak memiliki aktivitas.';
  } catch(error) {$('#history-status').textContent=error.message;$('#history-more').hidden=false;}
  finally {if (sequence===historySequence) $('#history-more').disabled=false;}
}
$('#close-history').addEventListener('click',()=>{$('#history-dialog').close();historyPost=null;historySequence++;});
$('#history-more').addEventListener('click',()=>loadHistory());
async function managementAction(statusId,operation,reload) {
  if (busy) return;setBusy(true);errorAt(statusId,'Menyimpan perubahan...');
  try {await operation();await reload();}
  catch(error) {errorAt(statusId,error.message);} finally {setBusy(false);}
}
async function loadTeam(appendKind=null) {
  $('#team-status').textContent='Memuat anggota dan undangan...';
  try {
    for (const kind of appendKind ? [appendKind] : ['members','invitations']) {
      const offset=appendKind ? managementOffsets[kind] : 0,result=await api(`${kind==='members' ? '/api/team/members' : '/api/invitations'}?offset=${offset}`),container=$(kind==='members' ? '#member-list' : '#invitation-list');
      if (!user) return;if (!appendKind) container.replaceChildren();
      if (!result[kind].length && !appendKind) container.append(textElement('p',kind==='members' ? 'Belum ada anggota.' : 'Belum ada undangan.','field-help'));
      for (const item of result[kind]) {
        const row=textElement('article','', 'management-row');row.append(textElement('h3',item.email));
        if (kind==='members') {
          row.append(textElement('p',`${item.disabled_at ? 'Nonaktif' : 'Aktif'} · ${item.email_verified_at ? 'Email terverifikasi' : 'Email belum diverifikasi'}`,'field-help'));
          const label=textElement('label','Peran anggota'),select=document.createElement('select');select.setAttribute('aria-label',`Peran ${item.email}`);
          for (const role of ['editor','reviewer','admin']) select.append(new Option(role,role));select.value=item.role;label.append(select);row.append(label);
          const expected={expectedRole:item.role,expectedDisabled:!!item.disabled_at};
          addAction(row,'Simpan peran',()=>{if (select.value===item.role) return;if (!confirm(`Ubah peran ${item.email} menjadi ${select.value}? Sesi lamanya akan dicabut.`)) return;void managementAction('#team-status',()=>api(`/api/team/members/${item.id}`,{method:'PATCH',body:JSON.stringify({...expected,role:select.value})}),loadTeam);});
          if (item.id!==user.id) addAction(row,item.disabled_at ? 'Aktifkan anggota' : 'Nonaktifkan anggota',()=>{if (!confirm(`${item.disabled_at ? 'Aktifkan' : 'Nonaktifkan'} ${item.email}?`)) return;void managementAction('#team-status',()=>api(`/api/team/members/${item.id}`,{method:'PATCH',body:JSON.stringify({...expected,disabled:!item.disabled_at})}),loadTeam);});
        } else {
          const state=item.accepted_at ? 'Diterima' : item.revoked_at ? 'Dicabut' : new Date(item.expires_at)<=new Date() ? 'Kedaluwarsa' : 'Menunggu';
          row.append(textElement('p',`${item.role} · ${state} · Berlaku sampai ${displayTime(item.expires_at)}`,'field-help'));
          if (state==='Menunggu') addAction(row,'Cabut undangan',()=>{if (!confirm(`Cabut undangan ${item.email}?`)) return;void managementAction('#team-status',()=>api(`/api/invitations/${item.id}`,{method:'DELETE'}),loadTeam);});
        }
        container.append(row);
      }
      managementOffsets[kind]=result.nextOffset;$(`#${kind}-more`).hidden=result.nextOffset===null;
    }
    $('#team-status').textContent='Data anggota dan undangan dimuat.';
  } catch(error) {$('#team-status').textContent=error.message;}
}
$('#refresh-team').addEventListener('click',()=>loadTeam());
for (const kind of ['members','invitations']) $(`#${kind}-more`).addEventListener('click',()=>loadTeam(kind));
async function loadManagedAccounts() {
  $('#accounts-status').textContent='Memuat akun...';
  try {
    const result=await api('/api/threads/accounts/manage');if (!user) return;
    const list=$('#account-list');list.replaceChildren();
    for (const account of result.accounts) {
      const row=textElement('article','', 'management-row');row.append(textElement('h3',`@${account.username}`),textElement('p',account.status==='active' ? `Terhubung · Token berlaku sampai ${displayTime(account.token_expires_at) || 'tidak tersedia'} · Pembaruan token: ${({ok:'normal',retry:'menunggu percobaan ulang',reconnect:'perlu dihubungkan ulang'})[account.refresh_status] || account.refresh_status}` : 'Terputus · Token lokal telah dihapus','field-help'));
      const detail=textElement('p','', 'permission-details');detail.setAttribute('role','status');
      if (account.status==='active') {
        addAction(row,'Periksa izin',async()=>{
          if (busy) return;setBusy(true);detail.textContent='Memeriksa izin Meta...';
          try {
            const report=await api(`/api/threads/accounts/${account.id}/permissions`,{method:'POST'}),checked=report.accounts?.[0];
            if (report.status!=='ok' || !checked || checked.status!=='ok') throw new Error('Izin belum dapat diperiksa. Periksa konfigurasi server atau coba lagi.');
            detail.textContent=`Token: ${checked.valid ? 'valid' : 'tidak valid'}. App ID: ${checked.appMatches===null ? 'tidak dapat dicocokkan' : checked.appMatches ? 'sesuai' : 'berbeda'}. Izin tersedia: ${checked.granted.join(', ') || 'tidak ada'}. Izin kurang: ${checked.missing.join(', ') || 'tidak ada'}.`;
          } catch(error) {detail.textContent=error.message;} finally {setBusy(false);}
        });
        addAction(row,'Putuskan koneksi',()=>{if (!confirm(`Putuskan @${account.username} dari aplikasi ini? Jadwal yang belum diproses akan memerlukan tindakan. Izin di Meta tidak dicabut oleh tindakan ini.`)) return;void managementAction('#accounts-status',()=>api(`/api/threads/accounts/${account.id}`,{method:'DELETE'}),async()=>{await loadAccounts();await loadManagedAccounts();});});
      }
      addAction(row,'Hubungkan ulang',()=>$('#connect-threads').click());row.append(detail);list.append(row);
      const select=$('#filter-account');if (![...select.options].some(option=>option.value===account.id)) select.append(new Option(`@${account.username}`,account.id));
    }
    $('#accounts-status').textContent=result.accounts.length ? 'Status akun dimuat.' : 'Belum ada akun. Gunakan Hubungkan akun Threads untuk memulai.';
  } catch(error) {$('#accounts-status').textContent=error.message;}
}
$('#refresh-accounts').addEventListener('click',()=>loadManagedAccounts());
async function loadAudit(append=false) {
  $('#audit-status').textContent='Memuat aktivitas...';
  try {
    const result=await api(`/api/audit?offset=${append ? managementOffsets.audit : 0}`);if (!user) return;
    const list=$('#audit-list');if (!append) list.replaceChildren();
    for (const event of result.events) {
      const row=textElement('li','', 'history-entry'),subject=event.subject_label || `${({post:'Konten',member:'Anggota',invitation:'Undangan',threads_account:'Akun Threads'})[event.subject_type]} ${event.subject_id.slice(0,8)}`;
      row.append(textElement('strong',actionNames[event.action] || event.action),textElement('p',`${displayTime(event.created_at)} · ${event.actor_email || `Anggota ${event.actor_id.slice(0,8)}`} · ${subject}`,'field-help'));
      historyDetails(row,{details:event.details});list.append(row);
    }
    managementOffsets.audit=result.nextOffset;$('#audit-more').hidden=result.nextOffset===null;$('#audit-status').textContent=result.events.length || append ? 'Aktivitas dimuat.' : 'Belum ada aktivitas audit.';
  } catch(error) {$('#audit-status').textContent=error.message;}
}
$('#refresh-audit').addEventListener('click',()=>loadAudit());$('#audit-more').addEventListener('click',()=>loadAudit(true));
for (const link of document.querySelectorAll('[data-view]')) link.addEventListener('click', () => { document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el === link)); $('#filter').value = link.dataset.view; activateWorkspace('content'); });
(async () => {
  try {
    csrf = (await api('/api/auth/csrf')).csrfToken;
    try { user = (await api('/api/auth/me')).user; showWorkspace(); await loadAccounts(); await loadPosts(); }
    catch (error) { if (error.status !== 401) throw error; showLogin(); }
  } catch (error) { showLogin(); errorAt('#login-error', 'Aplikasi tidak dapat terhubung ke server. Muat ulang halaman atau coba masuk lagi.'); }
})();
