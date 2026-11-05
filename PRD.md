# Product Requirements Document (PRD)
# Threads Post Automation

**Status:** Draf untuk diskusi  
**Versi:** 0.1  
**Tanggal:** 4 November 2026  
**Pemilik produk:** Belum ditentukan

## 1. Ringkasan

Threads Post Automation adalah aplikasi web untuk membuat, menjadwalkan, menerbitkan, dan memantau status posting Threads. Pengguna masuk menggunakan akun lokal atau Google, lalu menghubungkan akun Threads melalui proses otorisasi resmi Meta. Aplikasi menyimpan jadwal dan menjalankan penerbitan otomatis pada waktu yang ditentukan.

Dokumen ini adalah usulan awal, bukan keputusan final tentang model bisnis, teknologi, atau kapasitas. Asumsi ditandai dan perlu divalidasi bersama pemilik produk.

## 2. Masalah dan tujuan

Pembuatan dan penerbitan konten secara manual menyulitkan pengguna menjaga konsistensi jadwal, melihat antrean konten, dan mengetahui posting yang gagal. Produk harus memungkinkan pengguna:

1. Mengelola konten dan jadwal dari satu dashboard.
2. Menerbitkan posting secara otomatis tanpa harus membuka Threads pada waktu publikasi.
3. Mengetahui hasil penerbitan dan melakukan tindak lanjut saat terjadi kegagalan.
4. Masuk dengan aman menggunakan autentikasi lokal atau Google.

### Indikator keberhasilan awal

Target berikut adalah hipotesis untuk pilot, bukan SLA produksi yang telah disepakati. Ukur selama 30 hari setelah pilot memiliki data yang cukup.

| Indikator | Target awal | Definisi |
|---|---:|---|
| Keberhasilan publikasi | ≥ 95% | Post terjadwal yang berhasil diterbitkan dibagi post yang mencapai waktu publikasi, termasuk kegagalan eksternal; tidak termasuk pembatalan sebelum jatuh tempo. |
| Ketepatan jadwal | ≥ 95% | Post yang berhasil terbit dalam 5 menit setelah jadwal dibagi seluruh post yang berhasil terbit; ukur terpisah kegagalan dan gangguan Meta. |
| Penyelesaian alur awal | ≥ 80% | Pengguna pilot yang menghubungkan Threads dan membuat satu draft dalam tujuh hari setelah registrasi, dibagi pengguna pilot yang registrasi. |
| Visibilitas kegagalan | 100% | Semua kegagalan publikasi tercatat dan terlihat pada dashboard beserta tindakan berikutnya. |

## 3. Pengguna dan asumsi produk

- **Pengguna utama:** kreator, pemilik usaha, atau pengelola media sosial yang mengelola konten Threads.
- **Administrator aplikasi:** mengelola pengguna, konfigurasi operasional, dan memantau kesehatan sistem.
- **MVP:** aplikasi digunakan secara internal oleh satu tim bersama. Semua anggota dapat melihat seluruh draft; hanya pembuat yang dapat mengubah dan mengajukan draft. Hanya admin dan reviewer dapat menyetujui, termasuk konten mereka sendiri. Hanya admin menghubungkan akun Threads; semua anggota dapat memilih akun terhubung untuk draft.
- **Akses:** pendaftaran berbasis undangan, dengan autentikasi lokal atau Google. Administrator awal yang direncanakan adalah `wijaya.indra2196@gmail.com`, melalui proses bootstrap yang membuktikan kendali identitas.
- Aplikasi tidak meminta atau menyimpan kata sandi Threads. Login ke aplikasi dan pemberian akses ke akun Threads adalah dua proses berbeda.

## 4. Cakupan dan prioritas

### MVP (P0)

