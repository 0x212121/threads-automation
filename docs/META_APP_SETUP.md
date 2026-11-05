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
- Untuk alur awal, izin yang direncanakan adalah `threads_basic` dan `threads_content_publish`; permintaan akhir akan dicocokkan dengan kemampuan yang diimplementasikan dan kebijakan Meta. Izin untuk insight, balasan, atau fitur lain tidak diminta hanya untuk publikasi dasar. [Referensi Meta](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api).
- Login Google ke aplikasi dan otorisasi akun Threads adalah proses berbeda. Jangan memasukkan kata sandi Threads ke aplikasi ini.

## 4. Konfigurasi dan uji koneksi

1. Konfigurasikan `APP_ORIGIN`, `THREADS_APP_ID`, `THREADS_APP_SECRET`, dan `THREADS_TOKEN_KEY` pada lingkungan server. `APP_ORIGIN` adalah origin HTTPS tanpa slash akhir atau path; callback dibuat otomatis dari origin itu. Kunci token harus 32 byte acak dalam format base64url dan disimpan secara persisten di penyimpanan rahasia. Buat sekali dan jangan ganti sembarangan: kunci yang hilang membuat token tersimpan tidak dapat dibaca. Jangan memasukkan rahasia ke chat, repository, atau log.
2. Siapkan reverse proxy HTTPS ke aplikasi dan konfigurasikan cookie/proxy sesuai [README](../README.md). Mode `npm run local` menggunakan HTTP lokal dan sengaja tidak mengaktifkan OAuth. Domain saja belum cukup jika aplikasi belum dapat diakses lewat HTTPS.
3. Setelah konfigurasi dan migrasi, masuk sebagai admin dengan email terverifikasi, pilih **Hubungkan akun Threads**, lalu berikan persetujuan di halaman resmi Meta.
4. Periksa identitas akun dan status koneksi dengan akun uji yang berwenang. Konfirmasi persyaratan Meta untuk mode aplikasi, termasuk App Review jika berlaku. Jangan menganggap akses akun uji otomatis berlaku untuk semua pengguna.

**Jangan kirim App Secret atau token kepada asisten**; jika pengujian gagal, berikan pesan kesalahan tanpa data sensitif. Pengujian API Meta nyata, pengelolaan masa berlaku token dan penerbitan media masih belum selesai. Lihat README untuk mengaktifkan worker pengujian dan menangani hasil yang belum pasti.
