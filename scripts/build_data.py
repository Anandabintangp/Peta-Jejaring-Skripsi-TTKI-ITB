#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

FACULTY_NAMES = {
    "FITB": "Fakultas Ilmu dan Teknologi Kebumian",
    "FMIPA": "Fakultas Matematika dan Ilmu Pengetahuan Alam",
    "FSRD": "Fakultas Seni Rupa dan Desain",
    "FTI": "Fakultas Teknologi Industri",
    "FTMD": "Fakultas Teknik Mesin dan Dirgantara",
    "FTSL": "Fakultas Teknik Sipil dan Lingkungan",
    "FTTM": "Fakultas Teknik Pertambangan dan Perminyakan",
    "SAPPK": "Sekolah Arsitektur, Perencanaan dan Pengembangan Kebijakan",
    "SBM": "Sekolah Bisnis dan Manajemen",
    "SF": "Sekolah Farmasi",
    "SITH": "Sekolah Ilmu dan Teknologi Hayati",
    "STEI": "Sekolah Teknik Elektro dan Informatika",
}

PROGRAM_OVERRIDES = {
    "data_skripsi_ITB_18_TI": "Teknik Informatika",
    "data_skripsi_ITB_2818_Elektro": "Teknik Elektro",
    "data_skripsi_ITB_7548_STI": "Sistem dan Teknologi Informasi",
    "data_skripsi_ITB_6458_SITH": "SITH (Lainnya)",
    "data_skripsi_ITB_7626_Interior": "Desain Interior",
    "data_skripsi_ITB_7627_DKV": "Desain Komunikasi Visual",
    "data_skripsi_ITB_7677_PWK": "Perencanaan Wilayah dan Kota",
}

STOPWORDS = {
    "yang","dan","dengan","dalam","untuk","pada","dari","terhadap","serta","atau","oleh","sebagai","adalah","ini","itu","suatu","dapat","akan","telah","hasil","penelitian","studi","analisis","metode","menggunakan","berdasarkan","dilakukan","bertujuan","menunjukkan","mengetahui","menentukan","meningkatkan","pengaruh","perancangan","pengembangan","penerapan","evaluasi","pemodelan","sistem","model","data","nilai","proses","kondisi","kasus","indonesia","itb","teknik","tahun","antara","lebih","sehingga","melalui","secara","tersebut","menjadi","memiliki","digunakan","diperoleh","namun","juga","salah","satu","yaitu","terdapat","the","of","and","to","in","for","a","an","is","are","on","by","with","using","study","research","analysis","method","results","result","based","this","that","from","as","at","it","its","can","be","was","were","has","have","had","into","between","among","approach","case","design","development","evaluation","application","implementation","system","model","data","effect","performance","optimal","optimization","experimental","numerical","simulation","technology","based","proposed","obtained","used","use"
}

