# Peta Jejaring Skripsi ITB

Web statis interaktif untuk mengeksplorasi hubungan antara:

- fakultas/sekolah;
- jurusan/program studi;
- dosen pembimbing;
- topik umum, menengah, dan spesifik;
- judul, penulis, kata kunci, abstrak, dan tautan sumber skripsi.

## Fitur utama

- Peta jejaring berbasis D3.js.
- Filter fakultas, jurusan, topik, dan tahun.
- Slider tingkat kekhususan topik:
  - **Umum**: klasifikasi rumpun besar lintas disiplin.
  - **Menengah**: istilah hasil TF-IDF dari judul, kata kunci, dan abstrak.
  - **Spesifik**: kata kunci rinci dari metadata skripsi.
- Pencarian judul, penulis, pembimbing, dan kata kunci.
- Modal abstrak lengkap dan tautan ke sumber Digilib.
- Ekspor hasil filter ke CSV.
- Tema terang/gelap dan tata letak responsif.

## Deploy ke GitHub Pages

1. Buat repository baru di GitHub.
2. Unggah **seluruh isi folder ini** ke root repository. Pastikan `index.html`, `app.js`, `styles.css`, dan folder `data/` berada di root.
3. Buka **Settings → Pages**.
4. Pada **Build and deployment**, pilih **Deploy from a branch**.
5. Pilih branch `main` dan folder `/ (root)`, lalu klik **Save**.
6. Tunggu GitHub menampilkan alamat situs Pages.

> Jangan membuka `index.html` langsung dengan skema `file://`, karena browser akan memblokir pemuatan JSON. Gunakan GitHub Pages atau server lokal.

## Menjalankan secara lokal

Dari folder proyek:

```bash
python -m http.server 8000
```

Lalu buka `http://localhost:8000`.

## Membangun ulang data

Skrip pemrosesan tersedia di `scripts/build_data.py`.

```bash
pip install numpy scikit-learn
python scripts/build_data.py --input "/lokasi/folder/SKRIPSI ITB" --output "."
```

Folder input harus berisi subfolder fakultas seperti `FITB`, `FMIPA`, `FTI`, dan seterusnya, dengan CSV sumber di dalamnya.

## Struktur proyek

```text
.
├── index.html
├── app.js
├── styles.css
├── data/
│   ├── summary.json
│   ├── search-index.json
│   └── records/
│       └── *.json
└── scripts/
    └── build_data.py
```

## Catatan metodologis

Pemisahan nama pembimbing dan klasifikasi topik dilakukan secara otomatis dari metadata. Variasi penulisan gelar/nama dan kualitas kata kunci sumber dapat menyebabkan sebagian node belum sepenuhnya terstandardisasi. Situs ini ditujukan untuk eksplorasi, bukan sebagai sumber bibliografi resmi.
