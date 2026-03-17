const fs = require("fs");
const path = require("path");

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function walkFiles(rootDir, options = {}) {
  const {
    includeExt = [],
    maxFileSizeBytes = 50 * 1024 * 1024,
    maxFiles = 4000,
  } = options;

  const result = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const children = fs.readdirSync(current).map((f) => path.join(current, f));
      for (const c of children) stack.push(c);
    } else if (stat.isFile()) {
      if (result.length >= maxFiles) break;
      const ext = path.extname(current).toLowerCase();
      if (includeExt.length > 0 && !includeExt.includes(ext)) continue;
      if (stat.size > maxFileSizeBytes) continue;
      result.push({ path: current, size: stat.size, ext });
    }
  }

  return result;
}

function normalizeText(text) {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactGibberishRuns(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  for (const ln of lines) {
    const line = String(ln || "");
    const l = line.trim();
    if (!l) {
      out.push("");
      continue;
    }

    if (/^[\\|\/\-_=~·•`'"\.]{3,}$/.test(l)) continue;

    const symbols = (l.match(/[\\|\/\-_=~·•`'"\.]/g) || []).length;
    const ratio = symbols / Math.max(1, l.length);
    if (l.length >= 5 && ratio > 0.72) continue;

    out.push(line);
  }
  return out.join("\n");
}

function cleanupOcrText(text) {
  let t = normalizeText(text || "");
  if (!t) return "";

  t = t
    .replace(/[\uFFFD]/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[，]/g, ",")
    .replace(/[。]/g, ".")
    .replace(/[：]/g, ":")
    .replace(/[；]/g, ";")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[\u00A0\t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  t = compactGibberishRuns(t);

  return normalizeText(t);
}

function calcTextNoiseScore(text) {
  const t = String(text || "");
  if (!t.trim()) {
    return {
      score: 1,
      reasons: ["empty_text"],
    };
  }

  const lines = t.split("\n").filter((x) => String(x || "").trim());
  const len = t.length;
  const weird = (t.match(/[\uFFFD]/g) || []).length;
  const symbols = (t.match(/[\\|\/\-_=~`'"·•]/g) || []).length;
  const longAsciiRuns = (t.match(/[A-Za-z0-9]{24,}/g) || []).length;
  const shortLines = lines.filter((ln) => ln.trim().length <= 2).length;

  const weirdRatio = weird / Math.max(1, len);
  const symbolRatio = symbols / Math.max(1, len);
  const shortLineRatio = shortLines / Math.max(1, lines.length);

  let score = 0;
  const reasons = [];

  if (weirdRatio > 0.003) {
    score += 0.3;
    reasons.push("replacement_characters");
  }
  if (symbolRatio > 0.18) {
    score += 0.25;
    reasons.push("high_symbol_ratio");
  }
  if (shortLineRatio > 0.45) {
    score += 0.2;
    reasons.push("too_many_short_lines");
  }
  if (longAsciiRuns > 10) {
    score += 0.15;
    reasons.push("too_many_long_ascii_runs");
  }
  if (lines.length < 6 && len < 300) {
    score += 0.1;
    reasons.push("too_little_text");
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(4))));
  return { score, reasons };
}

function stripHtml(html) {
  if (!html) return "";
  let txt = html;
  txt = txt.replace(/<script[\s\S]*?<\/script>/gi, " ");
  txt = txt.replace(/<style[\s\S]*?<\/style>/gi, " ");
  txt = txt.replace(/<[^>]+>/g, " ");
  txt = txt
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return normalizeText(txt);
}

function chunkText(text, maxChars = 1200, overlapChars = 180) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    let slice = normalized.slice(start, end);

    if (end < normalized.length) {
      const lastNewline = slice.lastIndexOf("\n");
      if (lastNewline > maxChars * 0.5) {
        slice = slice.slice(0, lastNewline);
      }
    }

    slice = slice.trim();
    if (slice) chunks.push(slice);

    if (end >= normalized.length) break;

    const shift = Math.max(1, slice.length - overlapChars);
    start += shift;
  }

  return chunks;
}

function tokenize(text) {
  const lower = (text || "").toLowerCase();
  const tokens =
    lower.match(/[a-z_][a-z0-9_\-.]{1,}|\d+\.?\d*(?:e[+-]?\d+)?|[\u4e00-\u9fff]{2,}/g) ||
    [];
  return tokens;
}

function makeTermFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  return tf;
}

function topTerms(tfMap, maxTerms = 120) {
  return Array.from(tfMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([t, c]) => ({ t, c }));
}

function cosineSim(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [, v] of vecA) {
    normA += v * v;
  }
  for (const [, v] of vecB) {
    normB += v * v;
  }

  const [small, large] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];
  for (const [k, v] of small) {
    const lv = large.get(k);
    if (lv) dot += v * lv;
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function relPath(base, target) {
  return path.relative(base, target).replace(/\\/g, "/");
}

module.exports = {
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
  cosineSim,
  relPath,
};