BROAD_RULES = {
    "Kecerdasan Buatan & Data": ["machine learning","deep learning","artificial intelligence","kecerdasan buatan","neural network","computer vision","natural language","data mining","classification","clustering","prediction","prediksi","big data","analytics","sentiment analysis","recommendation system"],
    "Sistem Informasi & Komputasi": ["sistem informasi","software","perangkat lunak","aplikasi","website","webgis","mobile","database","cybersecurity","keamanan siber","jaringan komputer","internet of things","iot","blockchain","cloud computing","algoritma","information system"],
    "Energi & Kelistrikan": ["energi","energy","listrik","electric","power system","renewable","terbarukan","solar","surya","battery","baterai","hydrogen","hidrogen","geothermal","panas bumi","plts","microgrid","smart grid","fuel cell"],
    "Lingkungan & Keberlanjutan": ["lingkungan","environment","climate change","perubahan iklim","sustainability","keberlanjutan","pollution","pencemaran","waste","limbah","emission","emisi","carbon","karbon","circular economy","daur ulang"],
    "Kebumian, Kelautan & Atmosfer": ["geologi","geology","geofisika","geophysics","oseanografi","ocean","coastal","pesisir","meteorologi","meteorology","remote sensing","penginderaan jauh","pengindraan jauh","earthquake","gempa","volcan","gunung api","geodesi","geodesy","gis","sistem informasi geografis","spatial","spasial","tsunami","atmosfer","cuaca"],
    "Material & Nanoteknologi": ["material","alloy","paduan","composite","komposit","polymer","polimer","nanoparticle","nanopartikel","nanotechnology","nanoteknologi","corrosion","korosi","ceramic","keramik","thin film","coating","metalurgi","metallurgy"],
    "Manufaktur, Operasi & Rantai Pasok": ["manufacturing","manufaktur","production","produksi","supply chain","rantai pasok","inventory","persediaan","logistics","logistik","lean","maintenance","pemeliharaan","operations management","operasional","scheduling","penjadwalan","quality control","ergonomi","ergonomics"],
    "Infrastruktur, Transportasi & Konstruksi": ["civil engineering","struktur","structure","concrete","beton","road","jalan","bridge","jembatan","transport","transportasi","construction","konstruksi","geotechnical","geoteknik","foundation","fondasi","pavement","bangunan"],
    "Air, Hidrologi & Sanitasi": ["water","air bersih","wastewater","air limbah","sanitasi","sanitation","hydrology","hidrologi","drainage","drainase","flood","banjir","watershed","das","groundwater","air tanah"],
    "Kesehatan, Farmasi & Biomedis": ["farmasi","pharmacy","drug","obat","clinical","klinis","health","kesehatan","disease","penyakit","patient","pasien","biomedical","biomedis","medicine","medis","therapeutic","terapi","diagnosis","vaccine","vaksin"],
    "Biologi, Pertanian & Pangan": ["biology","biologi","microbiology","mikrobiologi","agriculture","pertanian","forestry","kehutanan","crop","tanaman","food","pangan","fermentation","fermentasi","enzyme","enzim","bacteria","bakteri","protein","genetic","genetik","biodiversity","keanekaragaman","aquaculture","perikanan"],
    "Bisnis, Manajemen & Kewirausahaan": ["business","bisnis","management","manajemen","marketing","pemasaran","finance","keuangan","entrepreneurship","kewirausahaan","organization","organisasi","consumer","konsumen","strategy","strategi","human resources","sumber daya manusia","tourism","pariwisata","investment","investasi","banking","perbankan"],
    "Desain, Seni & Budaya": ["desain komunikasi","komunikasi visual","visual communication","seni rupa","fine art","interior design","desain interior","product design","desain produk","craft","kriya","museum","budaya visual","visual culture","fashion","tekstil","animation","animasi","illustration","ilustrasi"],
    "Arsitektur, Kota & Wilayah": ["architecture","arsitektur","urban","perkotaan","city","kota","regional planning","perencanaan wilayah","housing","perumahan","land use","tata guna lahan","landscape","lanskap","public space","ruang publik","settlement","permukiman"],
    "Matematika, Fisika & Astronomi": ["mathematics","matematika","physics","fisika","quantum","kuantum","astronomy","astronomi","statistical","statistik","actuarial","aktuaria","differential equation","persamaan diferensial","optics","optik","particle physics"],
    "Pertambangan, Perminyakan & Mineral": ["mining","tambang","pertambangan","petroleum","perminyakan","reservoir","drilling","pengeboran","coal","batubara","mineral processing","pengolahan mineral","oil and gas","migas","wellbore","rock mechanics","mekanika batuan"],
    "Kebijakan, Pendidikan & Sosial": ["policy","kebijakan","governance","tata kelola","community","masyarakat","social","sosial","education","pendidikan","public service","pelayanan publik","participation","partisipasi","behavior","perilaku","communication","komunikasi"],
}

DEFAULT_BROAD_BY_FACULTY = {
    "FITB": "Kebumian, Kelautan & Atmosfer", "FMIPA": "Matematika, Fisika & Astronomi",
    "FSRD": "Desain, Seni & Budaya", "FTI": "Manufaktur, Operasi & Rantai Pasok",
    "FTMD": "Material & Nanoteknologi", "FTSL": "Infrastruktur, Transportasi & Konstruksi",
    "FTTM": "Pertambangan, Perminyakan & Mineral", "SAPPK": "Arsitektur, Kota & Wilayah",
    "SBM": "Bisnis, Manajemen & Kewirausahaan", "SF": "Kesehatan, Farmasi & Biomedis",
    "SITH": "Biologi, Pertanian & Pangan", "STEI": "Sistem Informasi & Komputasi",
}

CREDENTIAL_TOKENS = {
    "prof","profesor","dr","doktor","ir","ing","eng","rer","nat","techn","tech","dipl","geol",
    "st","s","t","mt","m","si","msi","msc","sc","meng","me","ms","mp","ma","mba","phd","ph","d",
    "apt","sp","ot","fics","mars","mse","msee","masc","bsc","ba","psikolog","psi","drs","dra"
}


