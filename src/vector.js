const fs = require("fs");

const { ensureDirForFile, tokenize, makeTermFreq } = require("./utils");

function clampDims(dims, fallback = 256) {
  const n = Number(dims);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(32, Math.min(4096, Math.round(n)));
}

function fnv1a32(str, seed = 2166136261) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalizeUnit(vec) {
  let norm2 = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    norm2 += v * v;
  }
  if (!norm2) return vec;

  const inv = 1 / Math.sqrt(norm2);
  for (let i = 0; i < vec.length; i++) {
    vec[i] *= inv;
  }
  return vec;
}

function embedTextToVector(text, dims = 256) {
  const d = clampDims(dims, 256);
  const vec = new Array(d).fill(0);
  const tokens = tokenize(text || "");
  if (!tokens.length) return vec;

  const tf = makeTermFreq(tokens);

  for (const [token, count] of tf.entries()) {
    const w = 1 + Math.log(1 + count);
    const h1 = fnv1a32(token, 2166136261);
    const h2 = fnv1a32(token, 334214467);
    const i1 = h1 % d;
    const i2 = h2 % d;
    const sign = (h2 & 1) === 0 ? 1 : -1;

    vec[i1] += w;
    vec[i2] += 0.5 * w * sign;
  }

  normalizeUnit(vec);
  for (let i = 0; i < vec.length; i++) {
    vec[i] = Math.round(vec[i] * 1e6) / 1e6;
  }
  return vec;
}

function dotUnit(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += a[i] * b[i];
  }
  return s;
}

function normalizeScores(items, field) {
  let min = Infinity;
  let max = -Infinity;
  for (const it of items) {
    const v = it[field] || 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  for (const it of items) {
    it[`${field}Norm`] = ((it[field] || 0) - min) / range;
  }
}

function buildVectorIndexFromKnowledgeIndex(index, options = {}) {
  if (!index || !Array.isArray(index.chunks)) {
    throw new Error("无法构建向量索引：知识索引为空或格式错误。");
  }

  const dims = clampDims(options.dims, 256);
  const entries = [];

  for (const c of index.chunks) {
    entries.push({
      chunkId: c.id,
      docId: c.docId,
      relFile: c.relFile,
      chunkIndex: c.chunkIndex,
      tags: c.tags || [],
      vector: embedTextToVector(c.text || "", dims),
    });
  }

  return {
    metadata: {
      version: 1,
      builtAt: new Date().toISOString(),
      algorithm: "hashing-tf-l2-v1",
      dims,
      chunksCount: entries.length,
      source: {
        indexBuiltAt: index.metadata?.builtAt || null,
        docsCount: index.metadata?.docsCount || 0,
      },
    },
    entries,
  };
}

function saveVectorIndex(vectorIndexPath, vectorIndexObj) {
  ensureDirForFile(vectorIndexPath);
  fs.writeFileSync(vectorIndexPath, JSON.stringify(vectorIndexObj), "utf-8");
}

function loadVectorIndex(vectorIndexPath) {
  if (!vectorIndexPath || !fs.existsSync(vectorIndexPath)) {
    return null;
  }
  const raw = fs.readFileSync(vectorIndexPath, "utf-8");
  return JSON.parse(raw);
}

function searchVectorIndex(vectorIndex, query, options = {}) {
  const { topK = 8 } = options;
  if (!vectorIndex || !Array.isArray(vectorIndex.entries)) {
    return [];
  }

  const dims = clampDims(
    vectorIndex.metadata?.dims || vectorIndex.entries[0]?.vector?.length || 256,
    256
  );
  const qVec = embedTextToVector(query || "", dims);

  const scored = [];
  for (const e of vectorIndex.entries) {
    if (!Array.isArray(e.vector) || e.vector.length !== dims) continue;

    const rawScore = dotUnit(qVec, e.vector);
    const shifted = (rawScore + 1) / 2;

    scored.push({
      entry: e,
      rawScore,
      shifted,
    });
  }

  if (!scored.length) return [];

  normalizeScores(scored, "shifted");
  scored.sort((a, b) => b.shiftedNorm - a.shiftedNorm);

  return scored.slice(0, topK).map((it) => ({
    chunkId: it.entry.chunkId,
    relFile: it.entry.relFile,
    chunkIndex: it.entry.chunkIndex,
    tags: it.entry.tags || [],
    score: Number(it.shiftedNorm.toFixed(4)),
    rawScore: Number(it.rawScore.toFixed(4)),
  }));
}

module.exports = {
  embedTextToVector,
  buildVectorIndexFromKnowledgeIndex,
  saveVectorIndex,
  loadVectorIndex,
  searchVectorIndex,
};

