# Rencana Pekerjaan

Status awal: perencanaan. Kotak belum dicentang bukan klaim bahwa pekerjaan sudah dilakukan. Urutan dapat disesuaikan berdasarkan dependensi.

## 0. Penyelarasan kebutuhan

- [x] Sinkronkan keputusan pada PRD bagian 12 ke bagian utama dan spesifikasi, terutama undangan, kerja tim/persetujuan, GoWhatsapp, retry satu jam, kapasitas, self-hosting dan retensi. Rinciannya masih harus diputuskan.
- [ ] Rinci matriks peran, hak akun Threads, aturan persetujuan dan penerima notifikasi. Keputusan awal: satu tim bersama; admin dan reviewer boleh menyetujui konten sendiri.
- [ ] Tentukan format konten MVP, cakupan 30 post/hari, jumlah pengguna, dan aturan retensi per jenis data.
- [ ] Tentukan integrasi GoWhatsapp, email, autentikasi API mesin, bootstrap admin dan target operasional. Stack TypeScript, Node.js, PostgreSQL, dan Docker Compose telah dipilih.

## 1. Validasi integrasi

- [ ] Verifikasi akses Meta, izin, alur otorisasi, token, publikasi teks/media, limit, dan proses review sesuai lingkungan target.
- [ ] Uji Google Sign-In, penyedia email dan undangan dalam lingkungan pengembangan.
- [ ] Uji kontrak GoWhatsapp aktual, autentikasi, hasil pengiriman, kesalahan dan timeout.
- [ ] Catat hasil serta perubahan pada `SPEC.md` dan risiko pada PRD.

## 2. Fondasi dan akses

- [x] Buat migrasi awal dan penyimpanan internal untuk konten, versi, dan persetujuan; uji dengan PostgreSQL berbasis WASM. Pengujian server PostgreSQL dan Docker masih diperlukan.
- [x] Tambahkan perintah terminal satu kali untuk bootstrap administrator dengan kata sandi tersembunyi dan hash tersalt. Pengujian PostgreSQL/Docker sungguhan masih diperlukan.
- [x] Tambahkan API login/logout lokal, sesi, CSRF, dan kontrak OpenAPI awal. Pengujian dengan PostgreSQL nyata, limiter bersama, halaman login, dan alur verifikasi email masih diperlukan.
- [x] Tambahkan penyimpanan dan validasi internal token verifikasi email sekali pakai.
- [x] Tambahkan adaptor SMTP generik dengan TLS, endpoint dan antarmuka untuk verifikasi email. Pengujian ke server SMTP nyata masih diperlukan.
- [x] Tambahkan undangan email sekali pakai, pembuatan akun lokal melalui tautan, serta antarmuka untuk admin dan penerima. Pengujian SMTP nyata, pencabutan manual, dan administrasi anggota masih diperlukan.
- [x] Tambahkan pemulihan kata sandi berbasis email dengan token sekali pakai dan pembatalan sesi lama; uji SMTP sungguhan dan pengamanan produksi masih diperlukan.
- [x] Tambahkan API draft dan persetujuan berbasis sesi, dengan baca tim, perubahan/pengajuan oleh pembuat, serta review oleh admin/reviewer.
- [x] Hubungkan antarmuka utama ke API login dan draft; sediakan mode pengembangan lokal persisten tanpa instalasi PostgreSQL. Pengujian visual browser dan deployment nyata masih diperlukan.
- [ ] Siapkan repository aplikasi, konfigurasi self-hosted, database/migrasi, penyimpanan media dan secret management sesuai stack yang dipilih.
- [ ] Implementasikan bootstrap admin, undangan, autentikasi lokal, verifikasi email, reset, sesi, Google dan penautan identitas aman.
- [ ] Implementasikan tim, keanggotaan, peran dan pemeriksaan akses backend serta audit.

## 3. Akun, konten, dan persetujuan

