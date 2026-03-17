const { tokenize, makeTermFreq, cosineSim } = require("./utils");
const { searchVectorIndex } = require("./vector");

function toTfMapFromTerms(terms) {
  const m = new Map();
  for (const item of terms || []) {
    if (!item || !item.t) continue;
    m.set(item.t, Number(item.c) || 0);
  }
  return m;
}

function buildIdf(chunks) {
  const df = new Map();
  const N = chunks.length || 1;

  for (const c of chunks) {
    const seen = new Set();
    for (const t of c.terms || []) {
      if (!t?.t) continue;
      if (seen.has(t.t)) continue;
      seen.add(t.t);
      df.set(t.t, (df.get(t.t) || 0) + 1);
    }
  }

  const idf = new Map();
  for (const [term, dfi] of df.entries()) {
    const val = Math.log((N + 1) / (dfi + 1)) + 1;
    idf.set(term, val);
  }
  return idf;
}

function tfidf(tfMap, idfMap) {
  const out = new Map();
  for (const [term, tf] of tfMap.entries()) {
    const idf = idfMap.get(term) || 1;
    out.set(term, tf * idf);
  }
  return out;
}

function keywordScore(queryTokens, chunkTermsMap) {
  if (!queryTokens.length) return 0;
  let hit = 0;
  for (const q of queryTokens) {
    if (chunkTermsMap.has(q)) hit++;
  }
  return hit / queryTokens.length;
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

function normalizeRetrievalMode(value) {
  const m = String(value || "").toLowerCase();
  if (m === "lexical" || m === "vector" || m === "hybrid") return m;
  return "hybrid";
}

function buildChunkMap(index) {
  const m = new Map();
  for (const c of index.chunks || []) {
    if (c?.id) m.set(c.id, c);
  }
  return m;
}

function getChunkPreview(chunk, requireEvidence = true) {
  const evidence = (chunk.text || "").slice(0, 420);
  return {
    relFile: chunk.relFile,
    chunkIndex: chunk.chunkIndex,
    tags: chunk.tags || [],
    sourceType: chunk.sourceType || "workspace",
    sourceQuality: Number(chunk.sourceQuality || 0.8),
    noiseScore: Number(chunk.noise?.score || 0),
    noiseReasons: chunk.noise?.reasons || [],
    evidence: requireEvidence ? evidence : "",
    text: chunk.text,
  };
}

function lexicalSearchInternal(index, query, options = {}) {
  const { tagBoost = [] } = options;
  const qTokens = tokenize(query);
  const qTf = makeTermFreq(qTokens);
  const idf = buildIdf(index.chunks);
  const qVec = tfidf(qTf, idf);

  const ranked = [];

  for (const c of index.chunks) {
    const cTf = toTfMapFromTerms(c.terms);
    const cVec = tfidf(cTf, idf);

    const kw = keywordScore(qTokens, cTf);
    const sem = cosineSim(qVec, cVec);

    let boost = 0;
    if (Array.isArray(c.tags) && c.tags.length > 0) {
      for (const b of tagBoost) {
        if (c.tags.includes(b)) boost += 0.03;
      }
    }

    const sourceQuality = Number(c.sourceQuality || 0.8);
    const noisePenalty = Math.min(0.35, Math.max(0, Number(c.noise?.score || 0)) * 0.35);
    const qualityBoost = (sourceQuality - 0.8) * 0.2;

    ranked.push({
      chunk: c,
      keyword: kw,
      semantic: sem,
      boost,
      sourceQuality,
      noisePenalty,
      qualityBoost,
      final: 0,
    });
  }

  normalizeScores(ranked, "keyword");
  normalizeScores(ranked, "semantic");

  for (const r of ranked) {
    r.final = 0.55 * r.keywordNorm + 0.45 * r.semanticNorm + r.boost + r.qualityBoost - r.noisePenalty;
  }

  ranked.sort((a, b) => b.final - a.final);
  return ranked;
}

function searchKnowledge(index, query, options = {}) {
  const {
    topK = 8,
    requireEvidence = true,
    tagBoost = [],
    retrievalMode = "hybrid",
    vectorIndex = null,
    hybridWeight = 0.62,
  } = options;

  const mode = normalizeRetrievalMode(retrievalMode);
  const w = Math.max(0, Math.min(1, Number(hybridWeight) || 0.62));

  if (!index || !Array.isArray(index.chunks)) {
    return [];
  }

  const chunkMap = buildChunkMap(index);

  if (mode === "vector") {
    const vOnly = searchVectorIndex(vectorIndex, query, { topK });
    return vOnly
      .map((v) => {
        const chunk = chunkMap.get(v.chunkId);
        if (!chunk) return null;

        const sourceQuality = Number(chunk.sourceQuality || 0.8);
        const noisePenalty = Math.min(0.35, Math.max(0, Number(chunk.noise?.score || 0)) * 0.35);
        const adjusted = Math.max(0, Number(v.score || 0) * sourceQuality - noisePenalty);
        return {
          score: Number(adjusted.toFixed(4)),
          ...getChunkPreview(chunk, requireEvidence),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(Boolean);
  }

  const lexicalRanked = lexicalSearchInternal(index, query, { tagBoost });

  if (mode === "lexical") {
    const topLex = lexicalRanked.slice(0, topK).map((r) => ({
      score: Number(r.final.toFixed(4)),
      ...getChunkPreview(r.chunk, requireEvidence),
    }));
    return topLex;
  }

  const vectorTop = searchVectorIndex(vectorIndex, query, { topK: Math.max(topK * 2, 12) });
  const vectorScoreMap = new Map();
  for (const v of vectorTop) {
    vectorScoreMap.set(v.chunkId, v.score);
  }

  const merged = lexicalRanked.map((r) => {
    const v = vectorScoreMap.get(r.chunk.id) || 0;
    const sourceQuality = Number(r.chunk.sourceQuality || 0.8);
    const noisePenalty = Math.min(0.35, Math.max(0, Number(r.chunk.noise?.score || 0)) * 0.35);
    const hybrid = (w * r.final + (1 - w) * v) * sourceQuality - noisePenalty;
    return {
      chunk: r.chunk,
      lexical: r.final,
      vector: v,
      sourceQuality,
      noisePenalty,
      hybrid,
    };
  });

  merged.sort((a, b) => b.hybrid - a.hybrid);

  return merged.slice(0, topK).map((m) => ({
    score: Number(m.hybrid.toFixed(4)),
    ...getChunkPreview(m.chunk, requireEvidence),
  }));
}

function formatResultsForPanel(query, results) {
  if (!results.length) {
    return `未找到和查询“${query}”相关的内容。`; 
  }

  const lines = [];
  lines.push(`# 检索结果: ${query}`);
  lines.push("");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`## ${i + 1}. ${r.relFile} (chunk ${r.chunkIndex}, score=${r.score})`);
    if (r.tags?.length) {
      lines.push(`- 标签: ${r.tags.join(", ")}`);
    }
    if (r.evidence) {
      lines.push("- 证据片段:");
      lines.push("```");
      lines.push(r.evidence);
      lines.push("```");
    }
    lines.push("");
  }
  return lines.join("\n");
}

module.exports = {
  searchKnowledge,
  formatResultsForPanel,
};
