# Spesifikasi Teknis — Threads Post Automation

**Status:** Draf awal, 4 November 2026. Dokumen ini menerjemahkan [PRD](PRD.md) menjadi rancangan untuk ditinjau; keputusan yang ditandai terbuka belum menjadi ketentuan final.

## 1. Konteks dan keputusan produk

Aplikasi digunakan secara internal, self-hosted, dengan pengguna berbasis undangan. Mendukung login lokal dan Google, pengelolaan tim dan persetujuan konten pada MVP, serta API yang terdokumentasi dengan OpenAPI untuk integrasi sistem lain. Satu tim digunakan bersama; semua anggota dapat melihat draft, hanya pembuat yang boleh mengubah dan mengajukan draft, sedangkan admin dan reviewer dapat menyetujui termasuk konten sendiri. Hanya admin menghubungkan akun Threads; semua anggota dapat memilih akun terhubung sebagai tujuan draft. Stack yang dipilih adalah TypeScript pada Node.js, PostgreSQL, dan Docker Compose. Media disimpan pada volume Docker persisten di server yang sama; Meta mengambilnya menggunakan URL HTTPS sementara. Email transaksional menggunakan SMTP generik yang akan dikonfigurasi kemudian. Perencanaan kapasitas awal: empat akun Threads per pengguna, 30 post per hari (cakupan total atau per pengguna belum ditentukan), dan 20 GB penyimpanan. Retensi data setidaknya 90 hari; cakupan dan pengecualian harus ditetapkan. Target ketepatan publikasi lima menit, dan percobaan otomatis berhenti setelah satu jam dari jadwal.

**Penyelarasan PRD:** keputusan pada bagian 12 mengenai tim, undangan, GoWhatsapp dan retry satu jam telah dibawa ke bagian utama PRD. Rincian model akses dan persetujuan masih terbuka; jangan menerapkan aturan akses pribadi pada seluruh konten tim tanpa keputusan tersebut.

## 2. Arsitektur yang diusulkan

- **Web UI:** login, undangan, akun Threads, komposer, persetujuan, kalender, riwayat dan administrasi.
- **Backend/API:** validasi, autentikasi, otorisasi, aturan bisnis, penyimpanan dan kontrak OpenAPI. API eksternal tidak boleh melewati persetujuan atau otorisasi yang berlaku pada UI.
- **Database:** data pengguna, tim, post, persetujuan, pekerjaan, notifikasi dan audit; transaksi melindungi perubahan status dan pengambilan pekerjaan.
- **Worker:** mengeksekusi jadwal, memproses hasil Meta, memantau token dan mengirim notifikasi melalui adaptor GoWhatsapp. Pekerjaan persisten agar dapat dipulihkan setelah restart.
- **Penyimpanan media:** named volume Docker terpisah, metadata PostgreSQL, pratinjau berbasis sesi, dan URL HTTPS bertanda tangan sementara untuk Meta.
- **Integrasi:** adaptor terpisah untuk Threads, Google, email transaksional dan GoWhatsapp; secret berada pada konfigurasi server yang aman.
- **Operasional:** reverse proxy HTTPS, backup database dan media, health check, log dan monitoring. Konfigurasi proxy, backup dan pemantauan pada server tujuan belum divalidasi.

## 3. Identitas, undangan dan akses

