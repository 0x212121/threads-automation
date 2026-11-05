# Threads Automation

Proyek aplikasi internal untuk pengelolaan dan penjadwalan konten Threads. Aplikasi utama menyediakan login, draft teks, persetujuan, serta penjadwalan dan penerbitan teks Threads untuk pengujian terbatas.

Yang tersedia: antarmuka utama, login lokal, penyimpanan database, draft teks, dan persetujuan. Aplikasi utama terpisah dari demo; data keduanya tidak digabungkan.

## Menjalankan aplikasi utama secara lokal

Untuk pengembangan dan uji pada komputer sendiri, jalankan:

```powershell
npm install
npm run local
```

Pada peluncuran pertama, masukkan dan ulangi kata sandi administrator di terminal (masukan tidak ditampilkan). Setelah muncul alamat aplikasi, buka `http://127.0.0.1:3000` dan masuk menggunakan `wijaya.indra2196@gmail.com` serta kata sandi yang baru dibuat. Tekan Ctrl+C di terminal untuk berhenti. Menjalankan perintah yang sama lagi akan menggunakan data dan akun yang sudah ada.

Mode ini menjalankan PostgreSQL berbasis WASM lokal dan menyimpan data di `.local-data`. Layanan aplikasi dan socket database hanya mendengarkan loopback; socket database tidak memakai autentikasi dan dapat diakses proses lain pada komputer yang sama. Gunakan hanya untuk pengembangan lokal dengan data uji, bukan produksi atau komputer bersama. Sesi dibatalkan setiap kali aplikasi dimulai ulang. Untuk memakai port aplikasi lain, atur `LOCAL_PORT` (1024 sampai 65535) sebelum menjalankan perintah dan buka alamat yang ditampilkan.

## Demo tanpa database

Jalankan `npm run demo`, lalu buka `http://127.0.0.1:4173`. Demo hanya menggunakan Node.js dan penyimpanan lokal browser; tidak memerlukan database atau akun. Demo menyediakan alur draft, pengajuan, persetujuan, filter, dan jadwal simulasi. Tidak ada login, sinkronisasi tim, koneksi Threads, notifikasi, atau publikasi otomatis. Menghapus data situs di browser akan menghapus data demo. Untuk menggunakan port lain, atur environment variable `DEMO_PORT` sebelum menjalankan server.

OAuth Threads telah ditambahkan dan diuji dengan respons simulasi, tetapi belum diuji terhadap Meta sungguhan. Belum tersedia: pengelolaan anggota setelah bergabung, pembaruan otomatis token Threads, penerbitan media, Google Sign-In, GoWhatsapp, serta akses API untuk integrasi mesin. Draft mendukung teks nonkosong dan pilihan akun Threads aktif; draft kosong dan media belum tersedia. Undangan dan verifikasi email tersedia jika SMTP dikonfigurasi dan belum diuji dengan layanan nyata. Jangan gunakan untuk produksi.

## Pengembangan lokal

Gunakan Node.js 24 dan PostgreSQL. Jalankan `npm ci`, lalu atur `DATABASE_URL`, `APP_ORIGIN` (misalnya `http://localhost:3000`) dan `SESSION_SECRET` acak minimal 32 byte sebagai environment variables; `PORT` opsional. File `.env.example` hanya contoh dan tidak dimuat otomatis. Setelah migrasi, jalankan `npm run dev`. Endpoint `/health/live` memeriksa proses dan `/health/ready` hanya memeriksa koneksi database. `npm test` menjalankan pengujian dan `npm run build` mengompilasi proyek.

Untuk menerapkan migrasi pada database pengembangan, jalankan `npm run build` diikuti `npm run migrate` dengan `DATABASE_URL` atau variabel `PGHOST`, `PGDATABASE`, `PGUSER`, dan `PGPASSWORD` yang sudah dikonfigurasi. Migrasi mencatat checksum dan tidak mengubah ulang migrasi yang sudah diterapkan. Buat backup sebelum menerapkan perubahan pada database yang berisi data. Migrasi belum berjalan otomatis saat service dimulai.

