# Threads Automation

Proyek aplikasi internal untuk pengelolaan dan penjadwalan konten Threads. Aplikasi utama menyediakan login, draft, carousel gambar, rangkaian balasan, persetujuan, serta penjadwalan dan penerbitan untuk pengujian terbatas.

Yang tersedia: antarmuka utama, login lokal, database, lampiran media, draft, dan persetujuan. Aplikasi utama terpisah dari demo; data keduanya tidak digabungkan.

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

Pengguna melaporkan koneksi OAuth dan penerbitan satu gambar berhasil dengan akun Threads Tester. Carousel, rangkaian balasan dan refresh token baru diuji dengan respons Meta simulasi. Belum tersedia: pengelolaan anggota setelah bergabung, Google Sign-In, GoWhatsapp, serta akses API untuk integrasi mesin. Draft membutuhkan teks atau lampiran. Undangan dan verifikasi email tersedia jika SMTP dikonfigurasi; hasil pengujian SMTP nyata belum didokumentasikan. Hardening, backup dan pemantauan produksi masih diperlukan.

## Pengembangan lokal

Gunakan Node.js 24 dan PostgreSQL. Unggahan video memerlukan `ffprobe` dari FFmpeg pada PATH; image Docker memasukkannya. Jalankan `npm ci`, lalu atur `DATABASE_URL`, `APP_ORIGIN` (misalnya `http://localhost:3000`) dan `SESSION_SECRET` acak minimal 32 byte sebagai environment variables; `PORT` opsional. File `.env.example` hanya contoh dan tidak dimuat otomatis. Setelah migrasi, jalankan `npm run dev`. Endpoint `/health/live` memeriksa proses dan `/health/ready` hanya memeriksa koneksi database. `npm test` menjalankan pengujian dan `npm run build` mengompilasi proyek.

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

Panel **Hubungkan akun Threads** berada di halaman utama setelah masuk. Tombol dapat dipakai oleh admin dengan email terverifikasi setelah konfigurasi Threads tersedia. Panel menjelaskan jika salah satu syarat tersebut belum terpenuhi. Email diverifikasi melalui tombol **Kirim email verifikasi**, yang memerlukan SMTP yang telah dikonfigurasi.

Klik tombol akan memeriksa ulang akun dan konfigurasi terbaru. Jika email baru diverifikasi melalui tab lain, klik kembali tanpa perlu keluar dan masuk. Jika belum memenuhi syarat, pesan tampil langsung di panel koneksi. Saat siap, aplikasi mengarahkan browser ke otorisasi Threads; tautan **Lanjutkan ke otorisasi Threads** tersedia jika perpindahan otomatis tidak terjadi. Pemeriksaan admin, email, CSRF, dan state OAuth tetap dilakukan di server.

## Penjadwalan dan penerbitan

Pengguna mengonfirmasi penerbitan satu gambar melalui Meta berhasil. Carousel, rangkaian dan refresh token belum diuji end-to-end dengan Meta, Docker, atau server PostgreSQL sungguhan. Worker publikasi dinonaktifkan secara default, termasuk pada `npm run local`. Setelah mengonfigurasi OAuth, SMTP, HTTPS dan migrasi, operator dapat mengaktifkannya dengan `PUBLISH_WORKER_ENABLED=true` dan memulai ulang aplikasi. Pengaktifan worker akan memproses pekerjaan yang jatuh tempo.

Admin menghubungkan akun Threads. Anggota membuat draft teks dan mengajukannya; admin atau reviewer menyetujui. Pembuat draft, admin, atau reviewer dapat menjadwalkan, mengubah waktu, membatalkan sebelum diproses, atau menerbitkan sekarang. Waktu disimpan dalam UTC bersama zona waktu yang dipilih; mengubah waktu saja tidak membatalkan persetujuan. Token yang akan kedaluwarsa sebelum jadwal harus dihubungkan ulang.

Worker mencatat percobaan dan hanya mencoba ulang kegagalan sementara yang aman sebelum tahap publikasi, dengan jeda bertambah dan tenggat satu jam. Untuk media, worker memeriksa status kontainer sampai siap. Jika hasil pengiriman ke Meta tidak dapat dipastikan, periksa Threads secara manual; aplikasi tidak otomatis mengirim ulang. Pada rangkaian, bagian yang sudah terbit tidak diulang. Jika bagian yang hasilnya belum pasti dinyatakan terbit dan masih ada balasan, masukkan ID numerik bagian tersebut; server mencoba memverifikasi akun, isi, dan target balasan dengan Meta sebelum melanjutkan. Verifikasi memeriksa hingga 50 posting/balasan terbaru dan dapat memerlukan izin Meta; jika gagal, rangkaian tetap berhenti. Tindakan **Lanjutkan rangkaian** secara eksplisit memulai jendela percobaan satu jam yang baru.