- [x] Catat hak akun Threads, siapkan panduan Meta App, fondasi penyimpanan token terenkripsi, daftar akun dan pilihan akun pada draft. Koneksi akun nyata belum diuji.
- [x] Buat klien awal pertukaran kode OAuth dan validasi profil dengan respons uji. Pengujian Meta nyata masih diperlukan.
- [x] Tambahkan endpoint OAuth, state sekali pakai terikat sesi, konfigurasi dan tombol koneksi admin. Pengujian Meta sungguhan, pemeriksaan izin yang diberikan, refresh token dan hardening produksi masih diperlukan.
- [x] Perbaiki tombol koneksi: periksa ulang status email/config, tampilkan proses dan pesan kegagalan, serta tautan lanjut OAuth. Uji klik kondisi siap, belum siap, gagal server, dan verifikasi dari tab lain dengan respons simulasi.
- [x] Gunakan tujuan otorisasi Threads langsung dan validasi parameter sebelum navigasi; uji bahwa `client_id` tersertakan dan URL tanpa ID diblokir. Penyebab error Meta 4476002 pada instalasi pengguna masih perlu diagnosis runtime.
- [x] Pertahankan ID numerik besar pada pertukaran OAuth dan tampilkan diagnosis tahap callback dengan log aman. Uji sesi hilang/kedaluwarsa, penolakan, respons rusak, dan kebocoran data sensitif; uji Meta nyata masih diperlukan.
- [x] Sesuaikan pertukaran token jangka panjang dengan parameter `access_token` pada GET sesuai contoh Meta; uji parameter dan penyamaran kegagalan transport. Konfirmasi ulang dengan akun Meta nyata masih diperlukan.
- [x] Tampilkan subkode/kategori Meta yang aman agar penolakan tester/App Review, izin, dan kredensial dapat dibedakan tanpa membuka pesan mentah. Uji kategori dari respons simulasi dan tidak bocornya secret.
- [x] Pengguna melaporkan koneksi OAuth berhasil setelah akun Threads diundang dan menerima peran tester. Pengujian izin secara menyeluruh dan publikasi Meta nyata masih perlu dicatat.
- [x] Tambahkan satu lampiran gambar/video, pratinjau, volume Docker persisten, URL HTTPS bertanda tangan, validasi sisi server, versi media dan polling kontainer. Uji Meta, Docker dan PostgreSQL sungguhan, backup/restore serta pembersihan berkas yatim masih diperlukan.
- [x] Tambahkan refresh token otomatis dan status koneksi yang memerlukan tindakan; uji menggunakan respons Meta simulasi. Uji dengan token nyata masih diperlukan.
- [ ] Lengkapi koneksi Threads dengan pemeriksaan izin dan pemutusan akun.
- [x] Tambahkan carousel gambar dan rangkaian balasan dengan pemecahan otomatis, versi konten, serta penanganan hasil sebagian. Pengujian Meta sungguhan untuk kedua fitur masih diperlukan.
- [x] Tambahkan scope balasan ke OAuth dan diagnosis kode Meta yang aman setelah laporan rangkaian berhenti pada bagian kedua. Otorisasi ulang dan uji Meta nyata masih diperlukan untuk memastikan penyebab dan hasilnya.
- [x] Tambahkan perintah server untuk memeriksa scope token melalui endpoint debug Meta tanpa menampilkan token; hasil dan perilaku endpoint masih perlu diverifikasi pada instalasi pengguna.
- [x] Tangani penolakan 24/4279009 pada persiapan balasan dengan jeda antarbagian, pemeriksaan target dan backoff terbatas; uji bahwa bagian terbit tidak diulang dan tenggat tetap berlaku. Tambahkan diagnosis target melalui ID pekerjaan; konfirmasi Meta nyata masih diperlukan.
- [x] Tambahkan pembandingan tautan publik target dengan daftar posting Meta untuk mendiagnosis penolakan pembacaan ID 100/33; hasil instalasi pengguna masih diperlukan sebelum menyimpulkan perbaikan target.
- [ ] Lengkapi validasi media/teks terhadap semua batas Meta, tampilan riwayat versi, retensi dan pembersihan berkas yatim.
- [ ] Validasi kebijakan persetujuan dan pembatalannya terhadap seluruh alur UI, API dan kondisi bersamaan.

## 4. Publikasi dan notifikasi

- [x] Implementasikan penjadwalan dan penerbitan teks dengan worker opt-in, lease, tenggat, backoff aman dan konfirmasi manual untuk hasil belum pasti. Uji Meta serta PostgreSQL sungguhan dan kelengkapan penanganan limit masih diperlukan.
- [x] Tambahkan diagnosis aman untuk kegagalan persiapan dan uji simulasi dari permintaan publikasi sampai status terbit. Uji posting dengan akun Meta sungguhan masih diperlukan.

- [ ] Validasi jadwal UTC/zona waktu, antrean persisten, klaim atomik, lease, batas satu jam dan riwayat pada PostgreSQL serta deployment nyata.
- [ ] Lengkapi klasifikasi error dan rekonsiliasi publikasi; uji penerbitan sekarang/terjadwal dengan Meta sungguhan.
- [ ] Implementasikan dashboard, kalender, status, notifikasi aplikasi dan GoWhatsapp dengan riwayat pengiriman.

## 5. API dan kesiapan rilis

- [ ] Tetapkan kontrak API integrasi, hak, autentikasi, idempotensi, versi, error dan dokumentasi OpenAPI yang tervalidasi.
- [ ] Uji end-to-end alur tim, persetujuan, akun dan publikasi; uji batas akses UI dan API mesin.
- [ ] Uji restart, timeout, persaingan worker, tenggat, zona waktu, token kedaluwarsa dan kegagalan notifikasi.
- [ ] Siapkan monitoring, alert, backup/restore, prosedur operasional, kapasitas dan kebijakan retensi.
- [ ] Jalankan pilot dan evaluasi indikator serta kriteria rilis PRD.
