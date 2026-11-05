# Menyiapkan Meta App untuk Threads

Panduan awal, diperiksa 5 November 2026. Nama menu dan persyaratan Meta dapat berubah. Koneksi OAuth telah dibuat dan diuji dengan respons simulasi, tetapi **belum diuji dengan Meta sungguhan**. Penjadwalan dan penerbitan teks tersedia untuk pengujian terbatas dan worker dinonaktifkan secara default.

## 1. Yang perlu disiapkan

- Akun Meta yang dapat mengakses [Meta for Developers](https://developers.facebook.com/), serta akun Threads yang akan digunakan sebagai akun uji.
- Alamat HTTPS untuk aplikasi yang akan dipakai pada alur otorisasi. `http://127.0.0.1:3000` pada mode lokal adalah alamat komputer sendiri; jangan menganggapnya dapat diakses Meta atau diterima sebagai redirect. Periksa ketentuan Meta dan infrastruktur yang dipilih sebelum menetapkan alamat.
- Akses operator ke konfigurasi aplikasi self-hosted untuk menyimpan rahasia. Jangan mengirim App Secret, authorization code, access token, atau kata sandi melalui chat, screenshot, repository, atau log.

## 2. Membuat aplikasi

1. Buka [Meta for Developers](https://developers.facebook.com/) dan masuk dengan akun Meta milikmu. Selesaikan pendaftaran developer bila diminta.
2. Buka **My Apps**, lalu pilih **Create App**. Pilih use case **Threads** atau pilihan yang sesuai bila Meta mengganti nama tampilannya. Isi nama dan informasi yang diminta Meta, kemudian buat aplikasinya.
3. Pada dashboard aplikasi, buka pengaturan use case/produk Threads. Jika opsi Threads tidak muncul atau Meta meminta langkah tambahan, ikuti petunjuk di dashboard dan [Threads API milik Meta](https://developers.facebook.com/docs/threads/).
4. Catat **Threads App ID**. Simpan **Threads App Secret** di tempat yang aman; jangan memasukkannya ke dokumen proyek. Meta menampilkan keduanya pada pengaturan aplikasi Threads. [Referensi Meta](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api).
5. Untuk pengujian terbatas, tambahkan akun uji ke peran yang sesuai di dashboard Meta dan selesaikan penerimaan undangannya bila diminta. Peran, mode aplikasi, serta kebutuhan App Review atau akses tambahan bergantung pada kebijakan Meta dan jenis akses. Konfirmasi statusnya di dashboard sebelum menguji dengan akun lain.

## 3. Redirect dan izin

- Aplikasi ini akan menggunakan otorisasi resmi Meta; hanya admin aplikasi yang boleh menghubungkan akun Threads. Seluruh anggota tim boleh memilih akun yang terhubung sebagai tujuan draft.
- URL callback aplikasi ini adalah **`https://DOMAIN-APLIKASI/api/threads/oauth/callback`**, dengan `DOMAIN-APLIKASI` diganti domain HTTPS yang benar. Origin harus sama persis dengan `APP_ORIGIN` dan diarahkan melalui HTTPS ke aplikasi yang berjalan. Daftarkan URL lengkap tersebut pada konfigurasi callback Threads di dashboard Meta; jangan masukkan `DOMAIN-APLIKASI` secara harfiah. Meta mensyaratkan redirect URI saat pertukaran kode cocok dengan yang digunakan saat otorisasi. [Referensi Meta](https://www.postman.com/meta/threads/request/34203612-32805431-ab3c-4480-9312-67cfd63f7ba7).
- Aplikasi meminta `threads_basic`, `threads_content_publish`, `threads_manage_replies`, dan `threads_read_replies`. Dua izin balasan digunakan untuk rangkaian posting dan pemeriksaan balasan saat pemulihan. Aktifkan izin yang tersedia di use case Threads pada Meta App, lalu hubungkan ulang akun yang sebelumnya terhubung agar permintaan izin yang baru muncul. Akses izin dan App Review bergantung pada status aplikasi dan akun. [Koleksi Threads resmi Meta](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api).
- Login Google ke aplikasi dan otorisasi akun Threads adalah proses berbeda. Jangan memasukkan kata sandi Threads ke aplikasi ini.

## 4. Konfigurasi dan uji koneksi

1. Konfigurasikan `APP_ORIGIN`, `THREADS_APP_ID`, `THREADS_APP_SECRET`, dan `THREADS_TOKEN_KEY` pada lingkungan server. `APP_ORIGIN` adalah origin HTTPS tanpa slash akhir atau path; callback dibuat otomatis dari origin itu. Kunci token harus 32 byte acak dalam format base64url dan disimpan secara persisten di penyimpanan rahasia. Buat sekali dan jangan ganti sembarangan: kunci yang hilang membuat token tersimpan tidak dapat dibaca. Jangan memasukkan rahasia ke chat, repository, atau log.
2. Siapkan reverse proxy HTTPS ke aplikasi dan konfigurasikan cookie/proxy sesuai [README](../README.md). Mode `npm run local` menggunakan HTTP lokal dan sengaja tidak mengaktifkan OAuth. Domain saja belum cukup jika aplikasi belum dapat diakses lewat HTTPS.
3. Setelah konfigurasi dan migrasi, masuk sebagai admin dengan email terverifikasi, pilih **Hubungkan akun Threads**, lalu berikan persetujuan di halaman resmi Meta.
4. Periksa identitas akun dan status koneksi dengan akun uji yang berwenang. Konfirmasi persyaratan Meta untuk mode aplikasi, termasuk App Review jika berlaku. Jangan menganggap akses akun uji otomatis berlaku untuk semua pengguna.

**Jangan kirim App Secret atau token kepada asisten**; jika pengujian gagal, berikan pesan kesalahan tanpa data sensitif. Pengujian API Meta nyata, pengelolaan masa berlaku token dan penerbitan media masih belum selesai. Lihat README untuk mengaktifkan worker pengujian dan menangani hasil yang belum pasti.

## 5. Error App ID saat otorisasi

Jika Meta menampilkan `4476002`, periksa parameter `client_id` pada permintaan otorisasi yang dibuat aplikasi, bukan hanya isi file `.env`. Environment Linux peka huruf besar/kecil: aplikasi membaca `THREADS_APP_ID`. Setelah mengubah konfigurasi Compose, buat ulang container; restart saja tidak menerapkan environment baru. Gunakan pasangan ID/secret khusus Threads. App Secret baru dipakai setelah callback untuk pertukaran kode dan tidak dikirim ke halaman otorisasi browser.

Domain otorisasi langsung saat ini adalah `https://www.threads.com/oauth/authorize`. Uji HTTP pada 5 November 2026 menunjukkan domain `threads.net` mengarah ke domain tersebut dan tetap membawa `client_id`; perpindahan domain saja belum membuktikan penyebab error. Jangan membagikan URL OAuth lengkap karena memuat state sesi. Jika parameter sudah cocok, periksa peran akun uji dan status undangannya serta konfigurasi use case di dashboard Meta.

## 6. Kegagalan setelah kembali ke aplikasi

Panel koneksi menampilkan tahap kegagalan, bukan hanya pesan umum. Untuk kegagalan sesi, mulai ulang melalui tombol dan selesaikan pada browser yang sama dalam 10 menit. Untuk pertukaran kode, periksa pasangan kredensial Threads dan callback yang terdaftar. Untuk token jangka panjang atau profil, lihat kode Meta dan akses akun. Untuk penyimpanan, pastikan migrasi telah diterapkan serta database dan kunci enkripsi tersedia. Setiap percobaan membutuhkan kode dan state baru; jangan mengulang URL callback lama.

Operator dapat menjalankan `docker compose logs --tail=100 app` dan mencari event `threads_oauth_failed`. Event hanya memuat tahap, kategori terbatas, serta status HTTP/kode/subkode numerik Meta jika tersedia. Jangan mengaktifkan pencatatan URL callback lengkap atau membagikan token dan secret. Diagnosis tahap ini belum menggantikan uji koneksi Meta sungguhan.

Versi terbaru juga menampilkan subkode dan kategori penolakan jika tersedia. Jika Meta meminta tester atau App Review, periksa peran **Threads Tester** pada aplikasi Meta yang sama dan pastikan undangan untuk akun Threads yang digunakan telah diterima. Admin/developer Meta tidak boleh diasumsikan sebagai Threads Tester yang sudah menerima undangan. Cari undangan pada pengaturan Threads bagian izin situs web; nama menu dapat berubah. Jika hendak memakai akun di luar cakupan pengujian, pastikan akses App Review yang diperlukan telah disetujui. Kode 100 tanpa rincian tidak cukup untuk menyimpulkan penyebab ini.

Jika instalasi lama berhenti pada tahap `long_token` dengan kode Meta 100, perbarui kode dan image aplikasi sebelum mencoba lagi. Implementasi terbaru menyertakan token sementara sebagai parameter `access_token` pada GET pertukaran token, sesuai [contoh resmi Meta](https://github.com/fbsamples/threads_api/blob/main/src/index.js). URL pertukaran memuat kredensial dan tidak boleh masuk log HTTP keluar. Mulai kembali dari tombol koneksi setelah pembaruan; kode callback sebelumnya sudah dikonsumsi.

## 7. Rangkaian terhenti pada bagian balasan

Bagian setelah posting pertama dikirim sebagai balasan. Pastikan Meta App menyediakan izin balasan yang diminta, perbarui aplikasi, lalu sebagai admin hubungkan ulang akun Threads dan setujui izin yang muncul. Perubahan scope aplikasi tidak mengubah token lama secara otomatis. Setelah koneksi kembali, gunakan **Lanjutkan rangkaian** pada pekerjaan yang terhenti; aplikasi melanjutkan dari bagian yang belum terbit tanpa membuat draft baru.

Jika tetap gagal, cari event `threads_container_rejected` pada `docker compose logs --tail=100 app`. Event hanya memuat ID pekerjaan, nomor bagian, status HTTP, serta kode/subkode numerik Meta jika tersedia. Kode dapat dipakai untuk diagnosis; jangan membagikan token, URL OAuth, atau pesan provider mentah. Log baru hanya muncul untuk percobaan setelah pembaruan dan tidak menjelaskan penyebab percobaan lama secara pasti.

Untuk memeriksa izin yang benar-benar melekat pada token akun terhubung, operator server dapat menjalankan:

```bash
docker compose exec -T app npm run check-threads-permissions
```

Perintah ini memanggil endpoint debug resmi Meta dari server dan hanya menampilkan nama akun, validitas token, kecocokan App ID, dan empat nama izin yang dipakai aplikasi. Token, App Secret, URL, dan respons mentah tidak ditampilkan. `missing` berisi izin yang tidak diberikan; daftar kosong tidak membuktikan bahwa semua kebijakan Meta atau kondisi posting sudah terpenuhi. `debug_failed` atau respons tak dikenal berarti pemeriksaan tidak selesai dan bukan bukti izin tertentu hilang. Jika scope kurang, periksa use case pada Meta App dan hubungkan kembali akun dengan izin tersebut. Jika semua ada tetapi Meta masih menolak, periksa status tester, akses dan kebijakan akun/aplikasi di Meta; jangan menyimpulkan penyebab hanya dari kode 10.
