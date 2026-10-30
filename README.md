# FAIISA KantinKu — Prototipe 0.5

Prototipe aplikasi manajemen kantin sekolah untuk laptop/PC kasir dengan tampilan responsif. Versi ini melanjutkan fitur produk & stok, kasir, barcode, titip jual/konsinyasi, transaksi, keuangan, laporan, dan menambahkan rancangan login petugas serta pergantian shift.

## Fitur dalam prototipe
- Dashboard, kasir, katalog produk, stok, transaksi, keuangan, laporan.
- Input barcode manual/scanner USB-Bluetooth (scanner bertindak seperti keyboard) dan kamera jika browser mendukung `BarcodeDetector` serta HTTPS/localhost.
- Data lokal menggunakan IndexedDB dan dapat digunakan tanpa koneksi internet untuk fitur yang datanya sudah tersimpan.
- Titip jual: pencatatan penitip, penerimaan kiriman, penjualan, hak penitip, dan retur sisa harian.
- Login lokal demo dengan pilihan nama dan PIN.
- Penambahan/nonaktifkan akun petugas lokal.
- Pencatatan serah terima shift dengan nominal kas dihitung dan catatan.
- Kolom transaksi menyimpan nama petugas yang sedang login.

## Akun contoh
- Admin lokal: **Admin Kantin**, PIN **1234**.
- Petugas: **Petugas Kantin**, PIN **1111**.

Segera ubah PIN contoh melalui pengelolaan petugas sebelum demo internal. Login/PIN pada versi ini hanya simulasi lokal; PIN disimpan di browser dan **belum aman untuk penggunaan produksi**.

## Cara menjalankan di laptop Windows
1. Ekstrak ZIP ke folder, misalnya `C:\FAIISA-KantinKu`.
2. Buka folder tersebut.
3. Untuk uji coba sederhana, buka `index.html` dengan Chrome atau Edge. Fitur IndexedDB berjalan pada browser modern; untuk service worker/PWA dan akses kamera, jalankan melalui HTTPS atau localhost.
4. Login dengan salah satu akun contoh di atas.
5. Coba transaksi contoh, pengelolaan produk, barcode, dan serah terima.

Untuk pengalaman terbaik, gunakan Chrome/Edge versi terbaru, layar laptop minimal 1366×768, RAM 8 GB, dan scanner barcode USB yang bertindak sebagai keyboard.

## Batasan penting — belum untuk transaksi uang sungguhan
- Data hanya tersimpan di browser/perangkat yang digunakan. Laptop dan HP admin **belum berbagi data**.
- Status Online hanya menunjukkan koneksi internet; Firebase/cloud belum terpasang. Tombol sinkronisasi belum mengirim data ke server.
- Login/PIN adalah simulasi dan bukan autentikasi aman; belum ada hashing PIN, pembatasan percobaan, hak akses server, atau audit trail terlindungi.
- Jadwal shift pada tahap ini belum memiliki kalender/pengingat otomatis; yang tersedia adalah daftar akun dan catatan serah terima.
- Offline queue belum mempunyai proses sinkronisasi cloud idempoten atau penyelesaian konflik stok multi-perangkat.
- Backup JSON tersedia pada menu Pengaturan. Simpan cadangan secara berkala.

## Tahap sebelum produksi
1. Pasang Firebase Authentication atau penyedia autentikasi yang aman.
2. Rancang Firestore dan Security Rules untuk admin, petugas, produk, stok, penjualan, penitip, dan log.
3. Tambahkan sinkronisasi offline-first yang idempoten, validasi stok di server, serta penanganan konflik.
4. Buat dashboard admin HP yang mengambil data dari cloud.
5. Tambahkan kalender jadwal shift, persetujuan serah terima, dan audit log.
6. Uji transaksi, barcode, printer struk, backup/restore, dan pemulihan saat listrik/internet terputus.

**Jangan gunakan prototipe ini sebagai sistem kasir produksi atau sebagai sumber tunggal pembukuan sebelum tahap keamanan dan sinkronisasi selesai.**
