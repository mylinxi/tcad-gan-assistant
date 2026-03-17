# TCAD GaN Assistant

[中文说明](./README.md)

TCAD GaN Assistant is a local-first VSCode assistant for Sentaurus TCAD workflows, with a focus on GaN HEMT modeling, knowledge retrieval, template generation, log diagnosis, and convergence tuning.

The project is designed for practical engineering use. Instead of acting like a generic chatbot, it turns local manuals, official examples, OCR text, and personal notes into a searchable and reusable assistant for TCAD work.

## Core Capabilities

- Local knowledge indexing for `PDF`, `HTML`, `TXT`, `CMD`, `TCL`, `PAR`, and `PRF` sources
- `lexical`, `vector`, and `hybrid` retrieval with evidence snippets
- Requirement-driven generation through `RequirementCard`
- Similar-case retrieval and slot-based adaptation
- Rule-based diagnosis for common Sentaurus failures
- Step-by-step convergence plans with rollback guidance

## Why the Repository Does Not Include Everything

This repository contains the core code, not every local asset from the original workspace.

The following items are intentionally excluded:

- `代码资料库/`: local manuals, examples, and private notes may involve copyright or privacy issues
- `.tcad-assistant/`: generated indexes, vector indexes, OCR cache, and status reports
- `node_modules/`: installed dependencies
- `*.vsix`: local packaging artifacts
- temporary drafts and intermediate reports

So the project is not “only these files”. What you see here is the clean open-source core of the original local project.

## Workflow

```text
Local documents and examples
  -> parsing and chunking
  -> tagging and quality scoring
  -> lexical / vector / hybrid retrieval
  -> RequirementCard + similar case retrieval + template filling
  -> log diagnosis + convergence plan + markdown report
```

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

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Run a basic check

```bash
npm run check
```

3. Open the project in VSCode and press `F5` to launch the extension host.

## Notes

- The default local knowledge directory is `代码资料库/` under the repository root.
- You can publish the source code first and add public sample documents later if needed.