- Administrator awal yang diinginkan: `wijaya.indra2196@gmail.com`. Operator server membuat akun melalui perintah terminal interaktif satu kali yang disetujui pemilik produk; perintah tidak tersedia melalui HTTP. Kendali terminal server tidak membuktikan kendali email, sehingga email tetap berstatus belum diverifikasi sampai pengguna mengonfirmasi tautan yang dikirim ke alamat tersebut. Pengguna tidak boleh menghubungkan Threads atau menerbitkan konten sampai diverifikasi. Pemulihan kata sandi memakai tautan email sekali pakai yang berlaku satu jam dan membatalkan sesi lama melalui versi sesi.
- Hanya penerima undangan yang dapat membuat akun lokal; undangan dikirim oleh admin dengan email terverifikasi, berlaku tujuh hari, sekali pakai, dan terikat ke email serta peran yang ditetapkan. Mengirim undangan baru ke alamat yang sama mencabut tautan sebelumnya; admin terverifikasi juga dapat mencabut undangan yang belum diterima dan belum kedaluwarsa. Penggunaan tautan membuktikan kendali alamat email. Perilaku jika email Google berbeda perlu ditetapkan.
- Akun lokal membutuhkan verifikasi email, reset aman dan sesi aman sesuai PRD. Google digunakan untuk masuk aplikasi; otorisasi Threads adalah alur terpisah. Jangan menggabungkan akun hanya berdasarkan kecocokan email; penautan memerlukan bukti kendali kedua identitas.
- Peran yang diterapkan: **Admin** mengelola anggota dan koneksi, **Editor** membuat dan mengajukan konten sendiri, **Reviewer** menyetujui atau menolak. Hanya admin menghubungkan akun. Pembuat draft, admin, dan reviewer boleh menjadwalkan dan menerbitkan; rincian hak konfigurasi/integrasi lainnya masih perlu disepakati. Periksa izin pada backend untuk UI dan API.
- Identitas integrasi mesin menggunakan kredensial terpisah dari sesi pengguna, dengan hak minimum, pencabutan, rotasi, dan audit. Mekanisme dan cakupan hak per integrasi belum ditentukan.

## 4. Alur konten dan persetujuan

Rancangan awal: draft → diajukan → disetujui/ditolak → dijadwalkan atau diterbitkan → diproses → terbit/gagal/perlu tindakan/hasil belum pasti. Admin dan reviewer boleh menyetujui konten sendiri. Pembuat draft, admin, atau reviewer boleh menjadwalkan dan menerbitkan. Detail peran lainnya dan jumlah persetujuan masih terbuka.

Persetujuan harus terikat pada versi konten dan akun tujuan. Perubahan yang memengaruhi konten atau tujuan membatalkan persetujuan dan memerlukan pengajuan ulang. Perubahan waktu saja tidak membatalkan persetujuan. Catat aktor, waktu, versi dan keputusan; worker hanya memproses versi yang memenuhi kebijakan persetujuan yang telah ditetapkan.

MVP mendukung teks, satu video, atau hingga sepuluh gambar; dua atau lebih gambar membentuk carousel. Draft juga dapat berisi sampai sepuluh bagian berurutan yang diterbitkan sebagai balasan; lampiran berada pada bagian pertama. Pemecahan otomatis dan penyuntingan manual tersedia di komposer. Seluruh teks, urutan, lampiran dan akun tujuan terikat pada versi yang disetujui. Berkas divalidasi memakai batas aplikasi yang dijelaskan di README, dan Meta tetap memvalidasi pembatasan lainnya.

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

Fondasi saat ini mencakup migrasi dan penyimpanan internal untuk post, versi, media serta keputusan review yang terikat versi. Operasi perubahan memakai transaksi, penguncian baris dan pemeriksaan revisi untuk mencegah perubahan yang tertimpa. API login lokal memakai sesi PostgreSQL, CSRF dan cookie HTTP-only; limit percobaan masih per proses dan perlu penyimpanan bersama sebelum produksi. API konten berbasis sesi memungkinkan anggota aktif melihat draft tim, membuat draft dan menjalankan alur persetujuan sesuai hak di atas. Pengguna melaporkan OAuth dan penerbitan satu gambar berhasil dengan akun Threads Tester; carousel dan rangkaian baru diuji dengan respons simulasi. Token verifikasi email disimpan sebagai hash, sekali pakai dan berlaku 24 jam. Undangan menggunakan token satu kali dan membuat akun lokal dengan email terverifikasi. Worker publikasi dan antrean persisten dinonaktifkan secara default. Hasil pengiriman yang tidak pasti memerlukan konfirmasi manual yang diaudit; tidak ada pengiriman ulang otomatis. Pengujian carousel/rangkaian Meta, PostgreSQL server dan deployment masih diperlukan.

