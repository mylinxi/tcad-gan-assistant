const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const {
  ensureDirForFile,
  walkFiles,
  normalizeText,
  cleanupOcrText,
  calcTextNoiseScore,
  stripHtml,
  chunkText,
  tokenize,
  makeTermFreq,
  topTerms,
  relPath,
} = require("./utils");
const {
  buildVectorIndexFromKnowledgeIndex,
  saveVectorIndex,
} = require("./vector");

const SUPPORTED_EXT = [".pdf", ".html", ".htm", ".txt", ".md", ".cmd", ".tcl", ".par", ".prf", ".rst"];

function inferTags(filePath, text) {
  const p = filePath.toLowerCase();
  const t = (text || "").toLowerCase();
  const tags = new Set();

  if (/gan|algan|p-gan|hemt|hfet/.test(p + " " + t)) tags.add("material:GaN");
  if (/sde|structure editor/.test(p + " " + t)) tags.add("stage:SDE");
  if (/sprocess|process simulation|iiiv\.epi/.test(p + " " + t)) tags.add("stage:SProcess");
  if (/sdevice|physics\s*\(|math\s*\{|solve\s*\{/.test(p + " " + t)) tags.add("stage:SDevice");
  if (/mesh|refinebox|grid remesh/.test(p + " " + t)) tags.add("stage:SMesh");
  if (/conver|收敛|rhs|errref|extendedprecision|gmres|ils/.test(p + " " + t)) tags.add("topic:Convergence");
  if (/breakdown|avalanche|bv/.test(p + " " + t)) tags.add("topic:Breakdown");
  if (/idvg|idvd|threshold|on-state|dynamic resistance/.test(p + " " + t)) tags.add("topic:IV");
  if (/workbench|swbpy2|swb/.test(p + " " + t)) tags.add("tool:SWB");
  if (/api|reference|documentation/.test(p + " " + t)) tags.add("type:Reference");
  if (/greadme|example|applications_library/.test(p + " " + t)) tags.add("type:Example");
  if (/节选|ocr|扫描|收敛性/.test(p + " " + t)) tags.add("type:UserNotes");
  if (/\/ocr文本\//.test(p)) tags.add("type:OCRDerived");

  return Array.from(tags);
}

function inferSourceType(relFile = "") {
  const r = String(relFile || "");
  if (/代码资料库\/GaN 软件官方 实例库\//.test(r)) return "official-example";
  if (/代码资料库\/软件 office documt\//.test(r)) return "official-manual";
  if (/代码资料库\/节选/.test(r)) return "user-notes";
  if (/代码资料库\/OCR文本\//.test(r)) return "ocr-derived";
  return "workspace";
}

function sourceQualityWeight(sourceType) {
  switch (sourceType) {
    case "official-example":
      return 1.0;
    case "official-manual":
      return 0.95;
    case "user-notes":
      return 0.88;
    case "ocr-derived":
      return 0.68;
    default:
      return 0.82;
  }
}

async function parsePdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return normalizeText(data.text || "");
}

function parseTextLike(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html" || ext === ".htm") {
    return stripHtml(raw);
  }
  return normalizeText(raw);
}

async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".pdf") {
      return await parsePdf(filePath);
    }
    return parseTextLike(filePath);
  } catch (error) {
    return `__PARSE_ERROR__ ${String(error?.message || error)}`;
  }
}

function createChunkRecord({
  chunkId,
  docId,
  filePath,
  relFile,
  chunkIndex,
  text,
  tags,
  sourceType,
  sourceQuality,
  noise,
}) {
  const tokens = tokenize(text);
  const tf = makeTermFreq(tokens);
  return {
    id: chunkId,
    docId,
    filePath,
    relFile,
    chunkIndex,
    text,
    tags,
    sourceType,
    sourceQuality,
    noise,
    terms: topTerms(tf, 120),
    tokenCount: tokens.length,
  };
}

function createStatusReport({
  workspaceFolder,
  docsRoot,
  files,
  docs,
  chunks,
  maxIndexedFiles,
  maxFileSizeMB,
  config,
}) {
  const processed = [];
  const parseErrors = [];

  const docMap = new Map();
  for (const d of docs) {
    docMap.set(d.filePath, d);
  }

  for (const f of files) {
    const rel = relPath(workspaceFolder, f.path);
    const d = docMap.get(f.path);
    const item = {
      relFile: rel,
      ext: f.ext,
      sizeBytes: f.size,
      sizeMB: Number((f.size / (1024 * 1024)).toFixed(3)),
      indexed: Boolean(d && !d.hasParseError),
      hasParseError: Boolean(d?.hasParseError),
      sourceType: d?.sourceType || "workspace",
      sourceQuality: d?.sourceQuality || 0.8,
      noiseScore: d?.noise?.score || 0,
      noiseReasons: d?.noise?.reasons || [],
      tags: d?.tags || [],
      chunkCount: 0,
    };
    processed.push(item);
    if (item.hasParseError) {
      parseErrors.push({ relFile: rel, reason: "parse_error" });
    }
  }

  const chunkCountMap = new Map();
  for (const c of chunks) {
    const k = c.relFile;
    chunkCountMap.set(k, (chunkCountMap.get(k) || 0) + 1);
  }
  for (const p of processed) {
    p.chunkCount = chunkCountMap.get(p.relFile) || 0;
  }

  const skipped = [];
  const encounteredCount = files.length;
  const indexedCount = processed.filter((p) => p.indexed).length;
  const parseErrorCount = processed.filter((p) => p.hasParseError).length;
  const allSupported = walkFiles(docsRoot, {
    includeExt: SUPPORTED_EXT,
    maxFileSizeBytes: Number.MAX_SAFE_INTEGER,
    maxFiles: Number.MAX_SAFE_INTEGER,
  });
  const allCountEstimate = allSupported.length;
  const eligibleBySize = allSupported.filter(
    (f) => f.size <= maxFileSizeMB * 1024 * 1024
  );

  if (eligibleBySize.length > encounteredCount) {
    skipped.push({
      reason: "max_indexed_files_limit",
      count: eligibleBySize.length - encounteredCount,
      limit: maxIndexedFiles,
    });
  }

  const overSizeFiles = allSupported.filter((f) => f.size > maxFileSizeMB * 1024 * 1024);
  if (overSizeFiles.length) {
    skipped.push({
      reason: "max_file_size_limit",
      count: overSizeFiles.length,
      limitMB: maxFileSizeMB,
      examples: overSizeFiles.slice(0, 30).map((f) => ({
        relFile: relPath(workspaceFolder, f.path),
        sizeMB: Number((f.size / (1024 * 1024)).toFixed(3)),
      })),
    });
  }

  const summary = {
    docsRoot,
    builtAt: new Date().toISOString(),
    supportedFilesTotal: allCountEstimate,
    eligibleBySizeCount: eligibleBySize.length,
    encounteredCount,
    indexedCount,
    parseErrorCount,
    totalChunks: chunks.length,
    config: {
      maxIndexedFiles,
      maxFileSizeMB,
      maxChunkChars: config.maxChunkChars,
      chunkOverlapChars: config.chunkOverlapChars,
      vectorDims: config.vectorDims,
      retrievalMode: config.retrievalMode,
    },
  };

  return {
    summary,
    processedFiles: processed,
    parseErrors,
    skipped,
  };
}

async function buildKnowledgeIndex(config, logger = console) {
  const {
    workspaceFolder,
    docsRoot,
    indexPath,
    vectorIndexPath,
    statusPath,
    vectorDims,
    maxChunkChars,
    chunkOverlapChars,
    maxFileSizeMB,
    maxIndexedFiles,
  } = config;

  if (!fs.existsSync(docsRoot)) {
    throw new Error(`知识根目录不存在: ${docsRoot}`);
  }

  logger.info(`[TCAD] 开始扫描文档目录: ${docsRoot}`);
  const files = walkFiles(docsRoot, {
    includeExt: SUPPORTED_EXT,
    maxFileSizeBytes: maxFileSizeMB * 1024 * 1024,
    maxFiles: maxIndexedFiles,
  });

  const docs = [];
  const chunks = [];
  let docCounter = 0;
  let chunkCounter = 0;

  for (const file of files) {
    const text = await parseFile(file.path);
    const relFile = relPath(workspaceFolder, file.path);
    const docId = `doc_${++docCounter}`;
    const sourceType = inferSourceType(relFile);
    const sourceQuality = sourceQualityWeight(sourceType);

    const normalizedText = text.startsWith("__PARSE_ERROR__")
      ? text
      : cleanupOcrText(text);
    const noise = text.startsWith("__PARSE_ERROR__")
      ? { score: 1, reasons: ["parse_error"] }
      : calcTextNoiseScore(normalizedText);

    const tags = inferTags(file.path, normalizedText);
    const docEntry = {
      id: docId,
      filePath: file.path,
      relFile,
      ext: file.ext,
      size: file.size,
      tags,
      sourceType,
      sourceQuality,
      noise,
      hasParseError: normalizedText.startsWith("__PARSE_ERROR__"),
    };
    docs.push(docEntry);

    if (docEntry.hasParseError || !normalizedText.trim()) continue;

    const slices = chunkText(normalizedText, maxChunkChars, chunkOverlapChars);
    for (let i = 0; i < slices.length; i++) {
      const chunkNoise = calcTextNoiseScore(slices[i]);
      const chunk = createChunkRecord({
        chunkId: `ck_${++chunkCounter}`,
        docId,
        filePath: file.path,
        relFile,
        chunkIndex: i,
        text: slices[i],
        tags,
        sourceType,
        sourceQuality,
        noise: chunkNoise,
      });
      chunks.push(chunk);
    }
  }

  const metadata = {
    version: 1,
    builtAt: new Date().toISOString(),
    docsRoot,
    docsCount: docs.length,
    chunksCount: chunks.length,
    supportedExt: SUPPORTED_EXT,
  };

  const indexObj = {
    metadata,
    docs,
    chunks,
  };

  const statusObj = createStatusReport({
    workspaceFolder,
    docsRoot,
    files,
    docs,
    chunks,
    maxIndexedFiles,
    maxFileSizeMB,
    config,
  });

  ensureDirForFile(indexPath);
  fs.writeFileSync(indexPath, JSON.stringify(indexObj, null, 2), "utf-8");

  if (statusPath) {
    ensureDirForFile(statusPath);
    fs.writeFileSync(statusPath, JSON.stringify(statusObj, null, 2), "utf-8");
    logger.info(
      `[TCAD] 状态报告已写入: processed=${statusObj.summary.indexedCount}, parseErrors=${statusObj.summary.parseErrorCount}, output=${statusPath}`
    );
  }

  if (vectorIndexPath) {
    const vectorIndex = buildVectorIndexFromKnowledgeIndex(indexObj, {
      dims: vectorDims,
    });
    saveVectorIndex(vectorIndexPath, vectorIndex);
    logger.info(
      `[TCAD] 向量索引完成: dims=${vectorIndex.metadata.dims}, chunks=${vectorIndex.metadata.chunksCount}, output=${vectorIndexPath}`
    );
  }

  logger.info(
    `[TCAD] 索引完成: docs=${docs.length}, chunks=${chunks.length}, output=${indexPath}`
  );

  return indexObj;
}

function loadKnowledgeIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return null;
  }
  const raw = fs.readFileSync(indexPath, "utf-8");
  return JSON.parse(raw);
}

function loadIndexStatus(statusPath) {
  if (!statusPath || !fs.existsSync(statusPath)) {
    return null;
  }
  const raw = fs.readFileSync(statusPath, "utf-8");
  return JSON.parse(raw);
}

module.exports = {
  buildKnowledgeIndex,
  loadKnowledgeIndex,
  loadIndexStatus,
  inferTags,
};