Jika konfigurasi Threads tersedia, proses aplikasi memeriksa token secara otomatis setiap 15 menit. Token yang masih berlaku dan berjarak maksimal 14 hari dari kedaluwarsa diperbarui, dengan jeda dan percobaan ulang untuk gangguan sementara. Jika Meta menolak token, atau token terlanjur kedaluwarsa, admin perlu menghubungkan ulang akun. Jadwal baru masih dibatasi sebelum waktu kedaluwarsa token yang saat ini tersimpan; penjadwalan tidak mengasumsikan refresh pasti berhasil.

Untuk instalasi Compose yang sudah ada, backup database dan volume media terlebih dahulu. Tunggu sampai tidak ada publikasi yang sedang diproses, lalu hentikan semua instance aplikasi lama agar worker lama tidak mengambil pekerjaan bermedia. Ambil kode baru dan jalankan:

```bash
docker compose stop app
docker compose build app
docker compose run --rm app npm run migrate
docker compose up -d app
```

Aktifkan worker dengan `PUBLISH_WORKER_ENABLED=true` di `.env` hanya saat siap memproses antrean. Pastikan `APP_ORIGIN`, konfigurasi Threads dan SMTP sudah benar serta email admin terverifikasi. Setelah menghubungkan akun, buat draft, ajukan, setujui, lalu pilih **Terbitkan sekarang**. Muat ulang daftar untuk melihat hasil. Jika berstatus **Perlu tindakan**, baca petunjuk di bawah status; jangan membagikan token atau secret saat meminta bantuan.

## Media

Compose menyimpan media dalam named volume `media`, terpisah dari volume database. Backup dan pulihkan keduanya bersama-sama; menghapus volume akan menghapus lampiran. Di luar Compose, `MEDIA_DIR` memilih direktori penyimpanan (default `.local-media`); `npm run local` memakai direktori media di bawah `.local-data`. Pastikan direktori dimiliki pengguna aplikasi dan tersedia ruang disk yang cukup.

Satu draft dapat berisi teks, hingga sepuluh gambar, atau satu video. Dua atau lebih gambar membentuk carousel; urutan dapat diubah. Rangkaian berisi maksimal sepuluh bagian dengan masing-masing maksimal 500 karakter; media berada pada bagian pertama. Gambar JPEG/PNG maksimal 8 MiB dinormalisasi menjadi JPEG, diputar sesuai orientasi dan diperkecil hingga 1440 piksel per sisi; transparansi diratakan ke putih. Video dibatasi 100 MiB, MP4 H.264, 3–300 detik, 23–60 fps, maksimal 1920 piksel per sisi, dengan maksimal satu audio AAC 48 kHz. Ini adalah batas aplikasi untuk pengujian; Meta tetap memeriksa persyaratan format lainnya. Mengubah konten atau lampiran membuat versi baru yang perlu disetujui kembali.

Unggahan yang belum terikat versi hanya dapat dilihat/dihapus pengunggah; seluruh anggota tim dapat melihat lampiran yang sudah terikat ke versi konten. Berkas versi lama dipertahankan. Kapasitas metadata media dibatasi 20 GB; berkas sementara dan sisa akibat proses terhenti tidak dihitung dalam kuota tersebut, sehingga ruang disk tetap harus dipantau. Penghapusan otomatis berkas yatim, kebijakan retensi terperinci, dan backup/restore teruji belum tersedia.

Untuk menerbitkan media, `APP_ORIGIN` harus HTTPS dan dapat diakses Meta. Server membuat URL unduhan bertanda tangan yang berlaku dua jam untuk pekerjaan dan lampiran tertentu. Siapa pun yang memiliki URL itu dapat mengunduh berkas selama berlaku. Konfigurasikan reverse proxy, CDN, dan sistem log agar **tidak mencatat path `/media-fetch/`**, karena path tersebut mengandung tanda tangan; jangan bagikan URL itu. Tanda tangan menggunakan `SESSION_SECRET` yang harus konsisten antar-instance; perubahan secret membatalkan URL media yang masih digunakan. Pengujian akses dari Meta, konfigurasi proxy, dan penanganan video dengan Docker nyata masih diperlukan.

Pastikan proxy tidak menambahkan login pada `/media-fetch/` dan meneruskan permintaan `GET` serta header `Range`, agar Meta dapat mengambil video. Sesuaikan batas ukuran unggahan proxy untuk multipart 100 MiB; misalnya pada Nginx gunakan `client_max_body_size 101m` di konfigurasi server atau location aplikasi. Batas CDN/proxy di depan server juga dapat membatasi unggahan sebelum mencapai aplikasi.
