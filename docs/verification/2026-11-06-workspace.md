# Verifikasi fitur ruang kerja

Fitur: anggota/undangan, kalender/filter, pengelolaan akun Threads, hapus draft, riwayat/audit. Antislop `during`, sesuai pilihan pengguna selama pengembangan. Design Read dari `DESIGN.md`: editorial terang, aksen hangat, ENERGY 1 / RHYTHM 2 / MOTION 1.

## Bukti

- `npm test`: 62 pengujian; 61 lulus, satu pengujian MP4 dilewati karena `ffprobe` tidak tersedia. Database pengujian PGlite dan pengujian socket PostgreSQL; bukan klaim validasi server PostgreSQL produksi.
- `npm run typecheck` dan `npm run build`: lulus.
- `node --import tsx scripts/verify-workspace.mjs`: Chrome headless dengan database sementara, data sintetis, Meta dan SMTP palsu. Tidak ada worker, pengiriman email nyata, atau publikasi Meta nyata.
- Alur browser: login, paginasi konten/anggota/undangan/audit, hapus draft, 55 versi konten dan paginasi riwayat, kalender, filter dan reset, perubahan peran, nonaktif/aktif, pengiriman/pencabutan undangan, pemeriksaan izin dan pemutusan akun, refresh, logout, dan Escape pada dialog.
- Screenshot desktop 1440×1000 dan ponsel 390×844 untuk lima panel diperiksa. Tidak ada luapan horizontal (`scrollWidth <= innerWidth`) dan tidak ada exception JavaScript. Kontras teks terhitung memenuhi AA pada lima panel; warna sidebar/breadcrumb/footer diperbaiki setelah pemeriksaan awal.
- Bukti lokal yang tidak masuk Git: `.local-data/verification/workspace-report.json`, `workspace-contrast.json`, dan `workspace-*.png`.
- Batas: belum ada pengujian fitur baru pada Meta, SMTP atau server PostgreSQL produksi. Pemutusan akun lokal tidak mencabut izin Meta. Pembersihan media/retensi otomatis belum dibuat.

## Delivery Gate antislop

### Hard Gate

- R-02 PASS: teks antarmuka baru tidak menggunakan em dash.
- R-03 PASS: sepuluh screenshot dan pemeriksaan lebar browser pada lima panel di 1440/390 px; tidak ada luapan horizontal.
- R-17 PASS: tidak ada statistik pemasaran; daftar dan status berasal dari API, data screenshot dinyatakan sebagai fixture sintetis.
- R-18 PASS: tidak ada testimonial atau avatar rekaan.
- R-23 PASS: navigasi mengikuti lima fitur yang diminta secara eksplisit; tidak membuat logo, avatar, atau aset baru.
- R-24 PASS: tab menunjuk panel yang ada; tombol riwayat membuka dialog dan lampiran memakai endpoint media yang ada.
- R-25 PASS: skrip Chrome menghitung rasio warna teks terhadap latar, dengan ambang AA 4.5:1 atau 3:1 untuk teks besar; laporan akhir kosong dari pelanggaran pada lima panel.
- R-26 PASS: kontrol baru terhubung ke operasi API atau navigasi/filter; paginasi dan mutasi diuji melalui Chrome, OAuth ulang memakai handler koneksi yang sudah diuji terpisah.
- R-27 PASS: setiap panel memiliki status pemuatan, kosong, dan kegagalan; API gagal tidak ditampilkan sebagai keberhasilan.
- R-28 PASS: tidak menambahkan FAQ.
- R-32 PASS: kontrol memakai button/input/select/label native dan focus-visible yang ada; Escape pada dialog diuji dengan event keyboard Chrome.
- R-33 PASS: UI ditulis pada sumber `public/app.js`, `index.html`, dan `workspace.css`; tidak ada patch DOM/CSS dari skrip eksternal yang disertakan dalam produk.
- R-34 PASS: mempertahankan tema terang yang diminta; tidak ada toggle tema atau mode tambahan.
- R-35 PASS: aplikasi dibangun dan dijalankan pada server lokal sementara; click-through dicatat oleh skrip Chrome, termasuk paginasi lebih dari 50 item.
- R-36 PASS: tidak menambahkan klaim keamanan, performa, kepatuhan, atau jaminan publikasi; batas pemutusan lokal dijelaskan.
- R-37 PASS: memakai arah dan dials `DESIGN.md` sebelum implementasi.
- R-38 PASS: tidak menanamkan fixture pengujian atau identitas palsu di produk; data uji hanya dibuat pada database sementara skrip verifikasi.
- R-39 PASS: kontrol native bernama, field berlabel, tombol minimum 44 px, focus-visible, disabled state; tidak menambahkan animasi dan tetap mengikuti reduced-motion yang ada.
- R-40 PASS: tidak menambahkan gambar atau skrip pihak ketiga; media memakai dimensi yang sudah ada dan status loading memiliki ruang; tidak mengklaim angka performa.

