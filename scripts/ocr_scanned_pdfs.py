#!/usr/bin/env python3
"""
对大体积扫描 PDF 做 OCR，输出可被索引器读取的 .txt 文件。

默认处理以下 3 个文件（位于 workspace/代码资料库）：
1_Sentaurus  TCAD操作与仿真入门资料 一.pdf
2_Sentaurus  TCAD操作与仿真入门资料.pdf
3_Sentaurus TCAD操作与仿真入门资料.pdf
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List

try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover
    print(
        "[OCR] 未安装 PyMuPDF。请先执行: python -m pip install pymupdf\n"
        f"详细错误: {exc}",
        file=sys.stderr,
    )
    sys.exit(2)


DEFAULT_PDFS = [
    "1_Sentaurus  TCAD操作与仿真入门资料 一.pdf",
    "2_Sentaurus  TCAD操作与仿真入门资料.pdf",
    "3_Sentaurus TCAD操作与仿真入门资料.pdf",
]

CHI_SIM_URL = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/chi_sim.traineddata"


@dataclass
class OcrTaskResult:
    pdf: str
    output_txt: str
    output_meta: str
    page_count_total: int
    page_count_done: int
    failed_pages: List[int]
    lang: str
    duration_sec: float


def find_tesseract(explicit: str | None) -> str:
    candidates = [
        explicit,
        shutil.which("tesseract"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for c in candidates:
        if c and Path(c).exists():
            return str(c)
    raise FileNotFoundError("未找到 tesseract.exe。请先安装 Tesseract OCR。")


def run_cmd(args: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="ignore")


def list_tess_langs(tesseract_exe: str, tessdata_dir: str | None = None) -> List[str]:
    cmd = [tesseract_exe]
    if tessdata_dir:
        cmd += ["--tessdata-dir", tessdata_dir]
    cmd += ["--list-langs"]
    cp = run_cmd(cmd)
    if cp.returncode != 0:
        return []
    lines = [ln.strip() for ln in cp.stdout.splitlines() if ln.strip()]
    langs = [ln for ln in lines if ln.lower() not in {"list of available languages in \"c:\" (0):"} and "list of available languages" not in ln.lower()]
    return langs


def ensure_chi_sim(tessdata_dir: Path) -> Path:
    tessdata_dir.mkdir(parents=True, exist_ok=True)
    target = tessdata_dir / "chi_sim.traineddata"
    if target.exists() and target.stat().st_size > 1_000_000:
        return target
    print(f"[OCR] 下载 chi_sim.traineddata -> {target}")
    urllib.request.urlretrieve(CHI_SIM_URL, target)
    return target


def choose_lang(tesseract_exe: str, tessdata_dir: str | None, prefer_chi: bool) -> str:
    langs = set(list_tess_langs(tesseract_exe, tessdata_dir))
    if prefer_chi and "chi_sim" in langs and "eng" in langs:
        return "chi_sim+eng"
    if prefer_chi and "chi_sim" in langs:
        return "chi_sim"
    if "eng" in langs:
        return "eng"
    return "osd"


def ocr_image_to_text(tesseract_exe: str, image_path: Path, lang: str, tessdata_dir: str | None, psm: int) -> str:
    cmd = [tesseract_exe, str(image_path), "stdout", "-l", lang, "--oem", "1", "--psm", str(psm)]
    if tessdata_dir:
        cmd += ["--tessdata-dir", tessdata_dir]
    cp = run_cmd(cmd)
    if cp.returncode != 0:
        raise RuntimeError(cp.stderr.strip() or "tesseract 识别失败")
    return cp.stdout


def sanitize_name(name: str) -> str:
    bad = '<>:"/\\|?*\n\r\t'
    out = name
    for ch in bad:
        out = out.replace(ch, "_")
    return out.strip(" .")


def process_pdf(
    pdf_path: Path,
    output_dir: Path,
    tesseract_exe: str,
    tessdata_dir: str | None,
    lang: str,
    dpi: int,
    psm: int,
    max_pages: int | None,
) -> OcrTaskResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = sanitize_name(pdf_path.stem)
    out_txt = output_dir / f"{stem}.ocr.txt"
    out_meta = output_dir / f"{stem}.ocr.meta.json"

    t0 = time.time()
    doc = fitz.open(pdf_path)
    total_pages = doc.page_count
    page_limit = min(total_pages, max_pages) if max_pages and max_pages > 0 else total_pages
    matrix = fitz.Matrix(dpi / 72.0, dpi / 72.0)

    failed: List[int] = []
    parts: List[str] = []

    print(f"[OCR] 开始: {pdf_path.name} | pages={total_pages} | do={page_limit} | lang={lang}")

    with tempfile.TemporaryDirectory(prefix="ocr_pdf_") as td:
        td_path = Path(td)
        for i in range(page_limit):
            page_no = i + 1
            try:
                page = doc.load_page(i)
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                img_path = td_path / f"p{page_no:05d}.png"
                pix.save(img_path)

                text = ocr_image_to_text(
                    tesseract_exe=tesseract_exe,
                    image_path=img_path,
                    lang=lang,
                    tessdata_dir=tessdata_dir,
                    psm=psm,
                )
                parts.append(f"\n\n===== PAGE {page_no}/{total_pages} =====\n{text.strip()}\n")
            except Exception as exc:
                failed.append(page_no)
                parts.append(f"\n\n===== PAGE {page_no}/{total_pages} =====\n[OCR_FAILED] {exc}\n")

            if page_no % 10 == 0 or page_no == page_limit:
                print(f"[OCR] {pdf_path.name}: {page_no}/{page_limit}")

    out_txt.write_text("".join(parts), encoding="utf-8", errors="ignore")

    meta = {
        "source_pdf": str(pdf_path),
        "output_txt": str(out_txt),
        "lang": lang,
        "dpi": dpi,
        "psm": psm,
        "total_pages": total_pages,
        "processed_pages": page_limit,
        "failed_pages": failed,
        "failed_count": len(failed),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    out_meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    dt = time.time() - t0
    print(
        f"[OCR] 完成: {pdf_path.name} -> {out_txt.name} | failed={len(failed)} | {dt:.1f}s"
    )

    return OcrTaskResult(
        pdf=str(pdf_path),
        output_txt=str(out_txt),
        output_meta=str(out_meta),
        page_count_total=total_pages,
        page_count_done=page_limit,
        failed_pages=failed,
        lang=lang,
        duration_sec=dt,
    )


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="OCR scanned PDFs for TCAD assistant")
    p.add_argument("--workspace", default=".", help="workspace 根目录（默认: 当前仓库根目录）")
    p.add_argument("--docs-root", default="代码资料库", help="资料库目录（相对 workspace）")
    p.add_argument("--pdf", action="append", dest="pdfs", help="指定要处理的 pdf（可重复）")
    p.add_argument("--out-dir", default="代码资料库/OCR文本", help="OCR 文本输出目录（相对 workspace）")
    p.add_argument("--tesseract", default=None, help="tesseract.exe 路径")
    p.add_argument("--tessdata-dir", default=".tcad-assistant/tessdata", help="tessdata 目录（相对 workspace）")
    p.add_argument("--download-chi-sim", action="store_true", help="若缺少 chi_sim 则自动下载")
    p.add_argument("--dpi", type=int, default=220, help="渲染 DPI，默认 220")
    p.add_argument("--psm", type=int, default=6, help="tesseract PSM，默认 6")
    p.add_argument("--max-pages", type=int, default=0, help="每个 PDF 最大处理页数，0 表示全量")
    p.add_argument("--report", default=".tcad-assistant/ocr-report.json", help="报告输出（相对 workspace）")
    return p


def main() -> int:
    args = build_arg_parser().parse_args()

    workspace = Path(args.workspace).resolve()
    docs_root = (workspace / args.docs_root).resolve()
    out_dir = (workspace / args.out_dir).resolve()
    tessdata_dir = (workspace / args.tessdata_dir).resolve()
    report_path = (workspace / args.report).resolve()

    if not docs_root.exists():
        print(f"[OCR] docsRoot 不存在: {docs_root}", file=sys.stderr)
        return 2

    tesseract_exe = find_tesseract(args.tesseract)

    if args.download_chi_sim:
        ensure_chi_sim(tessdata_dir)

    tessdata_str = str(tessdata_dir) if tessdata_dir.exists() else None
    lang = choose_lang(tesseract_exe, tessdata_str, prefer_chi=True)

    selected = args.pdfs or DEFAULT_PDFS
    pdf_paths = [(docs_root / rel).resolve() for rel in selected]

    for p in pdf_paths:
        if not p.exists():
            print(f"[OCR] 跳过（不存在）: {p}", file=sys.stderr)

    existing = [p for p in pdf_paths if p.exists()]
    if not existing:
        print("[OCR] 没有可处理的 PDF。", file=sys.stderr)
        return 1

    results: List[OcrTaskResult] = []
    t0 = time.time()
    for pdf in existing:
        res = process_pdf(
            pdf_path=pdf,
            output_dir=out_dir,
            tesseract_exe=tesseract_exe,
            tessdata_dir=tessdata_str,
            lang=lang,
            dpi=max(120, args.dpi),
            psm=max(3, args.psm),
            max_pages=(args.max_pages if args.max_pages and args.max_pages > 0 else None),
        )
        results.append(res)

    total_sec = time.time() - t0
    report = {
        "workspace": str(workspace),
        "docs_root": str(docs_root),
        "out_dir": str(out_dir),
        "tesseract": tesseract_exe,
        "tessdata_dir": tessdata_str,
        "lang": lang,
        "count": len(results),
        "total_duration_sec": round(total_sec, 2),
        "items": [
            {
                "pdf": r.pdf,
                "output_txt": r.output_txt,
                "output_meta": r.output_meta,
                "page_count_total": r.page_count_total,
                "page_count_done": r.page_count_done,
                "failed_pages": r.failed_pages,
                "lang": r.lang,
                "duration_sec": round(r.duration_sec, 2),
            }
            for r in results
        ],
    }

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OCR] 报告: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