Antarmuka utama telah terhubung ke API login dan draft. Untuk pengembangan pada satu komputer tersedia `npm run local`, menggunakan PostgreSQL berbasis WASM dengan penyimpanan lokal dan socket tanpa autentikasi yang hanya terikat ke loopback. Mode ini bukan pengganti PostgreSQL dan pengamanan deployment produksi.

Klien OAuth Threads membangun URL otorisasi, menukar kode dan memeriksa profil terhadap identitas token. Endpoint callback `/api/threads/oauth/callback` memakai state sekali pakai yang terikat sesi admin terverifikasi. Token dienkripsi menggunakan kunci terpisah yang harus disimpan persisten. Worker refresh memeriksa token yang masih berlaku dalam 14 hari sebelum kedaluwarsa, membatasi percobaan dan memakai lease serta pemeriksaan token lama agar tidak menimpa koneksi ulang. Pengguna melaporkan koneksi berhasil melalui akun tester; verifikasi izin, refresh dengan Meta nyata dan pengujian produksi masih diperlukan.

Permintaan OAuth mencakup `threads_basic`, `threads_content_publish`, `threads_manage_replies`, dan `threads_read_replies` untuk publikasi rangkaian dan verifikasi balasan. Akun yang dihubungkan sebelum perubahan scope perlu otorisasi ulang; izin aktual dan dukungan Meta tetap perlu diverifikasi. Penolakan pembuatan kontainer dicatat hanya sebagai event, ID pekerjaan, nomor bagian, status HTTP dan kode/subkode numerik Meta, tanpa respons mentah, teks posting, URL, atau token.

Operator server dapat menjalankan pemeriksaan izin token melalui endpoint debug Meta. Hasil dibatasi pada validitas, kecocokan App ID, status pemeriksaan, dan empat nama scope yang digunakan; token dan respons mentah tidak dicetak. Pemeriksaan izin ini bersifat diagnostik dan tidak membuktikan semua ketentuan akses Meta terpenuhi.

Setelah bagian rangkaian berhasil diterbitkan, antrean memberi jeda aplikasi 30 detik sebelum bagian berikutnya. Worker memeriksa bahwa ID posting sebelumnya dapat dibaca sebelum membuat kontainer balasan. Penolakan HTTP 400 dengan kode 24/subkode 4279009 pada pembacaan target atau pembuatan kontainer balasan dicoba ulang menggunakan backoff dan tenggat satu jam yang sama. Klasifikasi ini tidak membuktikan bahwa target hanya tertunda; target yang dihapus atau tetap tidak dapat diakses akan berakhir perlu tindakan. Kebijakan ini hanya berlaku sebelum permintaan publikasi dikirim; hasil publikasi yang belum pasti tetap tidak diulang otomatis.

Pemeriksaan server dapat ditujukan ke ID pekerjaan untuk membandingkan target balasan dengan ID bagian sebelumnya yang disimpan, memeriksa identitas token melalui Meta, dan membaca target tanpa menampilkan ID provider, isi konten, atau kredensial. Status diagnostik tidak mengubah pekerjaan dan tidak menerbitkan konten.

Jika diberi tautan publik target, pemeriksaan membandingkan permalink dengan daftar posting akun (maksimal lima halaman), kemudian membaca ID yang ditemukan. Perbandingan hanya diagnostik; hasil tidak ditemukan tidak dianggap bukti penghapusan dan ID tersimpan tidak diganti otomatis.

Operator dapat mencari kandidat posting pertama pada rentang waktu pekerjaan yang tercatat, dengan toleransi lima menit. Pencarian hanya membaca data, memverifikasi identitas token, mengirim parameter waktu ke Meta dan menyaring kembali hasilnya. Output dibatasi pada tautan, waktu dan penanda kecocokan isi/media/ID, tanpa isi atau token. Pagination dibatasi lima halaman dan 20 kandidat; pencarian parsial ditandai dan hasil kosong tidak dianggap bukti penghapusan. Kandidat tidak dipilih atau diterapkan otomatis.