### Purpose-Gate

- R-01 PASS: tidak menambahkan gradient atau glow.
- R-04 PASS: kontrol baru menggunakan label teks yang menyebut tindakan; tidak menambahkan pustaka ikon.
- R-06 PASS: hierarki judul serif dan teks operasional mengikuti tipografi editorial yang ada.
- R-07 PASS: grid hanya digunakan untuk kalender dengan tanggal dan hari, bukan dekorasi latar.
- R-08 PASS: tidak menambahkan panah dekoratif pada CTA.
- R-09 PASS: tidak menambahkan badge pemasaran; status konten yang ada menyampaikan keadaan operasional.
- R-10 PASS: tidak menambahkan glassmorphism.
- R-12 PASS: daftar dan kalender tidak memakai shadow; dialog tetap memakai elevasi yang ada untuk memisahkan tugas modal.
- R-13 PASS: tidak menambahkan glow.
- R-14 PASS: daftar anggota, kalender tanggal, dan riwayat memakai susunan sesuai jenis data; tidak ada feature card pemasaran.
- R-19 PASS: tidak menambahkan animasi template; MOTION 1 dipertahankan.
- R-22 PASS: tidak menambahkan ilustrasi generik.

### Liveliness

- Dials PASS: ENERGY 1 / RHYTHM 2 / MOTION 1 tercatat pada `DESIGN.md` dan diterapkan pada panel operasional.
- Konsistensi dials PASS: judul, daftar berurutan, grid tanggal, dan dialog riwayat membedakan jenis tugas tanpa animasi baru.
- Fokus PASS: tiap panel mempunyai judul dan tindakan utama yang sesuai tugas; screenshot desktop/ponsel diperiksa.
- Ruang PASS: garis dan spasi memisahkan kelompok filter, anggota, serta catatan riwayat.
- Aksen PASS: aksen hangat membedakan tindakan dan tab aktif; isi utama tetap netral.
- Motif PASS: judul editorial serif dan daftar dengan pemisah tipis meneruskan karakter aplikasi yang ada.
- Design Read PASS: arah pengguna dan `DESIGN.md` telah dibaca sebelum perubahan UI.

### Craftsmanship dan Quality Locks

- C-1 PASS: keputusan susunan mengikuti tugas nyata; alasan grid/list/dialog dijelaskan pada CSS dan Design Read.
- C-2 PASS: operasi, pagination, filter, dan dialog diuji di Chrome; kegagalan server memiliki pesan.
- C-3 PASS: setiap panel sesuai fitur 1, 2, 4, 5, atau 6 yang diminta pengguna.
- C-4 PASS: browser desktop/ponsel, keyboard Escape, state kosong/loading/error, dan kontrol akses API diuji.
- C-5 PASS: laporan membedakan data uji, hasil tes, dan batas validasi produksi.
- R-05 PASS: dashboard memakai daftar konten/anggota, kalender dan audit, tanpa susunan landing page pemasaran.
- R-11 PASS: kontrol memakai radius kecil yang sudah ada; kalender/daftar bukan kumpulan capsule.
- R-15 PASS: CTA menyebut tindakan: Simpan peran, Cabut undangan, Periksa izin, Putuskan koneksi, Hapus draft, Muat riwayat lainnya.
- R-16 PASS: tidak menambahkan jargon pemasaran AI.
- R-20 PASS: isi dan hierarki secara khusus menangani persetujuan, akun Threads, rangkaian/bagian dan rekonsiliasi publikasi.
- R-21 PASS: tema terang mempertahankan pilihan eksplisit pengguna.
- R-29 PASS: memakai warna netral dan satu aksen hangat dari palet yang ada; warna status dipertahankan untuk makna operasional.
- R-30 PASS: meneruskan aplikasi yang ada; tidak mengadopsi template atau tiruan produk lain.
- R-31 PASS: daftar untuk membaca tim/riwayat, grid untuk tanggal, dialog untuk detail, dan aksen untuk tindakan; alasan masing-masing konkret.