- Undangan, registrasi, login, logout, verifikasi email, dan reset kata sandi akun lokal.
- Login/registrasi dengan Google.
- Hubungkan, lihat status, otorisasi ulang, dan putuskan akun Threads.
- Draft posting teks; lampiran satu gambar atau satu video sebagai opsi, sesuai kemampuan dan batas API yang berlaku.
- Pratinjau, simpan, edit, hapus draft; publikasikan sekarang atau jadwalkan ke satu akun Threads per posting.
- Daftar posting dan kalender sederhana, dengan filter akun, status, dan tanggal.
- Worker penjadwalan, riwayat percobaan, status hasil, dan penanganan kegagalan.
- Dashboard ringkas, notifikasi kegagalan di aplikasi, dan audit aktivitas penting.
- Pengelolaan anggota tim, kontrol akses, persetujuan konten, dan konfigurasi administrator dasar.
- Notifikasi melalui GoWhatsapp API untuk kejadian yang kriterianya akan ditetapkan.

### Setelah MVP (P1/P2)

- Multi-akun dalam satu aksi, unggah massal CSV, posting berulang, dan antrean berbasis slot.
- Carousel, rangkaian posting/balasan, dan format tambahan setelah kompatibilitas API divalidasi.
- Insight performa, analitik, dan laporan; pengelolaan balasan dan mentions.
- Notifikasi melalui kanal tambahan, generasi konten berbasis AI, aplikasi mobile, dan kanal sosial lain.

Fitur pasca-MVP tidak termasuk dalam kriteria penerimaan MVP. Penghapusan atau pengeditan posting yang sudah terbit di Threads tidak termasuk MVP; hapus draft hanya menghapus data aplikasi.

## 5. Perjalanan pengguna

1. Pengguna yang diundang mendaftar dengan email dan kata sandi, memverifikasi email, atau masuk dengan Google sesuai kebijakan undangan.
2. Pengguna membuka **Akun Threads**, lalu menyetujui akses melalui alur resmi Meta.
3. Pengguna membuat posting, memilih satu akun, memasukkan teks dan/atau media yang didukung, lalu melihat pratinjau.
4. Pengguna menyimpan draft dan mengajukannya untuk persetujuan. Setelah disetujui sesuai kebijakan tim, posting dapat diterbitkan atau dijadwalkan.
5. Pada waktu yang ditentukan, sistem memproses posting dan memperbarui status. Pengguna dapat membuka hasil atau melihat penyebab kegagalan dan tindakan yang tersedia.

## 6. Kebutuhan fungsional

### 6.1 Autentikasi dan akun pengguna

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| AUTH-01 | Registrasi lokal berbasis undangan dengan email dan kata sandi. | Email unik dinormalisasi; undangan dan email diverifikasi sebelum akses diberikan sesuai kebijakan tim. Pesan kesalahan tidak membocorkan apakah email sudah terdaftar. |
| AUTH-02 | Login/logout lokal. | Kredensial valid menghasilkan sesi aman; logout membatalkan sesi aktif. Percobaan berulang dibatasi. |
| AUTH-03 | Reset kata sandi. | Tautan sekali pakai memiliki masa berlaku terbatas; setelah reset, sesi lain dicabut. Respons permintaan reset tidak mengungkap keberadaan akun. |
| AUTH-04 | Masuk menggunakan Google. | Identitas Google divalidasi di backend; pengguna baru hanya dapat bergabung melalui undangan yang sah. Login Google tidak otomatis menghubungkan Threads. |
| AUTH-05 | Penautan identitas. | Identitas Google diidentifikasi menggunakan `sub` yang stabil. Email yang sama tidak otomatis menggabungkan akun lokal dan Google; penautan hanya dilakukan setelah pengguna membuktikan kendali kedua identitas melalui alur aman. Jika belum tersedia, tampilkan instruksi penyelesaian tanpa membuat duplikasi yang tidak aman. |
| AUTH-06 | Kelola sesi. | Sesi kedaluwarsa dan dicabut saat logout atau perubahan kredensial; cookie menggunakan atribut aman yang sesuai. |

Pengiriman email transaksional untuk verifikasi dan reset adalah dependensi MVP. Kebijakan durasi sesi, kata sandi, dan masa berlaku tautan ditetapkan saat desain teknis.

