# TCAD GaN Assistant

[中文说明](./README.md)

TCAD GaN Assistant is a local-first VSCode assistant for Sentaurus TCAD workflows, with a strong focus on GaN HEMT modeling, knowledge retrieval, template generation, log diagnosis, and convergence tuning.

The goal is to turn manuals, official examples, OCR text, and engineering notes into a practical local RAG workflow for daily TCAD work. Instead of behaving like a general chat interface, the project is organized around real Sentaurus tasks such as SDE structure setup, SProcess recipe editing, SDevice solver configuration, and debugging convergence issues.

## Highlights

- Local knowledge indexing for `PDF`, `HTML`, `TXT`, `CMD`, `TCL`, `PAR`, and `PRF` sources
- `lexical`, `vector`, and `hybrid` retrieval with evidence snippets
- Evidence-aware ranking with source quality and noise penalties
- Requirement-driven generation through `RequirementCard`
- Similar-case retrieval and slot-based adaptation
- Rule-based diagnosis for common Sentaurus failures
- Step-by-step convergence plans with rollback guidance
- OCR support for large scanned PDF documents

## Workflow

```text
Local documents and examples
  -> parsing and chunking
  -> tagging and quality scoring
  -> lexical / vector / hybrid retrieval
  -> RequirementCard + similar case retrieval + template filling
  -> log diagnosis + convergence plan + markdown report
```

## VSCode Commands

- `TCAD: 构建/重建知识索引`
- `TCAD: 查看索引处理状态`
- `TCAD: 检索手册与实例`
- `TCAD: 按建模需求生成（RequirementCard）`
- `TCAD: 一键插入 GaN 模板`
- `TCAD: 日志报错诊断`
- `TCAD: 收敛性处方建议`

## Repository Structure

```text
tcad-gan-assistant-github/
  README.md
  README_EN.md
  .gitignore
  package.json
  package-lock.json
  src/
    extension.js
    config.js
    indexer.js
    search.js
    vector.js
    requirement.js
    caseBased.js
    templates.js
    diagnostics.js
    prescription.js
    utils.js
  scripts/
    check.js
    smoke.js
    ocr_scanned_pdfs.py
```

## Key Modules

- `src/extension.js`: VSCode command entry and workflow orchestration
- `src/indexer.js`: parsing, chunking, tagging, scoring, and index generation
- `src/search.js`: lexical, vector, and hybrid retrieval
- `src/vector.js`: lightweight local vectorization based on hashing + TF + L2 normalization
- `src/requirement.js`: `RequirementCard` creation and template recommendation
- `src/caseBased.js`: similar-case retrieval, evidence selection, and adaptation
- `src/diagnostics.js`: rule-based failure detection and patch suggestions
- `src/prescription.js`: convergence experiment planning

## Retrieval and Generation Strategy

- The indexing stage handles chunking, tagging, source-type inference, and quality scoring.
- The vector search implementation is lightweight and fully local, based on hashing, term frequency, and L2 normalization.
- In `hybrid` mode, lexical and vector scores are merged and then adjusted using `sourceQuality` and `noisePenalty`.
- The generation flow first retrieves similar cases and then adapts templates using requirement slots and parameter mappings.

## Typical Use Cases

- Build a searchable local knowledge base for Sentaurus manuals, official examples, and personal notes.
- Find syntax carriers and reference decks for `SDE`, `SProcess`, and `SDevice`.
- Generate starter templates for `IdVg`, `IdVd`, `BV`, `Switching`, and `SelfHeating` tasks.
- Diagnose convergence failures from `_des.log` and `_des.out`.
- Convert scanned PDF material into searchable text for the knowledge base.

## Configuration

Key VSCode settings under `tcadAssistant`:

- `docsRoot`
- `indexPath`
- `statusPath`
- `vectorIndexPath`
- `retrievalMode`
- `hybridWeight`
- `vectorDims`
- `maxChunkChars`
- `chunkOverlapChars`
- `maxFileSizeMB`
- `maxIndexedFiles`

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Run a basic check

```bash
npm run check
```

3. Create a local `代码资料库/` directory if you want to build the knowledge index immediately.

4. Open the project in VSCode and press `F5` to launch the extension host.

5. Run the following commands from the command palette:

```text
TCAD: 构建/重建知识索引
TCAD: 检索手册与实例
TCAD: 按建模需求生成（RequirementCard）
```

## Development and Validation

- `npm run check`: file presence and syntax validation
- `npm run smoke`: end-to-end smoke validation when `代码资料库/` is available
- `npm run ocr:scanned`: OCR pipeline for scanned PDFs

## Current Scope

- The current version focuses on local retrieval, template generation, and rule-based diagnosis.
- It does not automatically execute Sentaurus simulation runs.
- The repository ships the extension source and helper scripts, while the local knowledge base is mounted from the workspace as needed.
