const STRUCTURE_OPTIONS = [
  "MIS p-GaN",
  "p-GaN HEMT",
  "GaN HEMT",
  "Schottky",
  "Vertical MOSFET",
  "其他 GaN 结构",
];

const TARGET_OPTIONS = ["IdVg", "IdVd", "BV", "Switching", "SelfHeating"];

const STAGE_OPTIONS = ["SDE", "SProcess", "SDevice", "全链路"];

const CONSTRAINT_OPTIONS = ["收敛优先", "精度优先", "速度优先", "平衡"];

const OUTPUT_STYLE_OPTIONS = ["可直接替换块", "可复制片段", "仅方案"];

function uniqueKeepOrder(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const k = String(item || "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function normalizeKnownInputs(v) {
  if (Array.isArray(v)) {
    return uniqueKeepOrder(v);
  }
  if (typeof v !== "string") return [];
  return uniqueKeepOrder(v.split(/[，,;；\n]/g).map((s) => s.trim()));
}

function normalizeStructureType(value) {
  const raw = String(value || "").trim();
  if (!raw) return "GaN HEMT";
  const v = raw.toLowerCase();

  if (v.includes("mis") && (v.includes("p-gan") || v.includes("pgan"))) return "MIS p-GaN";
  if (v.includes("p-gan") || v.includes("pgan")) return "p-GaN HEMT";
  if (v.includes("schottky")) return "Schottky";
  if (v.includes("vertical") || v.includes("mosfet")) return "Vertical MOSFET";
  if (v.includes("hemt") || v.includes("hfet")) return "GaN HEMT";

  return raw;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseKeyValuePairs(input) {
  if (!input) return {};

  if (typeof input === "object" && !Array.isArray(input)) {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      const key = String(k || "").trim();
      const val = String(v ?? "").trim();
      if (!key || !val) continue;
      out[key] = val;
    }
    return out;
  }

  const parts = String(input)
    .split(/[\n，,;；]/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const out = {};
  for (const p of parts) {
    const m = p.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    const key = String(m[1] || "").trim();
    const val = String(m[2] || "").trim();
    if (!key || !val) continue;
    out[key] = val;
  }
  return out;
}

function pickByAliases(dict, aliases = []) {
  if (!dict || typeof dict !== "object") return undefined;

  const normalized = new Map();
  for (const [k, v] of Object.entries(dict)) {
    normalized.set(normalizeKey(k), String(v || "").trim());
  }

  for (const a of aliases) {
    const hit = normalized.get(normalizeKey(a));
    if (hit) return hit;
  }

  return undefined;
}

function inferStructureAbstraction(structureType, structureHints = []) {
  const s = normalizeStructureType(structureType).toLowerCase();
  const hints = String((structureHints || []).join(" ")).toLowerCase();

  const family = s.includes("vertical")
    ? "vertical-power"
    : s.includes("schottky")
      ? "schottky-gate"
      : s.includes("mis")
        ? "mis-hemt"
        : s.includes("p-gan")
          ? "pgan-hemt"
          : "lateral-hemt";

  return {
    family,
    transport: family === "vertical-power" ? "vertical" : "lateral",
    gateType: family.includes("schottky") ? "Schottky" : family.includes("mis") ? "MIS" : "p-GaN",
    hasFieldPlate: /field\s*plate|\bfp\b|场板/.test(hints),
    hasPassivation: !/no\s*passivation|无钝化/.test(hints),
    polarization: !/disable\s*polar|关闭极化/.test(hints),
  };
}

function createRequirementCard(input = {}) {
  return {
    structureType: normalizeStructureType(input.structureType || "GaN HEMT"),
    simTargets: uniqueKeepOrder(input.simTargets || []),
    deliverStage: input.deliverStage || "SDevice",
    keyConstraints: input.keyConstraints || "收敛优先",
    knownInputs: normalizeKnownInputs(input.knownInputs),
    outputStyle: input.outputStyle || "可直接替换块",
    createdAt: new Date().toISOString(),
  };
}

function createRequirementCardV2(input = {}) {
  const base = createRequirementCard(input);
  const structureHints = normalizeKnownInputs(input.structureHints || input.structureKeywords || "");

  return {
    ...base,
    version: "2.0",
    structureHints,
    preferredCases: normalizeKnownInputs(input.preferredCases || ""),
    structureAbstraction: inferStructureAbstraction(base.structureType, structureHints),
    geometryParams: parseKeyValuePairs(input.geometryParams),
    processParams: parseKeyValuePairs(input.processParams),
    biasParams: parseKeyValuePairs(input.biasParams),
    customNotes: String(input.customNotes || "").trim(),
    evidencePolicy: {
      minSources: 2,
      preferOfficialExample: true,
      preferOfficialManual: true,
      includeUserNotes: true,
    },
  };
}

function recommendTemplateNames(card) {
  const c = card || {};
  const structure = String(c.structureType || "").toLowerCase();
  const stage = String(c.deliverStage || "");
  const targets = new Set((c.simTargets || []).map((x) => String(x || "").toLowerCase()));

  const picks = [];

  if (stage === "SDE" || stage === "全链路") {
    if (structure.includes("p-gan") || structure.includes("mis")) {
      picks.push("Windowed p-GaN HEMT - SDE 显式结构 (Thin-Long pGaN)");
    } else {
      picks.push("GaN HEMT - SDE 骨架");
    }
  }

  if (stage === "SProcess" || stage === "全链路") {
    picks.push("GaN HEMT - SProcess 骨架");
  }

  if (stage === "SDevice" || stage === "全链路") {
    if ((structure.includes("p-gan") || structure.includes("mis")) && targets.has("idvg")) {
      picks.push("Windowed p-GaN HEMT - SDevice IdVg (Vd=1V, Vg 0->6, step 0.05)");
    } else {
      picks.push("GaN HEMT - SDevice 骨架");
    }
  }

  if (picks.length === 0) {
    picks.push(
      "GaN HEMT - SDE 骨架",
      "GaN HEMT - SProcess 骨架",
      "GaN HEMT - SDevice 骨架"
    );
  }

  return uniqueKeepOrder(picks);
}

function placeholderDefaultsForTemplate(templateId, card = {}) {
  const convergenceFirst = String(card.keyConstraints || "").includes("收敛");

  const geometry = card.geometryParams || {};
  const process = card.processParams || {};
  const bias = card.biasParams || {};
  const fromAll = (aliases) =>
    pickByAliases(geometry, aliases) || pickByAliases(process, aliases) || pickByAliases(bias, aliases);

  const defaults = {
    tdr: "n@node@_des.tdr",
    parameter: "sdevice.par",
    plot: "n@node@_des.plt",
    tdrdat: "n@node@_des.tdrdat",
    log: "n@node@_des.log",
    AreaFactor:
      fromAll(["AreaFactor", "area_factor", "area", "af"]) || (convergenceFirst ? "1e3" : "1e3"),
  };

  const knownPar = (card.knownInputs || []).find((x) => /\.par$/i.test(String(x || "")));
  if (knownPar) {
    defaults.parameter = knownPar;
  }

  if (templateId === "gan-hemt-sprocess") {
    return {
      lgate: fromAll(["lg", "lgate", "gate_length", "gateLength"]) || "0.8",
      tbuffer: fromAll(["tbuffer", "buffer_thickness", "tbuf"]) || "2.5",
      tchannel: fromAll(["tchannel", "channel_thickness", "tch"]) || "0.3",
      tbarrier: fromAll(["tbarrier", "barrier_thickness", "tbar"]) || "0.02",
      dTime: fromAll(["dTime", "anneal_time", "activation_time"]) || (convergenceFirst ? "5" : "8"),
      dTemp:
        fromAll(["dTemp", "anneal_temp", "activation_temp"]) || (convergenceFirst ? "950" : "1000"),
      tgate: fromAll(["tgate", "pgan_thickness", "pgate_thickness"]) || "0.015",
      pGateMg: fromAll(["pGateMg", "mg", "magnesium", "pgate_mg"]) || "5e19",
    };
  }

  if (templateId === "gan-hemt-sdevice") {
    return {
      tdr: defaults.tdr,
      plot: defaults.plot,
      log: defaults.log,
      AreaFactor: defaults.AreaFactor,
    };
  }

  if (templateId === "windowed-pgan-hemt-sdevice-idvg") {
    return {
      tdr: defaults.tdr,
      parameter: defaults.parameter,
      plot: defaults.plot,
      tdrdat: defaults.tdrdat,
      log: defaults.log,
    };
  }

  return defaults;
}

function extractPlaceholders(content) {
  const text = String(content || "");
  const re = /@([A-Za-z0-9_]+)@/g;
  const names = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyPlaceholderValues(content, values = {}) {
  let out = String(content || "");
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`@${escapeRegExp(k)}@`, "g");
    out = out.replace(re, String(v));
  }
  return out;
}

function renderRequirementCardMarkdown(card, templateName, parameters = {}) {
  const c = card || {};
  const lines = [];
  lines.push("# RequirementCard");
  lines.push("");
  lines.push("```yaml");
  if (c.version) lines.push(`version: ${c.version}`);
  lines.push(`structure_type: ${c.structureType || "GaN HEMT"}`);
  lines.push(`sim_targets: [${(c.simTargets || []).map((x) => `"${x}"`).join(", ")}]`);
  lines.push(`deliver_stage: ${c.deliverStage || "SDevice"}`);
  lines.push(`key_constraints: ${c.keyConstraints || "收敛优先"}`);
  lines.push(`known_inputs: [${(c.knownInputs || []).map((x) => `"${x}"`).join(", ")}]`);
  lines.push(`output_style: ${c.outputStyle || "可直接替换块"}`);
  if (c.customNotes) {
    lines.push(`custom_notes: "${String(c.customNotes).replace(/"/g, "'")}"`);
  }
  lines.push(`selected_template: "${templateName || ""}"`);
  lines.push("```");
  lines.push("");

  if (c.structureAbstraction) {
    lines.push("## 结构抽象层（Structure Abstraction）");
    lines.push("");
    lines.push("| 字段 | 值 |");
    lines.push("|---|---|");
    lines.push(`| family | ${c.structureAbstraction.family || ""} |`);
    lines.push(`| transport | ${c.structureAbstraction.transport || ""} |`);
    lines.push(`| gateType | ${c.structureAbstraction.gateType || ""} |`);
    lines.push(`| hasFieldPlate | ${c.structureAbstraction.hasFieldPlate ? "true" : "false"} |`);
    lines.push(`| hasPassivation | ${c.structureAbstraction.hasPassivation ? "true" : "false"} |`);
    lines.push(`| polarization | ${c.structureAbstraction.polarization ? "true" : "false"} |`);
    lines.push("");
  }

  if ((c.structureHints || []).length) {
    lines.push("## 结构变更要点");
    lines.push("");
    for (const h of c.structureHints || []) {
      lines.push(`- ${h}`);
    }
    lines.push("");
  }

  const mapSections = [
    { title: "几何参数", data: c.geometryParams || {} },
    { title: "工艺参数", data: c.processParams || {} },
    { title: "偏置参数", data: c.biasParams || {} },
  ];

  for (const sec of mapSections) {
    const entries = Object.entries(sec.data || {});
    if (!entries.length) continue;
    lines.push(`## ${sec.title}`);
    lines.push("");
    lines.push("| 参数 | 值 |");
    lines.push("|---|---|");
    for (const [k, v] of entries) {
      lines.push(`| ${k} | ${v} |`);
    }
    lines.push("");
  }

  const keys = Object.keys(parameters || {});
  lines.push("## 模板参数");
  lines.push("");
  if (!keys.length) {
    lines.push("- 无占位参数（该模板可直接使用）。");
  } else {
    lines.push("| 参数 | 值 |");
    lines.push("|---|---|");
    keys.forEach((k) => lines.push(`| @${k}@ | ${parameters[k]} |`));
  }
  lines.push("");
  lines.push("## 说明");
  lines.push("");
  lines.push("- 本卡片用于记录本次需求槽位与模板参数，便于后续复现实验。 ");
  lines.push("- 若需更换目标（如 BV/Switching），请先更新 sim_targets 再重新生成。 ");
  return lines.join("\n");
}

module.exports = {
  STRUCTURE_OPTIONS,
  TARGET_OPTIONS,
  STAGE_OPTIONS,
  CONSTRAINT_OPTIONS,
  OUTPUT_STYLE_OPTIONS,
  createRequirementCard,
  createRequirementCardV2,
  recommendTemplateNames,
  placeholderDefaultsForTemplate,
  extractPlaceholders,
  applyPlaceholderValues,
  renderRequirementCardMarkdown,
  parseKeyValuePairs,
  normalizeStructureType,
};