Pemulihan melalui terminal server tersedia untuk rangkaian berstatus perlu tindakan yang belum menerbitkan bagian kedua. Operator memberikan ID pekerjaan dan tautan publik bagian pertama. Perintah memverifikasi identitas token, permalink pada daftar milik akun, isi versi yang disetujui, jenis media, dan waktu posting dalam rentang persiapan pertama hingga keberhasilan publikasi pertama, dengan toleransi lima menit pada kedua ujungnya. Ketidakcocokan menyertakan waktu UTC dan selisih untuk diagnosis. Target lama harus tidak dapat dibaca. Tanpa `--apply` hanya dilakukan verifikasi; dengan `--apply`, perubahan ID bagian pertama dan target balasan dilakukan atomik setelah revisi, persetujuan, koneksi, token, pekerjaan, lease dan hasil bagian selanjutnya diperiksa ulang. Perubahan dicatat sebagai tindakan `server_cli`, bukan sebagai pengguna aplikasi tertentu. Pekerjaan tetap perlu tindakan sampai anggota yang berwenang memilih lanjutkan. Hasil belum pasti dan pekerjaan yang sudah berjalan tidak dapat diperbaiki dengan perintah ini.

Setiap publikasi baru menyimpan ID kontainer dan ID yang diterima dari respons Meta secara terpisah dari ID referensi yang dapat dikoreksi, dalam bentuk teks. Data historis yang tidak memiliki catatan sumber tidak diisi dengan asumsi. Laporan pengguna membuktikan satu target tersimpan berbeda dari ID posting berdasarkan permalink yang dapat dibaca; asal perbedaan historis belum dipastikan.

Pembacaan respons mempertahankan ID numerik besar sebagai teks dari sumber JSON asli pada Node.js 24. Kegagalan callback dikembalikan sebagai tahap terbatas (sesi, penolakan, pertukaran kode, token jangka panjang, profil, atau penyimpanan), dengan kode Meta numerik jika tersedia. Log hanya mencatat event, tahap, status HTTP, kode/subkode Meta dan kategori terbatas, tanpa pesan mentah, URL permintaan, kode otorisasi atau token. State tetap sekali pakai meskipun pertukaran gagal; pengguna harus memulai koneksi baru.

Pertukaran token jangka panjang mengikuti contoh resmi Meta: server mengirim GET `/access_token` dengan `grant_type=th_exchange_token`, `client_secret`, dan token sementara pada parameter `access_token`. URL berkredensial ini hanya dibuat di server dan tidak ditampilkan atau dicatat dalam log, termasuk saat transport gagal.

Diagnosis Meta menyertakan subkode numerik dan kategori tetap jika pesan penolakan dikenali: akses tester/App Review, izin, kredensial aplikasi, token, atau permintaan tidak didukung. Pesan asli hanya diperiksa di memori untuk memilih kategori; tidak diteruskan ke UI, fragment atau log. Kode 100 saja tidak dianggap bukti salah konfigurasi. Status tester dan penerimaan undangan perlu dikonfirmasi pada akun uji yang benar.

Tombol koneksi admin memeriksa ulang status pengguna dan konfigurasi saat diklik. Jika syarat belum terpenuhi, tampilkan alasan di panel; jika siap, minta URL OAuth melalui POST ber-CSRF dan pindah ke URL Threads HTTPS yang tervalidasi. Tautan lanjut tersedia setelah URL diterima sebagai alternatif bila navigasi otomatis tidak terjadi.

URL otorisasi dibuat langsung pada `https://www.threads.com/oauth/authorize`, tujuan redirect yang diamati pada 5 November 2026. Browser memeriksa `client_id`, `response_type`, state dan callback sebelum navigasi. Domain Threads lama masih diterima untuk kompatibilitas saat frontend dan backend diperbarui bertahap. Perubahan domain ini mengurangi redirect dan belum membuktikan penyebab error Meta tertentu.

Kegagalan sebelum pengiriman publikasi dicatat sebagai kode diagnosis terbatas yang aman ditampilkan, tanpa menyimpan pesan mentah Meta. Kegagalan setelah pengiriman tetap dianggap belum pasti dan tidak diulang otomatis. Permintaan pembuatan kontainer dan publikasi memakai parameter sebagaimana contoh koleksi resmi Meta.

