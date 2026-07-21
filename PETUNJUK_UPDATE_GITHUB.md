# Petunjuk Update GitHub Pages

Unggah dan **replace** file/folder berikut pada repository GitHub:

```text
index.html
app.js
styles.css
data/search-index.json
data/records/
scripts/fix_titles.py
```

File `data/summary.json` tidak wajib diganti, tetapi aman bila seluruh isi paket diunggah ulang.

## Fungsi setiap file

- `app.js`: pagination 5 data, relasi pembimbing–topik, dan isi panel saat node diklik.
- `styles.css`: tampilan lebih sederhana, ukuran halaman stabil, dan pencegahan scroll horizontal.
- `index.html`: wadah pagination dan teks petunjuk node.
- `data/search-index.json`: judul yang sudah diberi spasi untuk halaman koleksi dan pencarian.
- `data/records/*.json`: judul yang sudah diberi spasi pada modal abstrak.

## Cara upload

1. Ekstrak ZIP.
2. Buka repository GitHub.
3. Pilih **Add file → Upload files**.
4. Seret seluruh isi folder hasil ekstraksi.
5. Pastikan GitHub menampilkan pilihan untuk mengganti file lama.
6. Klik **Commit changes**.
7. Tunggu deployment GitHub Pages selesai, lalu tekan `Ctrl + F5`.

`data/search-index.json` berukuran di bawah batas 25 MiB upload browser GitHub.