Setelah migrasi, operator yang memiliki akses terminal server dapat menjalankan `npm run bootstrap-admin` untuk membuat administrator awal satu kali. Perintah meminta kata sandi minimal 12 karakter dan konfirmasi melalui terminal interaktif tanpa menampilkannya. Jangan memasukkan kata sandi lewat argumen, environment variable, atau pipe. Untuk Docker Compose gunakan `docker compose exec -it app npm run bootstrap-admin`. Proses ini menetapkan alamat administrator yang disepakati di PRD; status email tetap belum terverifikasi sampai pengguna menyelesaikan verifikasi email. Bootstrap dan migrasi belum diuji pada server PostgreSQL atau Docker sungguhan.

## Verifikasi email

Konfigurasikan `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true` untuk TLS langsung, `false` untuk STARTTLS), `SMTP_FROM`, serta `SMTP_USER` dan `SMTP_PASSWORD` jika server membutuhkan autentikasi. Atur sebagai environment variables sebelum memulai aplikasi; lihat `.env.example`, yang tidak dimuat otomatis. SMTP harus mendukung TLS dan sertifikat yang valid. Setelah masuk, gunakan tombol **Kirim email verifikasi**, buka tautan dalam email pada browser, masuk dengan akun yang sama jika diminta, lalu pilih **Konfirmasi email**. Tautan hanya berlaku satu kali selama 24 jam.

Gunakan `APP_ORIGIN` yang dapat diakses penerima dan cocok persis dengan origin aplikasi. Dalam `npm run local`, tautan menggunakan alamat loopback dan hanya dapat dibuka di komputer yang menjalankan aplikasi. Jangan menyimpan kredensial SMTP di repository atau mengirimkannya melalui chat. Integrasi SMTP baru diuji dengan transport palsu, bukan server email sungguhan.

## Mengundang anggota

Administrator yang telah memverifikasi email dapat memilih **Undang anggota**, memasukkan email dan peran, lalu mengirim undangan. Penerima membuka tautan dan membuat kata sandi; tautan berlaku tujuh hari dan hanya dapat dipakai sekali. Kepemilikan alamat dibuktikan dengan menggunakan tautan yang dikirim kepadanya. Pengiriman ulang membuat tautan sebelumnya tidak berlaku. Undangan memerlukan SMTP dan `APP_ORIGIN` yang dapat diakses penerima. Mode lokal hanya untuk pengujian pada komputer yang sama.

## Pemulihan kata sandi

Pilih **Lupa kata sandi?** pada halaman login, kemudian masukkan email akun. Jika akun ada dan aktif, tautan pemulihan dikirim melalui SMTP. Tautan berlaku satu jam dan hanya dapat digunakan sekali. Setelah kata sandi baru disimpan, sesi lama tidak lagi berlaku. Respons permintaan tetap sama jika akun tidak ditemukan atau pengiriman gagal; periksa konfigurasi SMTP bila tautan tidak diterima. Pembatas permintaan masih per proses dan pengiriman SMTP nyata belum diuji.

Kontrak API awal tersedia di `/openapi.json` dan [openapi.json](openapi.json). Untuk sesi browser, minta `GET /api/auth/csrf`, simpan cookie, lalu kirim `POST /api/auth/login` dengan `Origin` sesuai `APP_ORIGIN`, header `X-CSRF-Token`, dan JSON email/password. Gunakan token baru dari respons login untuk logout. Endpoint ini memakai cookie sesi browser, bukan kredensial API integrasi mesin.

## Self-hosting untuk pengembangan

Dengan Docker Compose, atur `POSTGRES_PASSWORD`, `SESSION_SECRET` dan `APP_ORIGIN` (origin HTTPS) dalam environment lalu jalankan `docker compose up --build`. Image menggunakan mode produksi dan membutuhkan reverse proxy HTTPS; atur `TRUST_PROXY=1` hanya jika aplikasi benar-benar hanya menerima koneksi dari satu proxy tepercaya. Untuk menjalankan migrasi secara terpisah, gunakan `docker compose exec app npm run migrate`. Jangan commit secret. Service hanya dipublikasikan ke loopback host. Konfigurasi ini belum divalidasi di lingkungan saat ini dan belum mencakup proxy/TLS, backup, atau kontrol akses produksi.

Pembatasan login dan token CSRF saat ini disimpan dalam memori proses, sehingga tidak berlaku bersama di beberapa instance dan hilang saat restart. Tambahkan penyimpanan limiter bersama dan kebijakan percobaan yang sesuai sebelum produksi.