### 6.2 Koneksi Threads

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| TH-01 | Hubungkan akun melalui otorisasi resmi Threads. | Setelah persetujuan, akun yang terhubung tampil dengan identitas dan status koneksi. Sistem hanya meminta izin minimum untuk fungsi MVP. |
| TH-02 | Kelola koneksi. | Pengguna melihat status aktif, perlu otorisasi ulang, atau terputus; dapat melakukan otorisasi ulang dan memutuskan koneksi. |
| TH-03 | Kelola token. | Token disimpan terenkripsi di server, tidak ditampilkan kepada pengguna atau masuk log; refresh dilakukan sesuai aturan Meta. Jika tidak dapat diperbarui, pengguna diminta menghubungkan ulang. |
| TH-04 | Dampak pemutusan. | Post terjadwal yang belum diproses dibatalkan dari antrean dan menjadi **Perlu tindakan**, dengan konten tetap tersimpan. Pengguna dapat menghubungkan ulang dan menjadwalkannya kembali. Jika proses sudah dimulai, tampilkan bahwa hasilnya mungkin masih diproses dan lakukan rekonsiliasi. |
| TH-05 | Kontrol akses akun. | Pengguna hanya dapat melihat atau menggunakan akun Threads sesuai hak tim yang ditetapkan, termasuk saat mengakses API secara langsung. |

### 6.3 Komposer dan konten

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| POST-01 | Buat dan edit draft. | Pengguna dapat menyimpan konten belum lengkap, memilih akun, dan mengubah draft sebelum publikasi. |
| POST-02 | Validasi konten. | Sebelum publikasi atau penjadwalan, sistem memvalidasi isi, kombinasi konten, batas teks, format, ukuran, dan durasi media sesuai aturan API yang berlaku; kesalahan ditampilkan secara jelas. Batas spesifik tidak di-hardcode dalam PRD. |
| POST-03 | Media dan pratinjau. | Pengguna dapat mengunggah satu video atau satu hingga sepuluh gambar, mengatur urutannya dan melihat pratinjau. Dua atau lebih gambar diterbitkan sebagai carousel. Pratinjau adalah perkiraan, bukan jaminan tampilan akhir Threads. |
| POST-08 | Rangkaian posting. | Pengguna dapat membagi teks panjang menjadi beberapa bagian dan mengubah setiap bagian pada draft. Bagian diterbitkan berurutan sebagai balasan; media melekat pada bagian pertama. Seluruh bagian harus disetujui sebagai satu versi. |
| POST-04 | Publikasikan sekarang. | Setelah persetujuan sesuai kebijakan tim, permintaan masuk antrean dan menampilkan status pemrosesan; hasil sukses atau gagal tercatat. Klik berulang tidak membuat permintaan publikasi baru untuk posting yang sama. |
| POST-05 | Jadwalkan posting. | Post hanya diproses setelah disetujui sesuai kebijakan tim. Tanggal dan waktu masa depan serta zona waktu tersimpan; dashboard menampilkan waktu lokal pilihan dan informasi zona waktu. Jadwal dapat diubah atau dibatalkan sebelum pemrosesan dimulai, sesuai kebijakan persetujuan. |
| POST-06 | Hapus draft. | Pengguna dapat menghapus draft setelah konfirmasi. Data tidak lagi muncul dalam daftar; kebijakan retensi berkas mengikuti kebijakan penyimpanan. |
| POST-07 | Hasil posting. | Jika berhasil, simpan ID dan tautan posting Threads jika tersedia; pengguna dapat membukanya dari riwayat. |

### 6.4 Penjadwalan dan keandalan

