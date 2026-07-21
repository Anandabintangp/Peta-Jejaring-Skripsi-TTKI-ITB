#!/usr/bin/env python3
"""Memperbaiki judul hasil scraping yang kehilangan spasi.

Skrip menggunakan kosakata global dari abstrak dan frasa lokal dari abstrak
setiap skripsi. ID dan metadata lain tidak diubah.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path

WORD_RE = re.compile(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{0,34}")
ALPHA_RUN_RE = re.compile(r"[A-Za-zÀ-ÿ]+")

EXTRA_WORDS = set("""
a i m x y z d ai ip ui ux tod lab mal blok first resources resource cigarette cigarettes ash glaze
transit oriented hub intellectual property sense place berbasis sebagai pada dalam dan dengan dari untuk
oleh terhadap studi kasus desain interior karakter jakarta optimalisasi kantor riset pengembangan kultur
jaringan kelapa sawit pendekatan ergonomi teknologi modern pemanfaatan material limbah abu rokok glasir
aksesoris keramik kontemporer revitalisasi implementasi co kriging inverse distance weight upper red bed
tiga dimensi jawa barat timur tengah sumatra sulawesi tenggara maluku utara kalimantan selatan
""".split())

JOINED_REPLACEMENTS = {
    "JAWABARAT": "JAWA BARAT",
    "JAWATIMUR": "JAWA TIMUR",
    "JAWATENGAH": "JAWA TENGAH",
    "SUMATRAUTARA": "SUMATRA UTARA",
    "SUMATRASELATAN": "SUMATRA SELATAN",
    "SUMATRATENGAH": "SUMATRA TENGAH",
    "SULAWESIUTARA": "SULAWESI UTARA",
    "SULAWESISELATAN": "SULAWESI SELATAN",
    "SULAWESITENGAH": "SULAWESI TENGAH",
    "SULAWESITENGGARA": "SULAWESI TENGGARA",
    "KALIMANTANUTARA": "KALIMANTAN UTARA",
    "KALIMANTANSELATAN": "KALIMANTAN SELATAN",
    "KALIMANTANTENGAH": "KALIMANTAN TENGAH",
    "KALIMANTANTIMUR": "KALIMANTAN TIMUR",
    "MALUKUUTARA": "MALUKU UTARA",
    "SUMBERDAYA": "SUMBER DAYA",
    "AIR TANAH": "AIR TANAH",
}


def tokens(text: str) -> list[str]:
    return [m.group(0).strip("-'").lower() for m in WORD_RE.finditer(text or "") if m.group(0).strip("-'")]


def build_global_frequency(record_files: list[Path]) -> Counter:
    frequency: Counter = Counter()
    for path in record_files:
        records = json.loads(path.read_text(encoding="utf-8"))
        for record in records:
            texts = [
                record.get("abstract", ""),
                " ".join(record.get("keywords", [])),
                record.get("program", ""),
            ]
            title = record.get("title", "")
            if " " in title:
                texts.append(title)
            for text in texts:
                frequency.update(tokens(text))
    return frequency


def local_vocabulary(record: dict) -> tuple[Counter, dict[str, str]]:
    text = " ".join([
        record.get("abstract", ""),
        " ".join(record.get("keywords", [])),
        record.get("program", ""),
    ])
    local_tokens = tokens(text)
    counter = Counter(local_tokens)
    phrases: dict[str, str] = {}
    for size in range(2, 6):
        for index in range(len(local_tokens) - size + 1):
            chunk = local_tokens[index:index + size]
            key = "".join(chunk)
            if 6 <= len(key) <= 40:
                phrases[key] = " ".join(chunk)
    return counter, phrases


def segment_run(run: str, global_frequency: Counter, local_frequency: Counter, local_phrases: dict[str, str]) -> list[str]:
    source = run.lower()
    length = len(source)
    score = [-10**18] * (length + 1)
    previous: list[tuple[int, str] | None] = [None] * (length + 1)
    score[0] = 0.0

    for start in range(length):
        if score[start] <= -10**17:
            continue

        for size in range(6, min(40, length - start) + 1):
            key = source[start:start + size]
            phrase = local_phrases.get(key)
            if phrase:
                words = phrase.count(" ") + 1
                candidate = score[start] + 4.0 + 0.75 * size + 1.2 * words
                if candidate > score[start + size]:
                    score[start + size] = candidate
                    previous[start + size] = (start, phrase)

        for size in range(2, min(35, length - start) + 1):
            word = source[start:start + size]
            global_count = global_frequency.get(word, 0)
            local_count = local_frequency.get(word, 0)
            known = local_count > 0 or global_count >= 3 or word in EXTRA_WORDS
            if not known:
                continue
            effective_count = global_count + local_count * 5000 + (500 if word in EXTRA_WORDS else 0)
            candidate = score[start] + math.log(effective_count + 1) + 0.62 * size - 9.2
            if local_count:
                candidate += 1.5
            if size == 2 and effective_count < 100:
                candidate -= 4
            if candidate > score[start + size]:
                score[start + size] = candidate
                previous[start + size] = (start, word)

        one = source[start:start + 1]
        if one in {"a", "i", "m", "x", "y", "z", "d"}:
            candidate = score[start] - 10
            if candidate > score[start + 1]:
                score[start + 1] = candidate
                previous[start + 1] = (start, one)

        for size in range(2, min(16, length - start) + 1):
            unknown = source[start:start + size]
            candidate = score[start] - 20 - 1.35 * size
            if candidate > score[start + size]:
                score[start + size] = candidate
                previous[start + size] = (start, unknown)

    result: list[str] = []
    cursor = length
    while cursor > 0:
        step = previous[cursor]
        if step is None:
            return [run]
        start, word = step
        result.append(word)
        cursor = start
    return list(reversed(result))


def repair_title(record: dict, global_frequency: Counter) -> str:
    title = record.get("title", "")
    longest_run = max((len(run) for run in ALPHA_RUN_RE.findall(title)), default=0)
    if longest_run < 18:
        return title

    local_frequency, local_phrases = local_vocabulary(record)
    output: list[str] = []
    cursor = 0
    for match in ALPHA_RUN_RE.finditer(title):
        output.append(title[cursor:match.start()])
        run = match.group(0)
        if len(run) >= 10 and (run.upper() == run or title.count(" ") < 3):
            segmented = " ".join(segment_run(run, global_frequency, local_frequency, local_phrases))
            output.append(segmented.upper() if run.upper() == run else segmented)
        else:
            output.append(run)
        cursor = match.end()
    output.append(title[cursor:])

    repaired = "".join(output)
    for joined, spaced in JOINED_REPLACEMENTS.items():
        repaired = repaired.replace(joined, spaced)
    repaired = re.sub(r"\s*:\s*", ": ", repaired)
    repaired = re.sub(r"\s*,\s*", ", ", repaired)
    repaired = re.sub(r"\s*;\s*", "; ", repaired)
    repaired = re.sub(r"\s*\(\s*", " (", repaired)
    repaired = re.sub(r"\s*\)\s*", ") ", repaired)
    repaired = re.sub(r"\s*-\s*", "-", repaired)
    repaired = re.sub(r"\b(GEOLOGI|PEMODELAN|MODEL|STATIS|VISUALISASI)\s*3D\b", r"\1 3D", repaired)
    repaired = re.sub(r"\b3D\s*(DAN|DENGAN|UNTUK|PADA)\b", r"3D \1", repaired)
    repaired = re.sub(r"(?<=\d)(?=(PADA|DAN|DENGAN|UNTUK|DI)\b)", " ", repaired)
    repaired = re.sub(r"\s+", " ", repaired).strip()
    return repaired


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("site_dir", type=Path, nargs="?", default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()

    site_dir = args.site_dir.resolve()
    record_files = sorted((site_dir / "data" / "records").glob("*.json"))
    global_frequency = build_global_frequency(record_files)
    title_by_id: dict[str, str] = {}
    changed = 0

    for path in record_files:
        records = json.loads(path.read_text(encoding="utf-8"))
        file_changed = False
        for record in records:
            original = record.get("title", "")
            repaired = repair_title(record, global_frequency)
            title_by_id[record["id"]] = repaired
            if repaired != original:
                record["title"] = repaired
                changed += 1
                file_changed = True
        if file_changed:
            path.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    index_path = site_dir / "data" / "search-index.json"
    index_records = json.loads(index_path.read_text(encoding="utf-8"))
    for record in index_records:
        record["title"] = title_by_id.get(record["id"], record.get("title", ""))
    index_path.write_text(json.dumps(index_records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Judul diperbaiki: {changed}")
    print(f"Ukuran search-index.json: {index_path.stat().st_size:,} byte")


if __name__ == "__main__":
    main()