Lihat [PRD](PRD.md), [spesifikasi](SPEC.md), dan [daftar pekerjaan](TASKS.md).

Persiapan Meta App tersedia di [panduan Meta App](docs/META_APP_SETUP.md). Jangan kirim App Secret atau token ke chat.

Untuk menguji OAuth, jalankan aplikasi melalui HTTPS dengan `APP_ORIGIN` yang sesuai, lalu atur `THREADS_APP_ID`, `THREADS_APP_SECRET`, dan `THREADS_TOKEN_KEY` pada lingkungan server. Ketiganya wajib diisi bersamaan. Kunci token berupa 32 byte acak yang dikodekan base64url, terpisah dari `SESSION_SECRET` dan disimpan secara persisten. Mengganti atau kehilangan kunci membuat token yang sudah dienkripsi tidak dapat dibaca. File `.env` di folder proyek diabaikan Git dan dapat digunakan oleh Docker Compose, tetapi tidak dimuat otomatis oleh `npm run local`. Atur izin file sesuai lingkungan dan jangan bagikan isinya.

Callback yang didaftarkan di Meta harus persis `APP_ORIGIN` diikuti `/api/threads/oauth/callback`. Misalnya jika origin `https://contoh-domain.test`, callback adalah `https://contoh-domain.test/api/threads/oauth/callback`. Domain tersebut harus benar-benar mengarah ke aplikasi melalui reverse proxy HTTPS. Hindari mencatat query pada path callback di log proxy karena dapat mengandung kode otorisasi. Meta OAuth dan proxy nyata belum diuji; mode `npm run local` hanya HTTP dan menonaktifkan OAuth. Email admin harus terverifikasi sebelum menghubungkan akun.

## Penjadwalan dan penerbitan teks

Fitur ini baru diuji dengan respons Meta simulasi, belum dengan akun Threads atau server PostgreSQL sungguhan. Worker dinonaktifkan secara default, termasuk pada `npm run local`. Setelah mengonfigurasi OAuth, SMTP, HTTPS dan migrasi, operator dapat mengaktifkannya di lingkungan pengujian dengan `PUBLISH_WORKER_ENABLED=true` dan memulai ulang aplikasi. Pastikan konfigurasi Threads lengkap; tombol penjadwalan tidak tersedia saat worker dinonaktifkan. Pengaktifan worker akan memproses pekerjaan yang jatuh tempo.

Admin menghubungkan akun Threads. Anggota membuat draft teks dan mengajukannya; admin atau reviewer menyetujui. Pembuat draft, admin, atau reviewer dapat menjadwalkan, mengubah waktu, membatalkan sebelum diproses, atau menerbitkan sekarang. Waktu disimpan dalam UTC bersama zona waktu yang dipilih; mengubah waktu saja tidak membatalkan persetujuan. Token yang akan kedaluwarsa sebelum jadwal harus dihubungkan ulang.

Worker mencatat percobaan dan hanya mencoba ulang kegagalan sementara yang aman sebelum tahap publikasi, dengan jeda bertambah dan tenggat satu jam. Jika hasil pengiriman ke Meta tidak dapat dipastikan, periksa akun Threads secara manual sebelum menandai hasilnya; aplikasi tidak otomatis mengirim ulang karena dapat membuat duplikat. Hasil konfirmasi manual dicatat. Penerbitan media, pembaruan token otomatis, validasi batas konten sebelum pengiriman, dan pengujian Meta nyata masih diperlukan.

Untuk instalasi Compose yang sudah ada, ambil perubahan proyek di server, lalu jalankan `docker compose build app`, `docker compose run --rm app npm run migrate`, dan `docker compose up -d app` secara berurutan. Backup database sebelum migrasi. Aktifkan worker dengan `PUBLISH_WORKER_ENABLED=true` di `.env` hanya saat siap memproses antrean. Pastikan `APP_ORIGIN`, konfigurasi Threads dan SMTP sudah benar serta email admin terverifikasi. Setelah menghubungkan akun, buat draft teks, ajukan, setujui, lalu pilih **Terbitkan sekarang**. Muat ulang daftar untuk melihat hasil. Jika berstatus **Perlu tindakan**, baca petunjuk di bawah status; jangan membagikan token atau secret saat meminta bantuan.