- Jadwal disimpan sebagai waktu UTC bersama zona waktu pilihan pengguna; antarmuka menampilkan waktu sesuai zona tersebut. Waktu lokal yang tidak ada atau ambigu akibat perubahan zona waktu harus ditolak atau diminta konfirmasi eksplisit.
- Status minimal: **Draft → Diajukan → Disetujui / Ditolak**, lalu posting yang disetujui dapat menjadi **Terjadwal → Diproses → Terbit / Gagal / Perlu tindakan**. Publikasi sekarang yang telah disetujui masuk ke **Diproses**. **Hasil belum pasti** digunakan jika respons penerbitan tidak dapat dipastikan; status ini tidak otomatis dianggap gagal.
- Worker mengambil pekerjaan secara atomik dengan lease dan pemulihan saat proses terhenti. Pembatalan/perubahan hanya dijamin sebelum pekerjaan diklaim; UI memberi tahu bila sudah diproses.
- Kegagalan sementara yang diketahui aman untuk diulang memakai retry terbatas dan backoff. Kegagalan permanen, izin tidak memadai, atau token kedaluwarsa masuk **Gagal** atau **Perlu tindakan**, dengan pesan yang dapat ditindaklanjuti.
- Jika respons publikasi hilang atau timeout setelah permintaan dikirim, jangan otomatis menerbitkan ulang. Lakukan rekonsiliasi menggunakan kemampuan API yang tersedia; jika hasil tetap tidak pasti, tampilkan **Hasil belum pasti** dan minta pengguna memeriksa Threads sebelum mengulang secara manual. Pencegahan duplikasi dilakukan semaksimal mungkin, bukan jaminan exactly-once.
- Catat waktu jadwal, setiap percobaan, hasil, dan alasan yang aman ditampilkan. Percobaan otomatis tidak dimulai setelah satu jam dari waktu jadwal; pekerjaan yang belum dikirim setelah tenggat ditandai **Perlu tindakan**. Hasil penerbitan yang sudah dikirim tetap direkonsiliasi.

### 6.5 Dashboard, kalender, dan notifikasi

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| DASH-01 | Ringkasan. | Tampilkan jumlah draft, terjadwal, terbit, dan yang memerlukan tindakan; angka hanya mencakup data yang boleh diakses pengguna. |
| DASH-02 | Daftar dan kalender. | Pengguna dapat memfilter akun, status, dan rentang tanggal serta membuka detail posting. Kalender minimal mendukung tampilan bulanan. |
| DASH-03 | Notifikasi dalam aplikasi. | Kegagalan, hasil belum pasti, dan koneksi yang perlu otorisasi ulang terlihat di dashboard dengan tautan ke tindakan yang relevan. |
| DASH-04 | Riwayat. | Detail menunjukkan waktu jadwal, status, percobaan, dan pesan yang dapat ditindaklanjuti tanpa membocorkan token atau detail sensitif. |

### 6.6 Administrasi

Administrator dapat melihat status layanan, jumlah job dan kegagalan agregat, serta menonaktifkan akses pengguna. Aktivitas administratif dan perubahan koneksi dicatat. Akses administrator terhadap isi konten pengguna tidak diasumsikan; kebutuhan dan kebijakannya harus diputuskan sebelum diimplementasikan. Menonaktifkan pengguna menghentikan job yang belum diklaim; job yang telah dikirim ditangani melalui rekonsiliasi.

### 6.7 Tim dan persetujuan

- Pengguna yang berwenang mengundang anggota dan mengatur akses sesuai peran. Matriks peran dan cakupan akses akun Threads masih harus ditentukan.
- Konten diajukan untuk disetujui sebelum diterbitkan. Keputusan persetujuan mencatat aktor, waktu, dan versi konten. Perubahan konten atau akun tujuan membatalkan persetujuan sebelumnya.
- Admin dan reviewer boleh menyetujui konten sendiri. Pembuat draft, admin, atau reviewer boleh menjadwalkan dan menerbitkan konten yang disetujui. Perubahan waktu saja tidak memerlukan persetujuan ulang.
- Notifikasi kegagalan melalui GoWhatsapp termasuk MVP; penerima dan kejadian yang memicu pengiriman harus disepakati.

## 7. Kebutuhan nonfungsional

