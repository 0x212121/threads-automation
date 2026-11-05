# Spesifikasi Teknis — Threads Post Automation

**Status:** Draf awal, 4 November 2026. Dokumen ini menerjemahkan [PRD](PRD.md) menjadi rancangan untuk ditinjau; keputusan yang ditandai terbuka belum menjadi ketentuan final.

## 1. Konteks dan keputusan produk

Aplikasi digunakan secara internal, self-hosted, dengan pengguna berbasis undangan. Mendukung login lokal dan Google, pengelolaan tim dan persetujuan konten pada MVP, serta API yang terdokumentasi dengan OpenAPI untuk integrasi sistem lain. Satu tim digunakan bersama; semua anggota dapat melihat draft, hanya pembuat yang boleh mengubah dan mengajukan draft, sedangkan admin dan reviewer dapat menyetujui termasuk konten sendiri. Hanya admin menghubungkan akun Threads; semua anggota dapat memilih akun terhubung sebagai tujuan draft. Stack yang dipilih adalah TypeScript pada Node.js, PostgreSQL, dan Docker Compose. Email transaksional menggunakan SMTP generik yang akan dikonfigurasi kemudian. Perencanaan kapasitas awal: empat akun Threads per pengguna, 30 post per hari (cakupan total atau per pengguna belum ditentukan), dan 20 GB penyimpanan. Retensi data setidaknya 90 hari; cakupan dan pengecualian harus ditetapkan. Target ketepatan publikasi lima menit, dan percobaan otomatis berhenti setelah satu jam dari jadwal.

**Penyelarasan PRD:** keputusan pada bagian 12 mengenai tim, undangan, GoWhatsapp dan retry satu jam telah dibawa ke bagian utama PRD. Rincian model akses dan persetujuan masih terbuka; jangan menerapkan aturan akses pribadi pada seluruh konten tim tanpa keputusan tersebut.

## 2. Arsitektur yang diusulkan

- **Web UI:** login, undangan, akun Threads, komposer, persetujuan, kalender, riwayat dan administrasi.
- **Backend/API:** validasi, autentikasi, otorisasi, aturan bisnis, penyimpanan dan kontrak OpenAPI. API eksternal tidak boleh melewati persetujuan atau otorisasi yang berlaku pada UI.
- **Database:** data pengguna, tim, post, persetujuan, pekerjaan, notifikasi dan audit; transaksi melindungi perubahan status dan pengambilan pekerjaan.
- **Worker:** mengeksekusi jadwal, memproses hasil Meta, memantau token dan mengirim notifikasi melalui adaptor GoWhatsapp. Pekerjaan persisten agar dapat dipulihkan setelah restart.
- **Penyimpanan media:** penyimpanan persisten dengan kontrol akses dan mekanisme penyediaan media ke Meta sesuai dokumentasi yang berlaku.
- **Integrasi:** adaptor terpisah untuk Threads, Google, email transaksional dan GoWhatsapp; secret berada pada konfigurasi server yang aman.
- **Operasional:** reverse proxy HTTPS, backup database dan media, health check, log dan monitoring. Topologi dan stack final belum dipilih.

## 3. Identitas, undangan dan akses

