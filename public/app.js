const $ = selector => document.querySelector(selector);
const statusLabels = { draft: 'Draft', submitted: 'Menunggu tinjauan', approved: 'Disetujui', rejected: 'Ditolak' };
let csrf = '', user = null, posts = [], accounts = [], accountsAvailable = true, threadsConfigured = null, publishingEnabled = false, nextOffset = null, editing = null, scheduling = null, busy = false;
let threadsConnecting = false;
const linkParams = new URLSearchParams(location.hash.slice(1));
let verificationToken = linkParams.get('verify'), invitationToken = linkParams.get('invite'), resetToken = linkParams.get('reset');
let threadsResult = linkParams.get('threads');
if (verificationToken || invitationToken || resetToken || threadsResult) history.replaceState(null, '', location.pathname + location.search);

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.method && options.method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrf; }
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
  document.querySelectorAll('.action').forEach(button => { button.disabled = value; });
}
function showLogin() { if ($('#editor').open) $('#editor').close(); if ($('#invite-dialog').open) $('#invite-dialog').close(); if ($('#schedule-dialog').open) $('#schedule-dialog').close(); $('#initial-loading').hidden = true; $('#workspace').hidden = true; $('#login-screen').hidden = false; $('#password').value = ''; $('#login-form').hidden = !!invitationToken || !!resetToken; $('#accept-invitation-form').hidden = !invitationToken; $('#reset-request-form').hidden = true; $('#reset-confirm-form').hidden = !resetToken; }
function showWorkspace() {
  $('#initial-loading').hidden = true; $('#login-screen').hidden = true; $('#workspace').hidden = false;
  $('#sidebar-email').textContent = user.email;
  $('#sidebar-role').textContent = ({ admin: 'Admin', editor: 'Editor', reviewer: 'Reviewer' })[user.role] || user.role;
  $('#verified-notice').hidden = user.emailVerified;
  $('#confirm-verification').hidden = !verificationToken || user.emailVerified;
  $('#invite-team').hidden = user.role !== 'admin' || !user.emailVerified;
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
  $('#loading').hidden = false; errorAt('#workspace-error', '');
  try {
    const result = await api(`/api/posts?offset=${append ? nextOffset : 0}`);
    posts = append ? [...posts, ...result.posts] : result.posts;
    nextOffset = result.nextOffset;
    render();
  } catch (error) { errorAt('#workspace-error', error.message); }
  finally { $('#loading').hidden = true; }
}
async function loadAccounts() {
  threadsConfigured = null; publishingEnabled = false; renderThreadsConnection();
  try { const result = await api('/api/threads/accounts'); accounts = result.accounts; accountsAvailable = true; const config = await api('/api/threads/config'); threadsConfigured = config.configured === true; publishingEnabled = config.publishingEnabled === true; }
  catch (error) { if (error.status === 401) throw error; accounts = []; accountsAvailable = false; threadsConfigured = 'error'; }
  finally { if (user) renderThreadsConnection(); }
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
  else message.hidden = true;
}
function render() {
  const filter = $('#filter').value;
  const visible = filter === 'all' ? posts : posts.filter(post => post.status === filter);
  $('#empty').hidden = visible.length > 0;
  $('#empty-create').hidden = posts.length > 0;
  $('#list-wrap').hidden = visible.length === 0;
  $('#load-more').hidden = nextOffset === null;
  const list = $('#post-list'); list.replaceChildren();
  for (const post of visible) {
    const row = $('#post-template').content.firstElementChild.cloneNode(true);
    row.querySelector('.post-text').textContent = post.body;
    const created = new Date(post.created_at);
    row.querySelector('.post-created').textContent = `${Number.isNaN(created.getTime()) ? '' : `Dibuat ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(created)}`}${post.destination_username ? ` · @${post.destination_username}` : ''}`;
    const status = row.querySelector('.status'); status.textContent = statusLabels[post.status] || post.status; status.classList.add(post.status);
    const jobLabels = { scheduled: 'Terjadwal', preparing: 'Menyiapkan publikasi', prepared: 'Menyiapkan publikasi', publishing: 'Sedang menerbitkan', published: 'Terbit', confirmed_published: 'Terbit, dikonfirmasi anggota', uncertain: 'Hasil belum pasti, periksa Threads sebelum menentukan hasil', needs_action: 'Perlu tindakan', cancelled: 'Jadwal dibatalkan' };
    if (post.job_status && jobLabels[post.job_status]) {
      const extra = document.createElement('div'); extra.className = 'field-help';
      let when = '';
      try { if (post.scheduled_at && post.time_zone) when = ` · ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: post.time_zone }).format(new Date(post.scheduled_at))} (${post.time_zone})`; } catch { when = ''; }
      extra.textContent = jobLabels[post.job_status] + when; status.after(extra);
      if (post.job_status === 'needs_action') {
        const reasons = { meta_auth: 'Meta menolak akses. Periksa izin dan hubungkan ulang akun Threads.', meta_rejected: 'Meta menolak konten atau permintaan. Periksa isi dan izin akun sebelum mencoba lagi.', meta_unavailable: 'Meta tidak dapat dihubungi atau membatasi permintaan. Coba kembali nanti.', preconditions: 'Persetujuan, akses pengguna, atau akun Threads tidak lagi tersedia. Periksa kembali sebelum mencoba.', token_unreadable: 'Token tidak dapat dibaca. Periksa kunci server atau hubungkan ulang akun.', deadline: 'Batas percobaan satu jam telah lewat. Periksa konten dan jadwalkan kembali.' };
        if (reasons[post.failure_code]) extra.textContent += ` · ${reasons[post.failure_code]}`;
      }
    }
    const actions = row.querySelector('.post-actions');
    const own = post.created_by === user.id;
    const blocked = ['scheduled', 'preparing', 'prepared', 'publishing', 'published', 'confirmed_published', 'uncertain'].includes(post.job_status);
    const mayManage = own || user.role === 'admin' || user.role === 'reviewer';
    const mayPublish = user.emailVerified && mayManage;
    if (own && post.status !== 'submitted' && !blocked) addAction(actions, 'Ubah', () => openEditor(post));
    if (own && (post.status === 'draft' || post.status === 'rejected') && !blocked) addAction(actions, 'Ajukan', () => transition(post, 'submit'));
    if (post.status === 'submitted' && (user.role === 'admin' || user.role === 'reviewer')) {
      addAction(actions, 'Setujui', () => transition(post, 'approve'));
      addAction(actions, 'Tolak', () => transition(post, 'reject'));
    }
    if (post.status === 'approved' && mayPublish && post.destination_account_id && !blocked && publishingEnabled) {
      addAction(actions, 'Jadwalkan', () => openSchedule(post));
      addAction(actions, 'Terbitkan sekarang', () => publishNow(post));
    }
    if (post.job_status === 'scheduled' && mayManage) {
      if (publishingEnabled && mayPublish) addAction(actions, 'Ubah jadwal', () => openSchedule(post));
      addAction(actions, 'Batalkan jadwal', () => cancelSchedule(post));
    }
    if (post.job_status === 'uncertain' && mayManage) {
      addAction(actions, 'Sudah terbit', () => resolvePublication(post, 'published'));
      addAction(actions, 'Tidak terbit', () => resolvePublication(post, 'not_published'));
    }
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
  editing = post; $('#post-text').value = post?.body || ''; $('#editor-title').textContent = post ? 'Ubah draft' : 'Buat draft';
  const select = $('#post-account'); select.replaceChildren();
  const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Belum dipilih'; select.append(blank);
  for (const account of accounts) { const option = document.createElement('option'); option.value = account.id; option.textContent = `@${account.username}`; select.append(option); }
  if (post?.destination_account_id && !accounts.some(account => account.id === post.destination_account_id)) { const option = document.createElement('option'); option.value = post.destination_account_id; option.textContent = `@${post.destination_username || 'akun'} (tidak tersedia)`; select.append(option); }
  select.value = post?.destination_account_id || '';
  select.disabled = !accountsAvailable;
  $('#account-help').textContent = !accountsAvailable ? 'Daftar akun tidak dapat dimuat. Akun tujuan draft yang ada akan dipertahankan.' : accounts.length ? 'Pilih akun tujuan yang terhubung atau biarkan kosong.' : 'Belum ada akun Threads yang terhubung.';
  errorAt('#form-error', ''); $('#editor').showModal(); $('#post-text').focus();
}
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
  setBusy(true); errorAt('#workspace-error', '');
  try { await api(`/api/posts/${encodeURIComponent(post.id)}/schedules/${encodeURIComponent(post.job_id)}/resolve`, { method: 'POST', body: JSON.stringify({ revision: post.revision, decision, acknowledged: true }) }); await loadPosts(); }
  catch (error) { errorAt('#workspace-error', error.message); }
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
  if (!body) { errorAt('#form-error', 'Isi draft tidak boleh kosong.'); return; }
  setBusy(true); errorAt('#form-error', '');
  try {
    const payload = editing ? { body, revision: editing.revision } : { body };
    if (accountsAvailable) payload.destinationAccountId = $('#post-account').value || null;
    await api(editing ? `/api/posts/${encodeURIComponent(editing.id)}` : '/api/posts', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    $('#editor').close(); await loadPosts();
  } catch (error) { errorAt('#form-error', error.message); }
  finally { setBusy(false); }
});
$('#new-post').addEventListener('click', () => openEditor());
$('#empty-create').addEventListener('click', () => openEditor());
$('#close-editor').addEventListener('click', () => $('#editor').close());
$('#cancel-editor').addEventListener('click', () => $('#editor').close());
$('#filter').addEventListener('change', render);
$('#load-more').addEventListener('click', async () => { const button = $('#load-more'); button.disabled = true; try { await loadPosts(true); } finally { button.disabled = false; } });
for (const link of document.querySelectorAll('[data-view]')) link.addEventListener('click', () => { document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el === link)); $('#filter').value = link.dataset.view; render(); });
(async () => {
  try {
    csrf = (await api('/api/auth/csrf')).csrfToken;
    try { user = (await api('/api/auth/me')).user; showWorkspace(); await loadAccounts(); await loadPosts(); }
    catch (error) { if (error.status !== 401) throw error; showLogin(); }
  } catch (error) { showLogin(); errorAt('#login-error', 'Aplikasi tidak dapat terhubung ke server. Muat ulang halaman atau coba masuk lagi.'); }
})();
