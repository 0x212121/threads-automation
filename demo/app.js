const KEY = 'threads-automation-demo-v1';
const $ = (selector) => document.querySelector(selector);
const labels = { draft: 'Draft', submitted: 'Menunggu tinjauan', approved: 'Disetujui', scheduled: 'Dijadwalkan' };
let posts = [];
let selectedView = 'ringkasan';
let editingId = null;
let storageAvailable = true;

function readPosts() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.some(p => !p || typeof p.id !== 'string' || typeof p.text !== 'string' || !Object.hasOwn(labels, p.status))) throw new Error('invalid');
    posts = parsed;
  } catch {
    storageAvailable = false;
    showStorageError('Data demo tidak dapat dibaca. Pastikan penyimpanan browser tersedia; data lama tidak diubah.');
  }
}
function persist(next) {
  try {
    if (!storageAvailable) throw new Error('unavailable');
    localStorage.setItem(KEY, JSON.stringify(next));
    posts = next;
    render();
    return true;
  } catch {
    showStorageError('Perubahan tidak tersimpan. Periksa ruang dan izin penyimpanan browser.');
    return false;
  }
}
function showStorageError(message) { const box = $('#storage-error'); box.textContent = message; box.hidden = false; }
function formatDate(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Belum ditentukan';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function localInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function openEditor(post = null) {
  editingId = post?.id ?? null;
  $('#editor-title').textContent = post ? 'Ubah draft' : 'Buat konten';
  $('#post-text').value = post?.text ?? '';
  $('#post-schedule').value = localInput(post?.schedule);
  $('#form-error').hidden = true;
  $('#editor').showModal();
  $('#post-text').focus();
}
function addAction(container, label, fn) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'action'; button.textContent = label;
  button.addEventListener('click', fn); container.append(button);
}
function updatePost(id, changes) { persist(posts.map(post => post.id === id ? { ...post, ...changes } : post)); }
function render() {
  $('#total').textContent = String(posts.length);
  $('#pending').textContent = String(posts.filter(p => p.status === 'submitted').length);
  $('#review-count').textContent = $('#pending').textContent;
  $('#approved').textContent = String(posts.filter(p => p.status === 'approved' || p.status === 'scheduled').length);
  const filter = $('#filter').value;
  const viewPosts = selectedView === 'persetujuan' ? posts.filter(p => p.status === 'submitted') : posts;
  const visible = filter === 'all' ? viewPosts : viewPosts.filter(p => p.status === filter);
  $('#list-count').textContent = String(visible.length);
  $('#loading').hidden = true;
  $('#empty').hidden = visible.length !== 0;
  $('#list-wrap').hidden = visible.length === 0;
  const emptyHeading = $('#empty h3'), emptyText = $('#empty p');
  emptyHeading.textContent = posts.length ? 'Tidak ada konten untuk tampilan ini' : 'Belum ada konten di sini';
  emptyText.textContent = posts.length ? 'Ubah filter atau buat konten baru untuk melanjutkan.' : 'Mulai dari satu ide. Buat draft pertamamu dan lihat alur peninjauannya.';
  $('#empty-create').hidden = posts.length > 0;
  const list = $('#post-list'); list.replaceChildren();
  for (const post of [...visible].reverse()) {
    const row = $('#post-template').content.firstElementChild.cloneNode(true);
    row.querySelector('.post-text').textContent = post.text;
    row.querySelector('.post-created').textContent = `Dibuat ${formatDate(post.createdAt)}`;
    const status = row.querySelector('.status'); status.textContent = labels[post.status]; status.classList.add(post.status);
    row.querySelector('.post-schedule').textContent = post.schedule ? formatDate(post.schedule) : 'Belum ditentukan';
    const actions = row.querySelector('.post-actions');
    if (post.status !== 'submitted') addAction(actions, 'Ubah', () => openEditor(post));
    if (post.status === 'draft') addAction(actions, 'Ajukan', () => updatePost(post.id, { status: 'submitted' }));
    if (post.status === 'submitted') {
      addAction(actions, 'Setujui', () => updatePost(post.id, { status: post.schedule ? 'scheduled' : 'approved' }));
      addAction(actions, 'Kembalikan', () => updatePost(post.id, { status: 'draft' }));
    }
    addAction(actions, 'Hapus', () => { if (confirm('Hapus konten demo ini dari browser?')) persist(posts.filter(p => p.id !== post.id)); });
    list.append(row);
  }
}
$('#new-post').addEventListener('click', () => openEditor());
$('#empty-create').addEventListener('click', () => openEditor());
$('#close-editor').addEventListener('click', () => $('#editor').close());
$('#cancel-editor').addEventListener('click', () => $('#editor').close());
$('#filter').addEventListener('change', render);
$('#post-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('#post-text').value.trim();
  const input = $('#post-schedule').value;
  const date = input ? new Date(input) : null;
  const error = $('#form-error');
  if (!text || (date && (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() || localInput(date.toISOString()) !== input))) {
    error.textContent = !text ? 'Isi konten tidak boleh kosong.' : 'Pilih waktu mendatang yang valid pada perangkat ini.';
    error.hidden = false; return;
  }
  const schedule = date ? date.toISOString() : null;
  const previous = posts.find(p => p.id === editingId);
  const post = { id: previous?.id ?? crypto.randomUUID(), text, schedule, status: 'draft', createdAt: previous?.createdAt ?? new Date().toISOString() };
  if (persist(previous ? posts.map(p => p.id === previous.id ? post : p) : [...posts, post])) $('#editor').close();
  else { error.textContent = 'Draft tidak dapat disimpan. Periksa penyimpanan browser dan coba lagi.'; error.hidden = false; }
});
for (const link of document.querySelectorAll('[data-view]')) link.addEventListener('click', () => {
  selectedView = link.dataset.view;
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el === link));
  const viewLabels = { ringkasan: 'Ringkasan', konten: 'Semua konten', persetujuan: 'Persetujuan' };
  $('#breadcrumb').textContent = viewLabels[selectedView];
  $('#list-title').firstChild.textContent = selectedView === 'persetujuan' ? 'Menunggu tinjauan ' : 'Semua konten ';
  $('#list-subtitle').textContent = selectedView === 'persetujuan' ? 'Konten yang diajukan untuk ditinjau.' : 'Semua ide dan rencana dalam satu tempat.';
  $('#filter').value = 'all'; render();
});
readPosts();
render();