- Administrator awal yang diinginkan: `wijaya.indra2196@gmail.com`. Operator server membuat akun melalui perintah terminal interaktif satu kali yang disetujui pemilik produk; perintah tidak tersedia melalui HTTP. Kendali terminal server tidak membuktikan kendali email, sehingga email tetap berstatus belum diverifikasi sampai pengguna mengonfirmasi tautan yang dikirim ke alamat tersebut. Pengguna tidak boleh menghubungkan Threads atau menerbitkan konten sampai diverifikasi. Pemulihan kata sandi memakai tautan email sekali pakai yang berlaku satu jam dan membatalkan sesi lama melalui versi sesi.
- Hanya penerima undangan yang dapat membuat akun lokal; undangan dikirim oleh admin dengan email terverifikasi, berlaku tujuh hari, sekali pakai, dan terikat ke email serta peran yang ditetapkan. Mengirim undangan baru ke alamat yang sama mencabut tautan sebelumnya; pencabutan manual belum tersedia. Penggunaan tautan membuktikan kendali alamat email. Perilaku jika email Google berbeda perlu ditetapkan.
- Akun lokal membutuhkan verifikasi email, reset aman dan sesi aman sesuai PRD. Google digunakan untuk masuk aplikasi; otorisasi Threads adalah alur terpisah. Jangan menggabungkan akun hanya berdasarkan kecocokan email; penautan memerlukan bukti kendali kedua identitas.
- Usulan peran: **Admin** mengelola anggota dan konfigurasi, **Editor** membuat dan mengajukan konten, **Reviewer** menyetujui atau menolak. Hanya admin menghubungkan akun. Pembuat draft, admin, dan reviewer boleh menjadwalkan dan menerbitkan; rincian pemisahan peran lainnya masih perlu disepakati. Periksa izin pada backend untuk UI dan API.
- Identitas integrasi mesin menggunakan kredensial terpisah dari sesi pengguna, dengan hak minimum, pencabutan, rotasi, dan audit. Mekanisme dan cakupan hak per integrasi belum ditentukan.

## 4. Alur konten dan persetujuan

Rancangan awal: draft → diajukan → disetujui/ditolak → dijadwalkan atau diterbitkan → diproses → terbit/gagal/perlu tindakan/hasil belum pasti. Admin dan reviewer boleh menyetujui konten sendiri. Pembuat draft, admin, atau reviewer boleh menjadwalkan dan menerbitkan. Detail peran lainnya dan jumlah persetujuan masih terbuka.

Persetujuan harus terikat pada versi konten dan akun tujuan. Perubahan yang memengaruhi konten atau tujuan membatalkan persetujuan dan memerlukan pengajuan ulang. Perubahan waktu saja tidak membatalkan persetujuan. Catat aktor, waktu, versi dan keputusan; worker hanya memproses versi yang memenuhi kebijakan persetujuan yang telah ditetapkan.

MVP minimal teks dan satu gambar atau video sebagaimana PRD; kebutuhan carousel atau rangkaian balasan masih terbuka. Validasi batas media dan teks terhadap versi API Meta yang digunakan; jangan mengasumsikan angka batas statis dari dokumen ini.

## 5. Penjadwalan dan publikasi

1. Simpan waktu jadwal sebagai UTC dan simpan zona waktu IANA yang dipilih; validasi waktu lokal yang ambigu atau tidak ada.
2. Gunakan transaksi dan lease untuk mengklaim pekerjaan sekali pada satu waktu. Perubahan atau pembatalan hanya dijamin sebelum pekerjaan diklaim; berikan konflik yang jelas setelahnya.
3. Periksa persetujuan, hak, koneksi, konten dan tenggat sebelum memulai. Catat setiap tahap dan percobaan tanpa token atau data sensitif pada log.
4. Coba ulang hanya kegagalan sementara yang diketahui aman dengan backoff terbatas. Jangan memulai percobaan otomatis setelah satu jam dari waktu jadwal. Pekerjaan yang sudah dikirim sebelum tenggat dapat diselesaikan atau direkonsiliasi; jika belum dikirim saat tenggat, tandai perlu tindakan.
5. Jika respons setelah permintaan publikasi hilang atau tidak pasti, jangan kirim ulang otomatis. Rekonsiliasi sejauh didukung API; jika tidak dapat dipastikan tampilkan **hasil belum pasti**, minta pemeriksaan manual, dan catat keputusan operator.
6. Penerbitan sekarang menggunakan proses dan perlindungan yang sama; titik awal tenggat retry untuk aksi ini perlu diputuskan. Idempotensi lokal mencegah klik ganda, tetapi tidak menjamin exactly-once di pihak Meta.
7. Ketepatan lima menit adalah target operasional; kegagalan atau keterlambatan tetap dicatat, bukan diam-diam diabaikan.

## 6. Notifikasi