Worker mengirim URL HTTPS bertanda tangan untuk setiap lampiran, terikat pekerjaan dan versi serta berlaku dua jam. Pengambilan publik hanya diizinkan untuk pekerjaan yang sesuai; siapa pun yang memiliki URL dapat mengakses berkas selama masa berlaku, sehingga URL tidak boleh masuk log proxy/CDN. Worker memeriksa status semua kontainer, termasuk teks dan setiap anak carousel, sebelum publikasi. Kontainer teks disimpan pada antrean berstatus `prepared` dengan jeda aplikasi 30 detik setelah pembuatan; restart worker menggunakan kontainer yang sama. Hanya `FINISHED` boleh dikirim untuk publikasi; `IN_PROGRESS` menunggu pemeriksaan berikutnya, sedangkan `PUBLISHED` menghentikan pengiriman dan memerlukan rekonsiliasi. Jeda ini merupakan kebijakan aplikasi, bukan jaminan kesiapan Meta. Setiap bagian rangkaian dan ID hasilnya dicatat; hasil tidak pasti menghentikan rangkaian. Saat operator menyatakan bagian belum selesai sebagai terbit, ID numerik diverifikasi terhadap akun dan konten melalui Meta sebelum kelanjutan. Kelanjutan memerlukan tindakan eksplisit dan membuka tenggat satu jam baru. Metadata media dibatasi total 20 GB; kapasitas disk, berkas sementara/yatim, dan backup harus tetap dipantau. Pengguna mengonfirmasi satu gambar berhasil; pengujian carousel dan rangkaian end-to-end masih diperlukan.

Kegagalan saat publikasi menghasilkan event `threads_publish_uncertain`, dengan pekerjaan, nomor bagian, kategori kegagalan, HTTP dan kode/subkode Meta numerik. Metadata aman juga disimpan pada percobaan publikasi; pesan mentah, isi konten, URL dan token tidak disimpan. Pemeriksaan pekerjaan yang belum pasti menampilkan metadata ini dan membaca status kontainer secara read-only. Respons publikasi yang ditolak, hilang atau tidak valid tetap tidak memicu pengiriman ulang otomatis. Catatan lama tidak dapat dilengkapi dengan kode kegagalan yang tidak pernah disimpan.

Retensi minimal 90 hari perlu diterjemahkan per jenis data, termasuk log, media, post, audit dan backup, dengan kebijakan penghapusan dan kapasitas 20 GB. Backup dan restore harus diuji; RPO/RTO belum ditetapkan. Monitoring minimal mencakup worker, antrean, keterlambatan, status integrasi, kegagalan notifikasi dan kapasitas. Sediakan prosedur pemulihan serta konfigurasi self-hosting yang dapat direproduksi.

### Pengelolaan ruang kerja

Permintaan pengguna pada 6 November 2026 mencakup pengelolaan anggota, kalender/filter, pengelolaan akun Threads, penghapusan draft, serta riwayat/audit. Seluruh fitur memakai sesi yang diperiksa ulang di server dan CSRF untuk mutasi.

Admin dengan email terverifikasi dapat membaca daftar anggota/undangan, mengubah peran, menonaktifkan/mengaktifkan anggota, dan mencabut undangan. Mutasi anggota memeriksa peran/status sebelumnya agar tidak menimpa perubahan operator lain, mengunci baris pengguna dalam urutan tetap, mempertahankan setidaknya satu admin aktif terverifikasi, melarang penonaktifan diri sendiri dan menaikkan versi sesi. Penonaktifan menghentikan pekerjaan belum diklaim; pekerjaan yang telah dikirim tidak dinyatakan gagal secara sepihak.

Daftar konten memfilter status konten atau pekerjaan terakhir, akun termasuk koneksi historis, dan rentang tanggal pembuatan/jadwal sebelum paginasi. Tanggal diterjemahkan ke batas UTC memakai zona IANA: awal hari pertama inklusif hingga awal hari setelah tanggal akhir eksklusif. Kalender menampilkan bulan berdasarkan jadwal dan zona pilihan, termasuk paginasi, serta tautan ke riwayat. Draft tanpa jadwal tidak dipaksakan menjadi peristiwa kalender.