def clean_ws(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\ufeff", " ")).strip()


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-") or "item"


def derive_program(path: Path) -> str:
    stem = path.stem
    stem = re.sub(r"^\d+\s*", "", stem)
    if stem in PROGRAM_OVERRIDES:
        return PROGRAM_OVERRIDES[stem]
    stem = re.sub(r"^data_skripsi_ITB_", "", stem, flags=re.I)
    stem = re.sub(r"^\d+_", "", stem)
    stem = stem.replace("_EROR", "").replace("_965", "").replace("_", " ")
    stem = clean_ws(stem)
    return {"FISIKA": "Fisika", "TI": "Teknik Industri", "PWK": "Perencanaan Wilayah dan Kota"}.get(stem, stem)


def parse_year(text: str) -> int | None:
    years = re.findall(r"(?:19|20)\d{2}", text or "")
    if not years:
        return None
    year = int(years[-1])
    return year if 1900 <= year <= 2035 else None


def clean_keyword(keyword: str) -> str:
    kw = clean_ws(keyword).strip(" .,:;-–—\"'")
    kw = re.sub(r"^(kata kunci|keywords?)\s*:\s*", "", kw, flags=re.I)
    if not kw or len(kw) < 3 or len(kw) > 90:
        return ""
    if kw.lower() in STOPWORDS:
        return ""
    return kw


def split_keywords(text: str) -> list[str]:
    if not text:
        return []
    text = re.sub(r"\b(kata kunci|keywords?)\s*:\s*", "", text, flags=re.I)
    parts = re.split(r"\s*[;,|]\s*|\n+", text)
    out = []
    seen = set()
    for p in parts:
        p = clean_keyword(p)
        key = p.casefold()
        if p and key not in seen:
            seen.add(key); out.append(p)
    return out[:8]


def split_advisors(text: str) -> list[str]:
    text = (text or "").replace("\r", "\n")
    text = re.sub(r"(?i)scanner\s*:.*?(?=\n|$)", "", text)
    text = re.sub(r"\(?(?:19|20)\d{2}-\d{2}-\d{2}\)?", "", text)
    text = re.sub(r"(?i)\b(?:tim\s+)?pembimbing(?:\s*[ivx\d]+)?\s*:\s*", "\n", text)
    text = re.sub(r"\s+(?:dan|and)\s+", "\n", text, flags=re.I)
    text = text.replace("&", "\n").replace(";", "\n")
    parts = re.split(r"\n+", text)
    out = []
    for part in parts:
        part = clean_ws(part).strip("()[] .,:;-")
        if len(part) < 4 or re.search(r"(?i)scanner|tanggal", part):
            continue
        part = re.sub(r"(?i)^pembimbing\s*\d*\s*", "", part).strip(" :")
        if part and part.casefold() not in {x.casefold() for x in out}:
            out.append(part)
    return out[:4] or ([clean_ws(text)] if clean_ws(text) else [])


def advisor_key(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    tokens = [t for t in s.split() if t not in CREDENTIAL_TOKENS and len(t) > 1]
    return " ".join(tokens) or s.strip()


def broad_topics(text: str, faculty: str) -> list[str]:
    lower = text.casefold()
    scores = []
    for topic, patterns in BROAD_RULES.items():
        score = 0
        for p in patterns:
            n = lower.count(p.casefold())
            if n:
                score += n * (3 if " " in p else 1)
        if score:
            scores.append((score, topic))
    scores.sort(reverse=True)
    selected = [topic for score, topic in scores[:2] if score >= 2]
    return selected or [DEFAULT_BROAD_BY_FACULTY.get(faculty, "Lintas Disiplin")]


def read_records(input_dir: Path) -> list[dict]:
    records = []
    files = []
    for path in input_dir.rglob("*.csv"):
        bn = path.name.lower()
        if "data_skripsi_itb_" in bn and "sbm.csv" not in bn:
            files.append(path)
    for path in sorted(files):
        faculty = path.relative_to(input_dir).parts[0]
        program = derive_program(path)
        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh, delimiter=";")
            for row in reader:
                title = clean_ws(row.get("JUDUL") or row.get("Title") or "")
                if not title:
                    continue
                author = clean_ws(row.get("PENULIS_NIM") or row.get("Author full names") or "")
                advisor_raw = row.get("PEMBIMBING") or ""
                advisors = split_advisors(advisor_raw)
                date_raw = clean_ws(row.get("TAHUN") or row.get("TANGGAL_INPUT") or row.get("Year") or "")
                keywords_raw = clean_ws(row.get("KATA_KUNCI") or row.get("Author Keywords") or "")
                abstract = clean_ws(row.get("ABSTRAK") or row.get("Abstract") or "")
                url = clean_ws(row.get("URL") or "")
                rid = hashlib.sha1((url or title + "|" + author).encode("utf-8")).hexdigest()[:14]
                records.append({
                    "id": rid, "faculty": faculty, "facultyName": FACULTY_NAMES.get(faculty, faculty),
                    "program": program, "title": title, "author": author,
                    "advisorsRaw": clean_ws(advisor_raw), "advisors": advisors,
                    "date": date_raw, "year": parse_year(date_raw), "keywordsRaw": keywords_raw,
                    "keywords": split_keywords(keywords_raw), "abstract": abstract, "url": url,
                })
    # stable de-duplication
    seen = set(); deduped = []
    for r in records:
        key = r["url"].casefold() if r["url"] else re.sub(r"\W+", "", (r["title"] + r["author"]).casefold())
        if key in seen:
            continue
        seen.add(key); deduped.append(r)
    return deduped


def infer_medium_topics(records: list[dict]) -> list[list[str]]:
    docs = []
    for r in records:
        docs.append(" ".join([r["title"], r["keywordsRaw"], r["abstract"][:1800]]))
    vectorizer = TfidfVectorizer(
        lowercase=True, strip_accents="unicode", stop_words=list(STOPWORDS),
        ngram_range=(1, 2), min_df=12, max_df=0.45, max_features=9000,
        token_pattern=r"(?u)\b[a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9\-]{2,}\b",
        sublinear_tf=True,
    )
    matrix = vectorizer.fit_transform(docs)
    terms = np.asarray(vectorizer.get_feature_names_out())
    inferred: list[list[str]] = []
    for i in range(matrix.shape[0]):
        row = matrix.getrow(i)
        if row.nnz == 0:
            inferred.append([]); continue
        top_pos = row.data.argsort()[-8:][::-1]
        candidates = []
        for pos in top_pos:
            term = str(terms[row.indices[pos]]).strip()
            if term in STOPWORDS or len(term) < 4:
                continue
            # prefer meaningful phrases; keep useful single terms too
            if term not in candidates:
                candidates.append(term)
            if len(candidates) >= 4:
                break
        inferred.append(candidates)
    return inferred


def choose_display(variants: Counter) -> str:
    if not variants:
        return "Tidak diketahui"
    # Most frequent, then a reasonably concise variant.
    return sorted(variants.items(), key=lambda kv: (-kv[1], len(kv[0])))[0][0]


def build(input_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "data" / "records").mkdir(parents=True, exist_ok=True)
    records = read_records(input_dir)
    inferred = infer_medium_topics(records)

    advisor_variants: dict[str, Counter] = defaultdict(Counter)
    for r in records:
        normalized = []
        for adv in r["advisors"]:
            key = advisor_key(adv)
            if not key:
                continue
            advisor_variants[key][adv] += 1
            normalized.append(key)
        r["advisorKeys"] = list(dict.fromkeys(normalized))

    advisor_display = {k: choose_display(v) for k, v in advisor_variants.items()}

    for r, medium in zip(records, inferred):
        combined_text = " ".join([r["title"], r["keywordsRaw"], r["abstract"][:2500]])
        r["topics"] = {
            "broad": broad_topics(combined_text, r["faculty"]),
            "medium": medium[:4],
            "specific": (r["keywords"][:5] or medium[:5]),
        }

    program_records: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        pkey = f'{r["faculty"]}::{r["program"]}'
        program_records[pkey].append(r)

    program_files = {}
    search_index = []
    program_summaries = []
    faculty_counts = Counter(r["faculty"] for r in records)
    advisor_counts = Counter()
    advisor_program_counts: dict[tuple[str, str], int] = Counter()
    global_topics = {"broad": Counter(), "medium": Counter(), "specific": Counter()}

    for pkey, recs in sorted(program_records.items()):
        faculty, program = pkey.split("::", 1)
        fname = f"{slugify(faculty + '-' + program)}.json"
        program_files[pkey] = f"data/records/{fname}"
        topic_counts = {level: Counter() for level in ("broad", "medium", "specific")}
        advisor_local = Counter()
        years = Counter()
        full_records = []
        for r in recs:
            for key in r["advisorKeys"]:
                advisor_counts[key] += 1; advisor_local[key] += 1; advisor_program_counts[(key, pkey)] += 1
            for level, topics in r["topics"].items():
                for topic in topics:
                    topic_counts[level][topic] += 1; global_topics[level][topic] += 1
            if r["year"]:
                years[str(r["year"])] += 1
            full_records.append({
                "id": r["id"], "title": r["title"], "author": r["author"],
                "advisors": [advisor_display.get(k, k) for k in r["advisorKeys"]],
                "date": r["date"], "year": r["year"], "keywords": r["keywords"],
                "abstract": r["abstract"], "url": r["url"], "faculty": faculty,
                "facultyName": FACULTY_NAMES.get(faculty, faculty), "program": program,
                "topics": r["topics"],
            })
            search_index.append({
                "id": r["id"], "title": r["title"], "author": r["author"],
                "advisorKeys": r["advisorKeys"], "advisors": [advisor_display.get(k, k) for k in r["advisorKeys"]],
                "year": r["year"], "faculty": faculty, "program": program,
                "topics": r["topics"], "keywords": r["keywords"][:5], "url": r["url"], "pkey": pkey,
            })
        full_records.sort(key=lambda x: ((x["year"] or 0), x["title"]), reverse=True)
        with (output_dir / "data" / "records" / fname).open("w", encoding="utf-8") as fh:
            json.dump(full_records, fh, ensure_ascii=False, separators=(",", ":"))
        program_summaries.append({
            "key": pkey, "faculty": faculty, "facultyName": FACULTY_NAMES.get(faculty, faculty),
            "name": program, "count": len(recs), "file": program_files[pkey],
            "years": dict(sorted(years.items())),
            "advisors": [{"key": k, "name": advisor_display.get(k, k), "count": c} for k, c in advisor_local.most_common(60)],
            "topics": {level: [{"name": t, "count": c} for t, c in topic_counts[level].most_common(80)] for level in topic_counts},
        })

    faculties = []
    for code in sorted(faculty_counts):
        faculties.append({
            "code": code, "name": FACULTY_NAMES.get(code, code), "count": faculty_counts[code],
            "programs": [p["key"] for p in program_summaries if p["faculty"] == code],
        })

    advisors = [{"key": k, "name": advisor_display.get(k, k), "count": c} for k, c in advisor_counts.most_common()]
    advisor_edges = [
        {"advisor": k, "program": pkey, "count": c}
        for (k, pkey), c in advisor_program_counts.items() if c >= 2
    ]

    topic_catalog = {
        "broad": [{"name": t, "count": c} for t, c in global_topics["broad"].most_common()],
        "medium": [{"name": t, "count": c} for t, c in global_topics["medium"].most_common(800)],
        "specific": [{"name": t, "count": c} for t, c in global_topics["specific"].most_common(1400)],
    }
    years_all = Counter(str(r["year"]) for r in records if r["year"])
    summary = {
        "generatedFrom": "SKRIPSI ITB.zip", "recordCount": len(records),
        "facultyCount": len(faculties), "programCount": len(program_summaries),
        "advisorCount": len(advisors), "facultyNames": FACULTY_NAMES,
        "faculties": faculties, "programs": program_summaries, "advisors": advisors,
        "advisorProgramEdges": advisor_edges, "topics": topic_catalog,
        "years": dict(sorted(years_all.items())),
    }
    with (output_dir / "data" / "summary.json").open("w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, separators=(",", ":"))
    with (output_dir / "data" / "search-index.json").open("w", encoding="utf-8") as fh:
        json.dump(search_index, fh, ensure_ascii=False, separators=(",", ":"))

    print(json.dumps({
        "records": len(records), "faculties": len(faculties), "programs": len(program_summaries),
        "advisors": len(advisors), "summaryMB": round((output_dir / 'data/summary.json').stat().st_size / 1e6, 2),
        "indexMB": round((output_dir / 'data/search-index.json').stat().st_size / 1e6, 2),
    }, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build static data files for the ITB thesis network website.")
    parser.add_argument("--input", required=True, type=Path, help="Directory containing extracted faculty CSV folders")
    parser.add_argument("--output", required=True, type=Path, help="Website project output directory")
    args = parser.parse_args()
    build(args.input, args.output)

if __name__ == "__main__":
    main()
