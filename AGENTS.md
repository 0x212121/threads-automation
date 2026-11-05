# Instruksi Proyek untuk Agen

## Konteks

Baca `PRD.md` dan `SPEC.md` sebelum mengubah perilaku produk; gunakan `TASKS.md` untuk urutan pekerjaan. `SPEC.md` mencatat keputusan yang masih terbuka. Jangan menganggap rancangan yang ditandai usulan sebagai keputusan final. Jika perubahan bergantung pada keputusan terbuka yang material, jelaskan dampaknya dan minta keputusan; kerjakan bagian independen yang sudah jelas.

## Aturan kerja

- Jaga cakupan MVP: aplikasi internal self-hosted, undangan, autentikasi lokal/Google, tim dan persetujuan, Threads, penjadwalan, GoWhatsapp, serta API berkontrak OpenAPI.
- Untuk pekerjaan antarmuka, gunakan arah visual dalam `DESIGN.md` dan skill antislop sebagai filter.
- Terapkan autentikasi dan otorisasi di server untuk UI dan API; jangan melewati persetujuan lewat endpoint integrasi. Jangan memberi admin hanya berdasarkan alamat email yang diklaim.
- Jangan simpan secret, token, kata sandi, atau data pribadi yang tidak perlu dalam repository atau log. Jangan meminta kata sandi Threads.
- Cegah pengulangan publikasi yang hasilnya belum pasti; jangan mengklaim jaminan exactly-once. Pertahankan riwayat percobaan, status yang jelas, dan tenggat otomatis satu jam.
- Simpan waktu terjadwal dalam UTC beserta zona waktu; perlakukan perubahan jadwal dan kondisi bersamaan secara aman.
- Gunakan dokumentasi resmi terkini untuk batas dan alur integrasi; validasi GoWhatsapp terhadap instalasi yang benar. Jangan menebak kontrak API eksternal.
- Perbarui PRD, spesifikasi, kontrak OpenAPI, dan tugas bila keputusan atau perilaku terkait berubah; hindari menduplikasi detail yang mudah berbeda.
- Uji perubahan secara proporsional, khususnya autentikasi/akses, persetujuan, penjadwalan, retry dan kegagalan integrasi. Laporkan pengujian yang dilakukan dan keterbatasannya.
- Hormati perubahan pengguna yang sudah ada. Jangan memilih stack, menetapkan kebijakan akses, atau menerapkan fitur di luar cakupan sebagai keputusan yang sudah disetujui tanpa dasar.