Notifikasi dalam aplikasi tetap tersedia sesuai PRD. Selain itu, kegagalan publikasi, hasil belum pasti, dan koneksi Threads yang memerlukan otorisasi ulang diusulkan sebagai kejadian yang dikirim melalui GoWhatsapp. Penerima, format pesan, mekanisme autentikasi, endpoint dan kebijakan retry perlu dikonfirmasi terhadap instalasi GoWhatsapp yang sebenarnya. Kegagalan notifikasi tidak boleh mengubah hasil publikasi; catat status pengiriman dan hindari mengirim secret atau isi sensitif yang tidak diperlukan.

Referensi implementasi yang dipilih adalah [GoWhatsapp Web Multidevice](https://github.com/aldinokemal/go-whatsapp-web-multidevice). Dokumentasi OpenAPI upstream mencantumkan `POST /send/message` dan header `X-Device-Id`, dengan Basic Auth bila diaktifkan. Versi rilis dan konfigurasi deployment yang sebenarnya harus diperiksa sebelum integrasi diaktifkan; belum ada pengiriman atau kredensial yang dikonfigurasi.

## 7. API dan OpenAPI

OpenAPI adalah kontrak API HTTP untuk integrasi, tidak menentukan bahasa atau framework. `openapi.json` mendokumentasikan endpoint sesi browser dan health yang sudah tersedia. Autentikasi dan kontrak akses mesin masih belum ditetapkan dan belum diimplementasikan.

Kemampuan yang direncanakan: identitas dan akses, anggota/undangan, akun Threads, media, draft/post, alur persetujuan, jadwal, riwayat, notifikasi, dan status sistem. Tetapkan operasi yang boleh diakses integrasi mesin, paginasi, filter, format error, versi API, audit, rate limit dan idempotency key untuk operasi yang memicu efek samping. API harus menerapkan hak tim dan alur persetujuan yang sama dengan UI. Jangan mengekspos token Threads atau kredensial GoWhatsapp.

## 8. Data dan operasi

Entitas konseptual: User, AuthIdentity, Invitation, Team/Membership, ThreadsAccount, Post, PostVersion, Approval, Media, PublicationJob/Attempt, Notification/Delivery, IntegrationCredential dan AuditEvent. Kunci kepemilikan, keanggotaan dan relasinya menunggu keputusan model tim. Simpan token terenkripsi; pisahkan kunci enkripsi dari database dan rencanakan rotasi.

Fondasi saat ini mencakup migrasi dan penyimpanan internal untuk post, versi, serta keputusan review yang terikat versi. Operasi perubahan memakai transaksi, penguncian baris dan pemeriksaan revisi untuk mencegah perubahan yang tertimpa. API login lokal memakai sesi PostgreSQL, CSRF dan cookie HTTP-only; limit percobaan masih per proses dan perlu penyimpanan bersama sebelum produksi. API konten berbasis sesi memungkinkan anggota aktif melihat draft tim, membuat draft dan menjalankan alur persetujuan sesuai hak di atas. Draft teks dapat memilih akun Threads aktif; OAuth dan penyimpanan token terenkripsi sudah dibuat namun belum diuji dengan Meta sungguhan. Token verifikasi email disimpan sebagai hash, sekali pakai dan berlaku 24 jam. Tautan dikirim melalui SMTP yang dikonfigurasi dan harus dikonfirmasi saat masuk ke akun yang sama. Undangan menggunakan token satu kali dan membuat akun lokal dengan email terverifikasi. SMTP nyata belum diuji. Worker publikasi teks dan antrean persisten tersedia untuk pengujian dan dinonaktifkan secara default. Hasil pengiriman yang tidak pasti memerlukan konfirmasi manual yang diaudit; tidak ada pengiriman ulang otomatis. Meta, PostgreSQL server dan deployment nyata belum diuji.

Antarmuka utama telah terhubung ke API login dan draft. Untuk pengembangan pada satu komputer tersedia `npm run local`, menggunakan PostgreSQL berbasis WASM dengan penyimpanan lokal dan socket tanpa autentikasi yang hanya terikat ke loopback. Mode ini bukan pengganti PostgreSQL dan pengamanan deployment produksi.

Klien OAuth Threads membangun URL otorisasi, menukar kode dan memeriksa profil terhadap identitas token. Endpoint callback `/api/threads/oauth/callback` memakai state sekali pakai yang terikat sesi admin terverifikasi. Token dienkripsi menggunakan kunci terpisah yang harus disimpan persisten. Pengujian baru memakai respons simulasi; pengujian Meta nyata, verifikasi izin yang benar-benar diberikan, pembaruan otomatis token dan produksi masih diperlukan.

Tombol koneksi admin memeriksa ulang status pengguna dan konfigurasi saat diklik. Jika syarat belum terpenuhi, tampilkan alasan di panel; jika siap, minta URL OAuth melalui POST ber-CSRF dan pindah ke URL Threads HTTPS yang tervalidasi. Tautan lanjut tersedia setelah URL diterima sebagai alternatif bila navigasi otomatis tidak terjadi.

URL otorisasi dibuat langsung pada `https://www.threads.com/oauth/authorize`, tujuan redirect yang diamati pada 5 November 2026. Browser memeriksa `client_id`, `response_type`, state dan callback sebelum navigasi. Domain Threads lama masih diterima untuk kompatibilitas saat frontend dan backend diperbarui bertahap. Perubahan domain ini mengurangi redirect dan belum membuktikan penyebab error Meta tertentu.

Kegagalan sebelum pengiriman publikasi dicatat sebagai kode diagnosis terbatas yang aman ditampilkan, tanpa menyimpan pesan mentah Meta. Kegagalan setelah pengiriman tetap dianggap belum pasti dan tidak diulang otomatis. Permintaan pembuatan kontainer dan publikasi memakai parameter sebagaimana contoh koleksi resmi Meta.

Retensi minimal 90 hari perlu diterjemahkan per jenis data, termasuk log, media, post, audit dan backup, dengan kebijakan penghapusan dan kapasitas 20 GB. Backup dan restore harus diuji; RPO/RTO belum ditetapkan. Monitoring minimal mencakup worker, antrean, keterlambatan, status integrasi, kegagalan notifikasi dan kapasitas. Sediakan prosedur pemulihan serta konfigurasi self-hosting yang dapat direproduksi.

## 9. Validasi sebelum implementasi dan rilis

- Buktikan otorisasi dan penerbitan Threads, termasuk media, izin, status token dan batas API yang berlaku.
- Buktikan login Google, verifikasi email, undangan dan bootstrap admin pada lingkungan uji.
- Uji GoWhatsapp yang dipakai: autentikasi, pengiriman, error dan perilaku timeout.
- Uji persetujuan dan invalidasi versi, kontrol akses lintas anggota/tim dan API mesin.
- Uji restart worker, klaim bersamaan, pembatalan, batas satu jam, timeout tidak pasti, zona waktu, serta pemulihan data.
- Validasi kontrak OpenAPI terhadap implementasi; uji backup/restore, keamanan, pemantauan dan kapasitas sebelum produksi.

## 10. Keputusan terbuka

1. Rincian matriks peran dan kebijakan persetujuan yang belum diputuskan.
2. Format konten MVP selain teks dan satu media; total atau per pengguna untuk target 30 post/hari; jumlah pengguna.
3. Stack, host, sistem operasi, cara deployment, database, penyimpanan dan email transaksional.
4. Versi dan konfigurasi instalasi [GoWhatsapp Web Multidevice](https://github.com/aldinokemal/go-whatsapp-web-multidevice) yang digunakan, penerima serta aturan notifikasi.
5. Hak dan autentikasi API mesin, kontrak endpoint dan kebutuhan integrasi pertama.
6. Definisi retensi 90 hari per jenis data, penghapusan, backup, serta RPO/RTO.
7. Pencabutan manual undangan dan prosedur pemulihan akses admin jika email atau SMTP tidak tersedia.
8. Aturan deadline retry untuk publikasi langsung, serta definisi operasional toleransi lima menit.
