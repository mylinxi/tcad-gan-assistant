# Core Files Checklist

This folder is a clean GitHub preparation pack for the original local project:

`D:\document\新建文件夹\仿真汇总\仿真Auto计划\tcad-gan-assistant`

## Copy These Into This Folder If You Want a Minimal Repo

- `src\`
- `scripts\check.js`
- `scripts\smoke.js`
- `scripts\ocr_scanned_pdfs.py`
- `package.json`
- `package-lock.json`

Optional:

- `README.md` from the original project if you want the longer Chinese version
- selected architecture notes after cleanup

## Keep Out of the Repo

- `node_modules\`
- `.tcad-assistant\`
- `tcad-gan-assistant-local.vsix`
- `代码资料库\`
- temporary files such as `Untitled-*.md`
- local generated reports and OCR caches

## What Represents the Project Best

If you only want to show the essence of the project on GitHub, the most representative files are:

- `src\indexer.js`
- `src\search.js`
- `src\vector.js`
- `src\requirement.js`
- `src\caseBased.js`
- `src\diagnostics.js`
- `src\prescription.js`
- `src\extension.js`

## Recommended Upload Order

1. Copy the core source files and scripts into this folder.
2. Keep the current `.gitignore`.
3. Review whether any local docs or notes contain sensitive or copyrighted content.
4. Initialize Git and push to GitHub.

## Git Commands

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```
