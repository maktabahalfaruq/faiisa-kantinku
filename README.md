# FAIISA KantinKu — Prototipe 0.1

Aplikasi web/PWA prototipe untuk manajemen kantin sekolah. Antarmuka berbahasa Indonesia, responsif, dan menyimpan data demo pada IndexedDB di browser.

## Fitur yang sudah tersedia di prototipe

- Dashboard ringkas.
- Katalog produk, kategori, harga modal/jual, barcode/SKU, stok minimum.
- Kasir dengan keranjang, hitung total, metode pembayaran, dan kembalian tunai.
- Pengurangan stok atomik bersama penyimpanan transaksi lokal di IndexedDB.
- Pembatalan transaksi lokal dengan pengembalian stok.
- Pencarian produk dan barcode.
- Pemindaian barcode kamera pada browser yang mendukung `BarcodeDetector`, melalui HTTPS/localhost.
- Input barcode manual dan scanner USB yang berperilaku seperti keyboard.
- Catatan pengeluaran operasional.
- Laporan sederhana dan ekspor CSV.
- Unduh cadangan JSON.
- Cache shell PWA untuk akses ulang offline setelah situs pertama kali dibuka online.

## Batasan yang wajib diketahui

**Ini belum siap dipakai untuk transaksi nyata atau multi-perangkat.** Firebase belum dikonfigurasi; data hanya ada di browser/perangkat yang digunakan. Status antrean sinkronisasi ditampilkan, tetapi proses upload ke cloud belum dibuat. Autentikasi dan aturan keamanan produksi juga belum tersedia.

Versi produksi harus menambahkan:
1. Firebase Authentication dan peran pengguna.
2. Firestore Security Rules yang menolak akses tanpa izin.
3. Cloud Functions atau backend tepercaya untuk validasi transaksi dan sinkronisasi idempoten.
4. Proses sinkronisasi dengan ID transaksi unik, retry, konflik, dan rekonsiliasi.
5. Audit log yang tidak dapat diubah sembarangan untuk pembatalan/koreksi.
6. Prosedur backup dan pemulihan.
7. Pengujian browser/perangkat dan uji pemutusan jaringan.

## Menjalankan lokal

Service Worker/PWA umumnya membutuhkan HTTPS atau `localhost`. Jangan membuka `index.html` langsung dengan `file://` jika ingin menguji PWA.

Jika Python 3 tersedia:
```bash
python -m http.server 8080
```
Lalu buka `http://localhost:8080` di browser.

Alternatif: deploy file ini ke hosting statis HTTPS.

## Konfigurasi Firebase untuk tahap berikutnya

1. Buat proyek di Firebase Console.
2. Aktifkan Authentication (misalnya Email/Password).
3. Buat Cloud Firestore.
4. Siapkan koleksi per sekolah, misalnya `schools/{schoolId}/products`, `sales`, `stockMovements`, `expenses`, dan `auditLogs`.
5. Tambahkan aturan akses berdasarkan `request.auth.uid` dan peran yang tersimpan/terverifikasi di server.
6. Jangan pernah mengaktifkan aturan publik seperti `allow read, write: if true`.
7. Jangan memasukkan service-account key atau kredensial admin server ke dalam JavaScript browser.
8. Integrasikan SDK Firebase dan fungsi sinkronisasi setelah skema serta aturan akses diuji.

## Strategi sinkronisasi yang direkomendasikan

- Kasir utama adalah perangkat yang mengotorisasi penjualan saat offline.
- Setiap transaksi diberi ID global unik, `deviceId`, waktu lokal, dan `schemaVersion`.
- Simpan transaksi dan perubahan stok dalam satu transaksi IndexedDB.
- Saat online, kirim transaksi ke endpoint tepercaya dengan operasi idempoten: pengiriman ulang ID yang sama tidak boleh membuat penjualan kedua.
- Server memvalidasi harga, stok, status transaksi, dan otorisasi sebelum menulis data pusat.
- Setelah server mengakui penyimpanan, tandai transaksi sebagai tersinkron.
- Jangan menganggap `navigator.onLine` sebagai bukti bahwa Firebase bisa diakses.
- Jika perangkat pengelola mengubah katalog saat kasir offline, perubahan tersebut tidak boleh diam-diam menimpa transaksi lokal; sediakan kebijakan konflik dan rekonsiliasi.
- Hindari menjalankan dua kasir offline secara bersamaan dengan stok bersama tanpa desain reservasi/rekonsiliasi khusus.

## Struktur file

- `index.html` — struktur UI
- `styles.css` — gaya responsif
- `app.js` — aplikasi prototipe dan IndexedDB
- `manifest.webmanifest` — metadata PWA
- `sw.js` — cache shell aplikasi untuk offline