Hanya admin terverifikasi dapat melihat metadata pengelolaan akun, memeriksa izin token akun terpilih, atau memutuskan koneksi. Pemeriksaan memakai adaptor debug token yang sama dengan CLI, hanya mengembalikan validitas, App ID cocok/tidak diketahui, dan nama scope yang dikenal. Pemutusan bersifat lokal: token dihapus, lease refresh dicabut dan pekerjaan belum diklaim menjadi perlu tindakan. Izin di Meta tidak dicabut oleh endpoint ini; permintaan yang sudah terkirim dapat tetap selesai. Hubungkan ulang memakai OAuth yang sama dan tidak otomatis menjalankan kembali pekerjaan yang dihentikan.

Penghapusan hanya oleh pembuat untuk status draft/ditolak, menggunakan revisi dan penguncian post yang sama dengan perubahan/persetujuan. Publikasi aktif, belum pasti atau bagian terbit memblokir tindakan. `deleted_at/deleted_by` menyembunyikan post dan mencegah edit, transisi, serta publikasi melalui API; data versi/media dipertahankan untuk retensi. Tidak ada penghapusan di Meta atau pembersihan media otomatis.

Riwayat konten dapat dibaca seluruh anggota aktif; setiap bagian (versi/media, review, pekerjaan/bagian, percobaan/kode kegagalan, audit, resolusi, kelanjutan dan pemulihan) memiliki halaman maksimal 50 item dengan offset tersendiri yang dikembalikan API. Audit global hanya untuk admin terverifikasi, tanpa token, hash kata sandi, isi posting, atau respons mentah Meta. Mutasi konten, jadwal, konfirmasi/kelanjutan, koneksi dan anggota dicatat atomik bersama perubahan; pemeriksaan izin mencatat tindakan setelah respons diagnostik diperoleh. Aktivitas sebelum migrasi 018 tidak direkonstruksi; riwayat yang sudah tersimpan tetap dapat dibaca. Retensi/pembersihan otomatis tetap merupakan pekerjaan terpisah.

## 9. Validasi sebelum implementasi dan rilis

- Buktikan otorisasi dan penerbitan Threads, termasuk media, izin, status token dan batas API yang berlaku.
- Buktikan login Google, verifikasi email, undangan dan bootstrap admin pada lingkungan uji.
- Uji GoWhatsapp yang dipakai: autentikasi, pengiriman, error dan perilaku timeout.
- Uji persetujuan dan invalidasi versi, kontrol akses lintas anggota/tim dan API mesin.
- Uji restart worker, klaim bersamaan, pembatalan, batas satu jam, timeout tidak pasti, zona waktu, serta pemulihan data.
- Validasi kontrak OpenAPI terhadap implementasi; uji backup/restore, keamanan, pemantauan dan kapasitas sebelum produksi.

## 10. Keputusan terbuka

1. Rincian matriks peran dan kebijakan persetujuan yang belum diputuskan.
2. Total atau per pengguna untuk target 30 post/hari; jumlah pengguna dan format konten tambahan selain carousel gambar dan rangkaian balasan.
3. Host, sistem operasi, detail deployment dan email transaksional; volume Docker dipilih untuk media.
4. Versi dan konfigurasi instalasi [GoWhatsapp Web Multidevice](https://github.com/aldinokemal/go-whatsapp-web-multidevice) yang digunakan, penerima serta aturan notifikasi.
5. Hak dan autentikasi API mesin, kontrak endpoint dan kebutuhan integrasi pertama.
6. Definisi retensi 90 hari per jenis data, penghapusan, backup, serta RPO/RTO.
7. Prosedur pemulihan akses admin jika email atau SMTP tidak tersedia; pencabutan manual undangan sudah tersedia bagi admin terverifikasi.
8. Aturan deadline retry untuk publikasi langsung, serta definisi operasional toleransi lima menit.
