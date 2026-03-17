const fs = require("fs");
const path = require("path");

const { searchKnowledge } = require("./search");

function uniq(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizeStage(stage) {
  const s = String(stage || "").trim();
  if (s === "SDE" || s === "SProcess" || s === "SDevice" || s === "全链路") {
    return s;
  }
  return "SDevice";
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toParamMap(card = {}) {
  return {
    ...(card.geometryParams || {}),
    ...(card.processParams || {}),
    ...(card.biasParams || {}),
  };
}

function buildNormalizedParamMap(params = {}) {
  const m = new Map();
  for (const [k, v] of Object.entries(params || {})) {
    const nk = normalizeKey(k);
    const value = String(v ?? "").trim();
    if (!nk || !value) continue;
    m.set(nk, { key: k, value });
  }
  return m;
}

function pickParam(normMap, aliases = []) {
  for (const alias of aliases) {
    const hit = normMap.get(normalizeKey(alias));
    if (hit?.value) return hit;
  }
  return null;
}

function stageHints(stage) {
  if (stage === "SDE") {
    return ["SDE", "structure editor", "region", "contact", "mesh", "sde_dvs.cmd"];
  }
  if (stage === "SProcess") {
    return ["SProcess", "iiiv.epi", "diffuse", "activation", "sprocess_fps.cmd"];
  }
  if (stage === "SDevice") {
    return ["SDevice", "Physics", "Math", "Solve", "IdVg_des.cmd", "Common_des.cmd"];
  }
  return ["SDE", "SProcess", "SDevice", "full flow", "workflow"];
}

function buildCaseFileFocusedQuery(stage) {
  if (stage === "SDE") {
    return "sde_dvs.cmd sde_dvs.prf structure editor region contact mesh";
  }
  if (stage === "SProcess") {
    return "sprocess_fps.cmd sprocess iiiv.epi diffuse activation anneal";
  }
  if (stage === "SDevice") {
    return "IdVg_des.cmd IdVd_des.cmd BV_des.cmd Common_des.cmd sdevice.par Physics Math Solve";
  }
  return "sde_dvs.cmd sprocess_fps.cmd IdVg_des.cmd Common_des.cmd sdevice.par";
}

function isSyntaxCarrierExt(ext) {
  return [".cmd", ".par", ".tcl", ".prf", ".txt", ".md", ".rst"].includes(ext);
}

function structureHints(structureType) {
  const s = String(structureType || "").toLowerCase();
  if (s.includes("mis")) {
    return ["MIS", "dielectric", "interface traps", "workfunction"];
  }
  if (s.includes("p-gan") || s.includes("pgan")) {
    return ["p-GaN", "polarization", "2DEG", "Mg", "gate leakage"];
  }
  if (s.includes("schottky")) {
    return ["Schottky", "barrier", "tunneling"];
  }
  if (s.includes("vertical")) {
    return ["Vertical", "drift", "breakdown", "trench"];
  }
  return ["GaN", "HEMT", "AlGaN/GaN", "polarization"];
}

function targetHints(simTargets = []) {
  const t = new Set((simTargets || []).map((x) => String(x || "").toLowerCase()));
  const out = [];
  if (t.has("idvg")) out.push("IdVg", "transfer curve", "gate sweep");
  if (t.has("idvd")) out.push("IdVd", "output curve", "drain sweep");
  if (t.has("bv")) out.push("breakdown", "avalanche", "BV");
  if (t.has("switching")) out.push("transient", "switching");
  if (t.has("selfheating")) out.push("self heating", "lattice temperature");
  return out;
}

function buildRequirementQuery(card = {}) {
  const stage = normalizeStage(card.deliverStage);
  const tokens = uniq([
    "GaN",
    card.structureType,
    ...(card.simTargets || []),
    stage,
    card.keyConstraints,
    ...(card.structureHints || []),
    ...(card.preferredCases || []),
    ...(card.structureAbstraction ? Object.values(card.structureAbstraction) : []),
    ...structureHints(card.structureType),
    ...targetHints(card.simTargets),
    ...stageHints(stage),
  ]);
  return tokens.join(" ");
}

function buildTagBoost(card = {}) {
  const stage = normalizeStage(card.deliverStage);
  const tags = ["material:GaN"];

  if (stage === "SDE") tags.push("stage:SDE");
  if (stage === "SProcess") tags.push("stage:SProcess");
  if (stage === "SDevice") tags.push("stage:SDevice");
  if (stage === "全链路") tags.push("stage:SDE", "stage:SProcess", "stage:SDevice");

  const targets = new Set((card.simTargets || []).map((x) => String(x || "").toLowerCase()));
  if (targets.has("idvg") || targets.has("idvd")) tags.push("topic:IV");
  if (targets.has("bv")) tags.push("topic:Breakdown");

  const c = String(card.keyConstraints || "");
  if (c.includes("收敛") || c.toLowerCase().includes("conver")) {
    tags.push("topic:Convergence");
  }

  return uniq(tags);
}

function inferStageFromRelFile(relFile = "") {
  const l = String(relFile || "").toLowerCase();
  if (/\bsde\b|sde_|_dvs\.cmd|dvs\.cmd/.test(l)) return "SDE";
  if (/sprocess|_fps\.cmd|iiiv\.epi|process/.test(l)) return "SProcess";
  if (/sdevice|_des\.cmd|idvg_des|idvd_des|bv_des|common_des\.cmd/.test(l)) return "SDevice";
  return "";
}

function isOfficialExample(relFile = "") {
  return /代码资料库\/GaN 软件官方 实例库\//.test(relFile);
}

function sourceType(relFile = "") {
  if (isOfficialExample(relFile)) return "official-example";
  if (/代码资料库\/软件 office documt\//.test(relFile)) return "official-manual";
  if (/代码资料库\/节选/.test(relFile)) return "user-notes";
  if (/代码资料库\/OCR文本\//.test(relFile)) return "ocr-derived";
  return "workspace";
}

function sourcePriority(value = "") {
  const s = String(value || "");
  if (s === "official-example") return 50;
  if (s === "official-manual") return 40;
  if (s === "workspace") return 25;
  if (s === "user-notes") return 20;
  if (s === "ocr-derived") return 10;
  return 0;
}

function scoreOf(item) {
  return Number(item?.mergedScore ?? item?.score ?? 0) || 0;
}

function allowByPolicy(source, policy = {}) {
  const includeUserNotes = policy.includeUserNotes !== false;
  if (!includeUserNotes && String(source || "") === "user-notes") return false;
  return true;
}

function isLikelyConfigFileForStage(relFile = "", stage = "SDevice") {
  const ext = path.extname(relFile).toLowerCase();
  const inferred = inferStageFromRelFile(relFile);
  if (!isSyntaxCarrierExt(ext)) return false;
  if (stage === "全链路") return true;
  return inferred === stage || (!inferred && ext === ".cmd");
}

function rankBonus(result, stage) {
  const relFile = result.relFile || "";
  const ext = path.extname(relFile).toLowerCase();
  const inferredStage = inferStageFromRelFile(relFile);

  let bonus = 0;
  if (sourceType(relFile) === "official-example") bonus += 0.15;
  if (sourceType(relFile) === "official-manual") bonus += 0.03;
  if (sourceType(relFile) === "user-notes") bonus += 0.02;

  if (stage === "全链路") {
    if (inferredStage) bonus += 0.08;
  } else if (inferredStage === stage) {
    bonus += 0.14;
  } else if (inferredStage) {
    bonus -= 0.05;
  }

  if (isLikelyConfigFileForStage(relFile, stage)) bonus += 0.28;

  if (ext === ".cmd") bonus += 0.32;
  if (ext === ".par") bonus += 0.25;
  if (ext === ".tcl" || ext === ".prf") bonus += 0.12;
  if (/greadme\.pdf$/i.test(relFile)) bonus -= 0.6;
  if (ext === ".pdf") bonus -= 0.2;

  if (Array.isArray(result.tags) && result.tags.includes("material:GaN")) bonus += 0.03;

  return {
    inferredStage,
    bonus,
  };
}

function retrieveSimilarCases(index, card, options = {}) {
  const {
    vectorIndex = null,
    retrievalMode = "hybrid",
    hybridWeight = 0.62,
    topK = 8,
  } = options;

  if (!index || !Array.isArray(index.chunks)) {
    return {
      query: "",
      tagBoost: [],
      candidates: [],
    };
  }

  const stage = normalizeStage(card?.deliverStage);
  const query = buildRequirementQuery(card);
  const focused = buildCaseFileFocusedQuery(stage);
  const tagBoost = buildTagBoost(card);
  const fetchK = Math.max(topK * 15, 120);

  const rawGeneral = searchKnowledge(index, query, {
    topK: fetchK,
    requireEvidence: true,
    tagBoost,
    retrievalMode,
    vectorIndex,
    hybridWeight,
  });

  const rawFocused = searchKnowledge(index, `${query} ${focused}`, {
    topK: fetchK,
    requireEvidence: true,
    tagBoost,
    retrievalMode: "lexical",
    vectorIndex,
    hybridWeight,
  });

  const raw = [...rawFocused, ...rawGeneral];

  const scored = raw
    .map((r) => {
      const { bonus, inferredStage } = rankBonus(r, stage);
      const merged = Number((Number(r.score || 0) + bonus).toFixed(4));
      return {
        ...r,
        sourceType: sourceType(r.relFile),
        inferredStage,
        mergedScore: merged,
      };
    })
    .sort((a, b) => b.mergedScore - a.mergedScore);

  const stageSyntaxFirst = scored.filter((item) => {
    const relFile = String(item.relFile || "");
    const ext = path.extname(relFile).toLowerCase();
    const stageMatch = stage === "全链路" || item.inferredStage === stage || !item.inferredStage;
    const syntaxCarrier = isSyntaxCarrierExt(ext);
    return stageMatch && syntaxCarrier && !/greadme\.pdf$/i.test(relFile);
  });

  const mergedSorted = [...stageSyntaxFirst, ...scored];

  const seen = new Set();
  const candidates = [];
  for (const item of mergedSorted) {
    const key = String(item.relFile || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(item);
    if (candidates.length >= topK) break;
  }

  return {
    query,
    tagBoost,
    candidates,
  };
}

function selectEvidenceByPolicy(retrieval = {}, policy = {}) {
  const minSources = Math.max(1, Number(policy.minSources) || 2);
  const preferOfficialExample = policy.preferOfficialExample !== false;
  const preferOfficialManual = policy.preferOfficialManual !== false;

  const raw = Array.isArray(retrieval.candidates) ? retrieval.candidates : [];
  const unique = [];
  const seen = new Set();
  for (const c of raw) {
    const rel = String(c?.relFile || "").trim();
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    unique.push(c);
  }

  const available = {
    officialExample: unique.some((c) => sourceType(c.relFile) === "official-example"),
    officialManual: unique.some((c) => sourceType(c.relFile) === "official-manual"),
  };

  const selected = [];
  const used = new Set();
  const pushOne = (item, reason) => {
    const rel = String(item?.relFile || "").trim();
    if (!rel || used.has(rel)) return false;
    used.add(rel);
    selected.push({
      ...item,
      sourceType: sourceType(rel),
      selectedReason: reason,
    });
    return true;
  };

  const firstFromSource = (st) =>
    unique.find((c) => sourceType(c.relFile) === st && !used.has(String(c.relFile || "")));

  if (preferOfficialExample) {
    pushOne(firstFromSource("official-example"), "prefer_official_example");
  }
  if (preferOfficialManual) {
    pushOne(firstFromSource("official-manual"), "prefer_official_manual");
  }

  const fillPool = unique
    .filter((c) => allowByPolicy(sourceType(c.relFile), policy))
    .sort((a, b) => {
      const sp = sourcePriority(sourceType(b.relFile)) - sourcePriority(sourceType(a.relFile));
      if (sp !== 0) return sp;
      return scoreOf(b) - scoreOf(a);
    });

  for (const c of fillPool) {
    if (selected.length >= minSources) break;
    pushOne(c, "score_fill");
  }

  if (selected.length < minSources) {
    for (const c of unique) {
      if (selected.length >= minSources) break;
      pushOne(c, "fallback_fill");
    }
  }

  const hasOfficialExample = selected.some((s) => s.sourceType === "official-example");
  const hasOfficialManual = selected.some((s) => s.sourceType === "official-manual");
  const minSatisfied = selected.length >= minSources;
  const officialExampleSatisfied =
    !preferOfficialExample || !available.officialExample || hasOfficialExample;
  const officialManualSatisfied =
    !preferOfficialManual || !available.officialManual || hasOfficialManual;

  const violations = [];
  if (!minSatisfied) violations.push(`evidence_count_lt_${minSources}`);
  if (!officialExampleSatisfied) violations.push("missing_official_example");
  if (!officialManualSatisfied) violations.push("missing_official_manual");

  const officialCount = selected.filter((s) =>
    ["official-example", "official-manual"].includes(String(s.sourceType || ""))
  ).length;

  return {
    pass: minSatisfied && officialExampleSatisfied && officialManualSatisfied,
    policy: {
      minSources,
      preferOfficialExample,
      preferOfficialManual,
      includeUserNotes: policy.includeUserNotes !== false,
    },
    available,
    selected,
    selectedCount: selected.length,
    officialCount,
    violations,
  };
}

function formatEvidencePolicyMarkdown(check = {}, policy = {}) {
  const p = check.policy || policy || {};
  const minSources = Math.max(1, Number(p.minSources) || 2);

  const lines = [];
  lines.push("## 证据约束检查");
  lines.push("");
  lines.push(
    `- 规则: 最少 ${minSources} 个证据源；官方优先（example=${p.preferOfficialExample !== false ? "Y" : "N"}, manual=${p.preferOfficialManual !== false ? "Y" : "N"}）`
  );
  lines.push(`- 结果: ${check.pass ? "PASS" : "FAIL"}`);
  lines.push(
    `- 可用官方证据: example=${check.available?.officialExample ? "Y" : "N"}, manual=${check.available?.officialManual ? "Y" : "N"}`
  );
  lines.push(`- 已选证据数: ${check.selectedCount || 0}`);
  lines.push(`- 已选官方证据数: ${check.officialCount || 0}`);
  if (Array.isArray(check.violations) && check.violations.length) {
    lines.push(`- 违规项: ${check.violations.join(", ")}`);
  }
  lines.push("");

  const selected = Array.isArray(check.selected) ? check.selected : [];
  if (!selected.length) {
    lines.push("未选出满足约束的证据。\n");
    return lines.join("\n");
  }

  lines.push("| 证据文件 | sourceType | score | noise | 选择原因 |");
  lines.push("|---|---|---:|---:|---|");
  for (const s of selected) {
    const score = scoreOf(s);
    const noise = Number(s.noiseScore ?? s?.noise?.score ?? 0) || 0;
    lines.push(
      `| ${s.relFile} | ${s.sourceType || sourceType(s.relFile)} | ${score.toFixed(4)} | ${noise.toFixed(3)} | ${s.selectedReason || "score_fill"} |`
    );
  }
  lines.push("");

  return lines.join("\n");
}

function resolveCaseFile(index, workspaceFolder, relFile) {
  const byWorkspace = path.join(workspaceFolder, relFile || "");
  if (fs.existsSync(byWorkspace) && fs.statSync(byWorkspace).isFile()) {
    return {
      filePath: byWorkspace,
      relFile,
      text: fs.readFileSync(byWorkspace, "utf-8"),
    };
  }

  const doc = (index?.docs || []).find((d) => d.relFile === relFile);
  if (doc?.filePath && fs.existsSync(doc.filePath)) {
    return {
      filePath: doc.filePath,
      relFile: doc.relFile || relFile,
      text: fs.readFileSync(doc.filePath, "utf-8"),
    };
  }

  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyRegexReplace(content, regex, replacement) {
  let count = 0;
  const next = String(content || "").replace(regex, (...args) => {
    count += 1;
    if (typeof replacement === "function") {
      return replacement(...args);
    }
    return replacement;
  });

  return {
    content: next,
    count,
  };
}

function adaptContentByCard(baseContent, card = {}, context = {}) {
  let content = String(baseContent || "");
  const stage = normalizeStage(card.deliverStage);
  const params = toParamMap(card);
  const normMap = buildNormalizedParamMap(params);
  const applied = new Set();
  const changes = [];

  for (const [k, v] of Object.entries(params)) {
    const re = new RegExp(`@${escapeRegExp(k)}@`, "g");
    const { content: next, count } = applyRegexReplace(content, re, String(v));
    if (count > 0) {
      content = next;
      applied.add(k);
      changes.push(`占位符替换 @${k}@ -> ${v} (x${count})`);
    }
  }

  const applyFromAliases = (aliases, regex, label) => {
    const hit = pickParam(normMap, aliases);
    if (!hit) return;
    const { content: next, count } = applyRegexReplace(content, regex, (_m, p1) => `${p1}${hit.value}`);
    if (count > 0) {
      content = next;
      applied.add(hit.key);
      changes.push(`${label} -> ${hit.value} (x${count})`);
    }
  };

  applyFromAliases(
    ["Vg", "gate_voltage", "gate_goal", "vg_end", "vgs_end"],
    /(Goal\s*\{\s*Name\s*=\s*"?gate"?\s+Voltage\s*=\s*)([^\s\}]+)/gi,
    "Gate 目标偏置"
  );
  applyFromAliases(
    ["Vd", "drain_voltage", "drain_goal", "vd_end", "vds_end"],
    /(Goal\s*\{\s*Name\s*=\s*"?drain"?\s+Voltage\s*=\s*)([^\s\}]+)/gi,
    "Drain 目标偏置"
  );
  applyFromAliases(
    ["AreaFactor", "area_factor", "area", "af"],
    /(AreaFactor\s*=\s*)([^\s\}\)]+)/gi,
    "AreaFactor"
  );

  if (stage === "SProcess" || stage === "全链路") {
    applyFromAliases(["lg", "lgate", "gate_length"], /(fset\s+Lg\s+)([^\s#]+)/i, "Lg");
    applyFromAliases(["lsg", "source_gate_spacing"], /(fset\s+Lsg\s+)([^\s#]+)/i, "Lsg");
    applyFromAliases(["lgd", "gate_drain_spacing"], /(fset\s+Lgd\s+)([^\s#]+)/i, "Lgd");
    const tbufferHit = pickParam(normMap, ["tbuffer", "tbuf", "buffer_thickness"]);
    if (tbufferHit) {
      const { content: next, count } = applyRegexReplace(content, /@tbuffer@/gi, tbufferHit.value);
      if (count > 0) {
        content = next;
        applied.add(tbufferHit.key);
        changes.push(`tbuffer 占位符 -> ${tbufferHit.value} (x${count})`);
      }
    }
  }

  if (stage === "SDE" || stage === "全链路") {
    applyFromAliases(["lg", "lgate", "gate_length"], /(set\s+Lg\s+)([^\s#]+)/i, "SDE Lg");
    applyFromAliases(["lsg"], /(set\s+Lsg\s+)([^\s#]+)/i, "SDE Lsg");
    applyFromAliases(["lgd"], /(set\s+Lgd\s+)([^\s#]+)/i, "SDE Lgd");
  }

  if (stage === "SDevice" || stage === "全链路") {
    applyFromAliases(["initial_step", "InitialStep", "step_init"], /(InitialStep\s*=\s*)([^\s\)]+)/gi, "InitialStep");
    applyFromAliases(["max_step", "MaxStep", "step_max"], /(Max[Ss]tep\s*=\s*)([^\s\)]+)/gi, "MaxStep");
    applyFromAliases(["min_step", "MinStep", "step_min"], /(MinStep\s*=\s*)([^\s\)]+)/gi, "MinStep");
  }

  const appliedNormKeys = new Set(Array.from(applied).map(normalizeKey));
  const unresolvedParams = Object.entries(params)
    .filter(([k, v]) => String(v || "").trim() && !appliedNormKeys.has(normalizeKey(k)))
    .map(([k, v]) => ({ key: k, value: String(v) }));

  const prefix = String(content).trimStart().startsWith(";") ? ";" : "#";
  const header = [
    `${prefix} Auto-adapted from retrieved case`,
    `${prefix} source_case: ${context.sourceRelFile || "(unknown)"}`,
    `${prefix} structure_type: ${card.structureType || "GaN HEMT"}`,
    `${prefix} sim_targets: ${(card.simTargets || []).join(", ") || "(none)"}`,
    `${prefix} deliver_stage: ${stage}`,
  ].join("\n");

  content = `${header}\n\n${String(content).trimStart()}`;

  return {
    content,
    changes,
    appliedParams: Array.from(applied),
    unresolvedParams,
  };
}

function formatCaseEvidenceMarkdown(retrieval = {}, maxItems = 5) {
  const lines = [];
  lines.push("## 相似案例证据");
  lines.push("");
  lines.push(`- 检索查询: ${retrieval.query || "(无)"}`);
  if (Array.isArray(retrieval.tagBoost) && retrieval.tagBoost.length) {
    lines.push(`- TagBoost: ${retrieval.tagBoost.join(", ")}`);
  }
  lines.push("");

  const rows = (retrieval.candidates || []).slice(0, maxItems);
  if (!rows.length) {
    lines.push("未找到可用相似案例。已回退到模板生成。\n");
    return lines.join("\n");
  }

  rows.forEach((r, idx) => {
    lines.push(`### ${idx + 1}. ${r.relFile}`);
    lines.push(`- mergedScore: ${r.mergedScore}`);
    lines.push(`- sourceType: ${r.sourceType || "(unknown)"}`);
    if (r.inferredStage) lines.push(`- inferredStage: ${r.inferredStage}`);
    lines.push("```text");
    lines.push((r.evidence || "").trim());
    lines.push("```");
    lines.push("");
  });

  return lines.join("\n");
}

function formatRewriteSummaryMarkdown(adaptResult = {}) {
  const lines = [];
  lines.push("## 差异改写摘要");
  lines.push("");

  if (!Array.isArray(adaptResult.changes) || adaptResult.changes.length === 0) {
    lines.push("- 未识别到可自动改写项，输出以案例原语法为主。 ");
  } else {
    for (const c of adaptResult.changes) {
      lines.push(`- ${c}`);
    }
  }

  lines.push("");
  if (Array.isArray(adaptResult.unresolvedParams) && adaptResult.unresolvedParams.length) {
    lines.push("### 未自动落地参数（建议手工确认）");
    lines.push("");
    lines.push("| 参数 | 值 |");
    lines.push("|---|---|");
    for (const it of adaptResult.unresolvedParams) {
      lines.push(`| ${it.key} | ${it.value} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

module.exports = {
  buildRequirementQuery,
  buildTagBoost,
  isLikelyConfigFileForStage,
  retrieveSimilarCases,
  selectEvidenceByPolicy,
  resolveCaseFile,
  adaptContentByCard,
  formatEvidencePolicyMarkdown,
  formatCaseEvidenceMarkdown,
  formatRewriteSummaryMarkdown,
};