- **Keamanan:** HTTPS; hashing kata sandi dengan algoritma modern yang sesuai; enkripsi token saat tersimpan; secret di penyimpanan rahasia; proteksi CSRF, XSS, injeksi, dan rate limiting. Validasi akses di backend pada setiap operasi. Unggahan divalidasi dan dibatasi; media harus dapat diakses oleh Meta dengan cara dan masa berlaku yang sesuai integrasi.
- **Privasi:** kumpulkan data minimum, sediakan kebijakan privasi, mekanisme permintaan penghapusan data, dan prosedur pencabutan akses sesuai persyaratan yang berlaku. Retensi setidaknya 90 hari; cakupan per jenis data, backup, serta kebijakan penghapusan media dan log perlu disepakati.
- **Ketersediaan:** target awal pilot 99% bulanan untuk aplikasi dan worker, tidak termasuk dependensi eksternal; definisi pengukuran dan dukungan operasional perlu ditetapkan.
- **Performa:** target awal p95 halaman dashboard terbuka ≤ 3 detik pada kondisi normal, diukur dari server/aplikasi dengan skenario dan koneksi uji yang disepakati; panggilan Meta dan unggahan besar dilaporkan terpisah.
- **Observabilitas:** log terstruktur tanpa rahasia, metrik antrean, keterlambatan, kegagalan, status token, serta alert operasional. Audit log memuat aktor, aksi, objek, dan waktu.
- **Aksesibilitas dan perangkat:** antarmuka responsif untuk desktop dan mobile, navigasi keyboard, label formulir, serta kontras yang layak; target standar aksesibilitas final ditentukan pada desain.
- **Pemulihan:** backup data dan prosedur restore diuji; target RPO/RTO ditetapkan sebelum produksi. Pekerjaan yang belum selesai harus dapat dipulihkan tanpa mengulang publikasi yang hasilnya belum pasti.

## 8. Model data konseptual

| Entitas | Data utama |
|---|---|
| User | ID, email, status verifikasi, status akun, waktu dibuat. |
| AuthIdentity | User ID, provider lokal/Google, identitas provider; hash kata sandi hanya untuk lokal. |
| ThreadsAccount | Pemilik, ID dan nama akun Threads, status koneksi, metadata masa berlaku token; token terenkripsi. |
| Post | Pemilik, akun tujuan, teks, status, jadwal UTC, zona waktu, ID/tautan hasil Threads. |
| Media | Pemilik, lokasi penyimpanan, tipe, ukuran, metadata validasi. |
| PublicationAttempt | Post ID, nomor percobaan, waktu, hasil, kategori kesalahan, ID korelasi. |
| Notification / AuditEvent | Penerima atau aktor, jenis, objek, waktu, status baca atau detail yang aman. |

## 9. Integrasi dan dependensi

