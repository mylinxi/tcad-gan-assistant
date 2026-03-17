const fs = require("fs");
const path = require("path");

const { buildKnowledgeIndex } = require("../src/indexer");
const { searchKnowledge } = require("../src/search");
const { loadVectorIndex } = require("../src/vector");
const { listTemplateNames } = require("../src/templates");
const { diagnoseLog } = require("../src/diagnostics");
const { createRequirementCardV2 } = require("../src/requirement");
const {
  retrieveSimilarCases,
  isLikelyConfigFileForStage,
  selectEvidenceByPolicy,
} = require("../src/caseBased");

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function summarizeNoise(index) {
  const docs = Array.isArray(index?.docs) ? index.docs : [];
  const chunks = Array.isArray(index?.chunks) ? index.chunks : [];

  const bySource = {};
  for (const d of docs) {
    const st = String(d?.sourceType || "workspace");
    if (!bySource[st]) {
      bySource[st] = {
        docs: 0,
        avgDocNoise: 0,
        avgSourceQuality: 0,
      };
    }
    bySource[st].docs += 1;
    bySource[st].avgDocNoise += safeNum(d?.noise?.score, 0);
    bySource[st].avgSourceQuality += safeNum(d?.sourceQuality, 0.8);
  }

  for (const st of Object.keys(bySource)) {
    const x = bySource[st];
    const denom = Math.max(1, x.docs);
    x.avgDocNoise = Number((x.avgDocNoise / denom).toFixed(4));
    x.avgSourceQuality = Number((x.avgSourceQuality / denom).toFixed(4));
  }

  let chunkNoiseSum = 0;
  for (const c of chunks) {
    chunkNoiseSum += safeNum(c?.noise?.score, 0);
  }

  return {
    avgChunkNoise: Number((chunkNoiseSum / Math.max(1, chunks.length)).toFixed(4)),
    bySource,
  };
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const repoDocsRoot = path.join(projectRoot, "代码资料库");
  const parentRoot = path.resolve(projectRoot, "..");
  const parentDocsRoot = path.join(parentRoot, "代码资料库");
  const workspaceRoot = fs.existsSync(repoDocsRoot) ? projectRoot : parentRoot;
  const docsRoot = fs.existsSync(repoDocsRoot) ? repoDocsRoot : parentDocsRoot;

  const config = {
    workspaceFolder: workspaceRoot,
    docsRoot,
    indexPath: path.join(projectRoot, ".tcad-assistant", "smoke-index.json"),
    statusPath: path.join(projectRoot, ".tcad-assistant", "smoke-index-status.json"),
    vectorIndexPath: path.join(projectRoot, ".tcad-assistant", "smoke-vector-index.json"),
    vectorDims: 384,
    retrievalMode: "hybrid",
    hybridWeight: 0.62,
    maxChunkChars: 1000,
    chunkOverlapChars: 160,
    maxFileSizeMB: 60,
    maxIndexedFiles: 1200,
  };

  console.log("[smoke] workspace:", workspaceRoot);
  console.log("[smoke] docsRoot:", config.docsRoot);

  if (!fs.existsSync(config.docsRoot)) {
    throw new Error(`docsRoot 不存在: ${config.docsRoot}`);
  }

  const index = await buildKnowledgeIndex(config, {
    info: (m) => console.log(m),
    error: (m) => console.error(m),
  });

  if (!index?.metadata?.docsCount || !index?.metadata?.chunksCount) {
    throw new Error("索引为空，smoke 失败。");
  }

  const vectorIndex = loadVectorIndex(config.vectorIndexPath);
  if (!vectorIndex?.metadata?.chunksCount) {
    throw new Error("向量索引为空，smoke 失败。");
  }

  const queries = [
    "GaN HEMT p-GaN gate diffusion activation",
    "RHS increased by more than factor NAN ExtendedPrecision",
    "swbpy2 Sentaurus Workbench API",
  ];

  const searchSummary = [];
  for (const q of queries) {
    const common = {
      topK: 3,
      requireEvidence: true,
      tagBoost: ["material:GaN", "topic:Convergence", "stage:SDevice"],
      vectorIndex,
      hybridWeight: config.hybridWeight,
    };

    const lexical = searchKnowledge(index, q, {
      ...common,
      retrievalMode: "lexical",
    });
    const vector = searchKnowledge(index, q, {
      ...common,
      retrievalMode: "vector",
    });
    const hybrid = searchKnowledge(index, q, {
      ...common,
      retrievalMode: "hybrid",
    });

    searchSummary.push({
      query: q,
      lexical: {
        hitCount: lexical.length,
        top: lexical[0]
          ? {
              relFile: lexical[0].relFile,
              score: lexical[0].score,
            }
          : null,
      },
      vector: {
        hitCount: vector.length,
        top: vector[0]
          ? {
              relFile: vector[0].relFile,
              score: vector[0].score,
            }
          : null,
      },
      hybrid: {
        hitCount: hybrid.length,
        top: hybrid[0]
          ? {
              relFile: hybrid[0].relFile,
              score: hybrid[0].score,
            }
          : null,
      },
    });
  }

  const templates = listTemplateNames();
  if (templates.length < 3) {
    throw new Error("模板数量异常，smoke 失败。");
  }

  const sampleLog = `
  RHS increased by more than factor 1.0000E10
  simulation did not converge
  NAN detected in update vector
  GradQuasiFermi instability
  `;
  const diag = diagnoseLog(sampleLog);
  if (!diag?.suggestions?.length) {
    throw new Error("日志诊断未产出建议，smoke 失败。");
  }

  const report = {
    at: new Date().toISOString(),
    index: {
      docsCount: index.metadata.docsCount,
      chunksCount: index.metadata.chunksCount,
      indexPath: config.indexPath,
      statusPath: config.statusPath,
      vectorIndexPath: config.vectorIndexPath,
      vectorDims: vectorIndex.metadata?.dims || null,
      vectorChunksCount: vectorIndex.metadata?.chunksCount || 0,
    },
    quality: summarizeNoise(index),
    searchSummary,
    templatesCount: templates.length,
    diagnosisPatterns: diag.patterns,
    diagnosisSuggestionCount: diag.suggestions.length,
  };

  const reqCard = createRequirementCardV2({
    structureType: "p-GaN HEMT",
    simTargets: ["IdVg", "BV"],
    deliverStage: "SDevice",
    keyConstraints: "收敛优先",
    outputStyle: "可直接替换块",
    knownInputs: "sdevice.par",
    structureHints: "增加场板, 强化收敛",
    geometryParams: "lg=0.8,lsg=0.8,lgd=4.2",
    biasParams: "Vd=1.0,Vg=6.0,InitialStep=1e-4",
  });
  const similar = retrieveSimilarCases(index, reqCard, {
    vectorIndex,
    retrievalMode: "hybrid",
    hybridWeight: config.hybridWeight,
    topK: 3,
  });
  const evidenceCheck = selectEvidenceByPolicy(similar, reqCard.evidencePolicy || {});
  report.requirementV2 = {
    structureType: reqCard.structureType,
    stage: reqCard.deliverStage,
    simTargets: reqCard.simTargets,
    evidencePolicy: {
      pass: evidenceCheck.pass,
      selectedCount: evidenceCheck.selectedCount,
      officialCount: evidenceCheck.officialCount,
      violations: evidenceCheck.violations,
      selectedTop: (evidenceCheck.selected || []).slice(0, 3).map((s) => ({
        relFile: s.relFile,
        sourceType: s.sourceType,
        selectedReason: s.selectedReason,
        score: Number((s.mergedScore ?? s.score ?? 0).toFixed(4)),
      })),
    },
    similarCasesTop: (similar.candidates || []).slice(0, 3).map((c) => ({
      relFile: c.relFile,
      mergedScore: c.mergedScore,
      sourceType: c.sourceType,
    })),
  };

  if (!evidenceCheck.pass) {
    throw new Error(
      `RequirementV2 证据约束未满足, violations=${(evidenceCheck.violations || []).join(",") || "none"}`
    );
  }

  const topCase = report.requirementV2.similarCasesTop[0];
  if (!topCase || !isLikelyConfigFileForStage(topCase.relFile, reqCard.deliverStage)) {
    throw new Error(
      `RequirementV2 检索未命中阶段语法载体文件，top=${topCase ? topCase.relFile : "(none)"}`
    );
  }

  const reportPath = path.join(projectRoot, ".tcad-assistant", "smoke-report.json");
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log("[smoke] PASS");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err?.stack || err);
  process.exit(1);
});