- **Threads API:** Meta app dengan use case Threads, izin dan otorisasi pengguna yang sesuai, serta akses/app review yang mungkin diperlukan sesuai kebijakan dan mode aplikasi. Validasi persyaratan ini pada akun dan lingkungan target sebelum komitmen peluncuran. Meta mendokumentasikan pembuatan container dan publikasi sebagai langkah terpisah; media dan batas penerbitan harus diverifikasi terhadap dokumentasi versi API saat implementasi. [Threads API — Meta](https://www.postman.com/meta/threads/collection/dht3nzz/threads-api).
- **Google Sign-In:** konfigurasi Google Cloud, OAuth client, redirect dan consent screen. Gunakan Google Identity Services/OpenID Connect dan validasi identitas pada backend. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
- **Email transaksional:** SMTP generik untuk undangan, verifikasi email dan reset kata sandi; penyedia dan konfigurasi domain belum dipilih.
- **GoWhatsapp API:** pengiriman notifikasi; versi layanan, kontrak API, penerima, dan aturan pengiriman masih perlu ditentukan.
- **OpenAPI:** API aplikasi didokumentasikan menggunakan OpenAPI untuk integrasi dengan sistem lain; autentikasi dan hak akses integrasi perlu ditetapkan.
- **Hosting:** aplikasi di-host sendiri. Perencanaan awal mencakup empat akun Threads per pengguna, 30 posting per hari dan penyimpanan 20 GB; cakupan angka posting masih perlu ditentukan.
- **Infrastruktur:** TypeScript pada Node.js, PostgreSQL, dan Docker Compose untuk self-hosting. Media disimpan pada volume Docker persisten di server yang sama; Meta mengambil media melalui URL HTTPS sementara. Pengelolaan secret, monitoring, backup dan kebijakan retensi masih perlu dirampungkan.

## 10. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Persetujuan Meta atau izin API tertunda | Peluncuran terhambat. | Buktikan alur aplikasi Meta dan persyaratan akses sejak awal; uji pada akun yang diizinkan. |
| Perubahan API, limit, atau jenis media | Publikasi gagal atau fitur berubah. | Isolasi integrasi, pantau dokumentasi, validasi batas saat implementasi, dan tampilkan kesalahan yang jelas. |
| Timeout setelah penerbitan | Risiko posting duplikat. | Status hasil belum pasti dan rekonsiliasi; hindari retry otomatis yang tidak aman. |
| Token dicabut atau kedaluwarsa | Posting tertunda atau gagal. | Pantau masa berlaku, refresh sesuai aturan, dan tampilkan tindakan otorisasi ulang. |
| Gangguan worker atau penyimpanan | Jadwal terlambat atau data hilang. | Antrean persisten, lease, monitoring, backup, dan uji pemulihan. |
| Penyalahgunaan autentikasi atau akses lintas pengguna | Kebocoran akun atau data. | Rate limit, pengamanan sesi, isolasi akses server, audit, dan pengujian keamanan. |

## 11. Tahapan dan kriteria rilis

1. **Validasi:** sepakati asumsi produk; buktikan login Google, otorisasi Threads, penerbitan teks/media, akses Meta, dan batas API pada lingkungan uji.
2. **Implementasi MVP:** autentikasi, koneksi akun, komposer, penjadwalan, worker, dashboard, notifikasi, dan operasi dasar.
3. **Pilot:** uji alur end-to-end termasuk token dicabut, kegagalan media, restart worker, timeout dan rekonsiliasi, zona waktu, serta isolasi pengguna. Ukur indikator pada bagian 2.
4. **Rilis:** seluruh P0 dan kriteria penerimaannya terpenuhi; persyaratan Meta dan Google untuk lingkungan produksi dikonfirmasi; monitoring, backup/restore, keamanan, privasi, dan prosedur respons insiden tersedia. Pengecualian harus dicatat dan disetujui pemilik produk.

## 12. Keputusan terbuka

1. Apakah produk hanya untuk penggunaan pribadi/internal, atau akan tersedia untuk publik sebagai SaaS? Penggunaan internal
2. Apakah registrasi terbuka atau berbasis undangan? Siapa yang menjadi administrator awal? Berbasis undangan, administrator awal adalah wijaya.indra2196@gmail.com
3. Berapa perkiraan pengguna, akun Threads per pengguna, volume posting, dan kebutuhan penyimpanan? 4 akun threads per pengguna, 30 posting perhari, 20 GB
4. Apakah pengelolaan oleh tim dan persetujuan konten harus masuk MVP? Ya
5. Apakah teks, satu gambar, dan satu video cukup untuk MVP; apakah carousel atau rangkaian balasan wajib sejak awal? 
6. Apakah notifikasi di aplikasi cukup, atau kegagalan harus dikirim melalui email/kanal lain? Notifikasi melalui GoWhatsapp API
7. Apa preferensi hosting, stack teknologi, anggaran, target tanggal, dan lokasi penyimpanan data? Self hosting, teknologi yang mendukung openapi karena akan saya integrasikan ke sistem yang lain melalui API
8. Apa kebijakan retensi/penghapusan data, kepemilikan akun Threads, serta batas akses administrator? Retensi data setidaknya 90 hari
9. Berapa toleransi keterlambatan dan kapan posting yang terlewat harus berhenti dicoba? Toleransi5 menit, berhenti dicoba setelah lewat 1 jam
