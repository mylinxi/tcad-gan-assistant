const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const { resolveConfig } = require("./config");
const { buildKnowledgeIndex, loadKnowledgeIndex, loadIndexStatus } = require("./indexer");
const { searchKnowledge, formatResultsForPanel } = require("./search");
const { loadVectorIndex } = require("./vector");
const { listTemplateNames, getTemplateByName } = require("./templates");
const {
  STRUCTURE_OPTIONS,
  TARGET_OPTIONS,
  STAGE_OPTIONS,
  CONSTRAINT_OPTIONS,
  OUTPUT_STYLE_OPTIONS,
  createRequirementCardV2,
  recommendTemplateNames,
  placeholderDefaultsForTemplate,
  extractPlaceholders,
  applyPlaceholderValues,
  renderRequirementCardMarkdown,
} = require("./requirement");
const {
  retrieveSimilarCases,
  selectEvidenceByPolicy,
  resolveCaseFile,
  adaptContentByCard,
  formatEvidencePolicyMarkdown,
  formatCaseEvidenceMarkdown,
  formatRewriteSummaryMarkdown,
} = require("./caseBased");
const {
  diagnoseLog,
  formatDiagnosisReport,
  buildPatternEvidenceQuery,
} = require("./diagnostics");
const {
  buildConvergencePlan,
  formatConvergencePlanMarkdown,
} = require("./prescription");

let outputChannel;

function out() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("TCAD GaN Assistant");
  }
  return outputChannel;
}

function loggerInfo(message) {
  out().appendLine(`[INFO] ${message}`);
}

function loggerError(message) {
  out().appendLine(`[ERROR] ${message}`);
}

async function openMarkdown(content, title = "TCAD Assistant Report") {
  const doc = await vscode.workspace.openTextDocument({
    content,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  loggerInfo(`已打开报告: ${title}`);
}

async function ensureIndex(config) {
  const loaded = loadKnowledgeIndex(config.indexPath);
  const needVector = config.retrievalMode === "vector" || config.retrievalMode === "hybrid";
  const vectorExists = !needVector || fs.existsSync(config.vectorIndexPath);

  if (loaded && vectorExists) return loaded;

  const pick = await vscode.window.showWarningMessage(
    loaded
      ? `未找到向量索引: ${config.vectorIndexPath}，需要重建索引。`
      : `未找到知识索引: ${config.indexPath}`,
    "立即构建",
    "取消"
  );
  if (pick !== "立即构建") return null;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "TCAD: 正在构建知识索引...",
      cancellable: false,
    },
    async () => {
      await buildKnowledgeIndex(config, {
        info: loggerInfo,
        error: loggerError,
      });
    }
  );

  return loadKnowledgeIndex(config.indexPath);
}

function appendEvidenceSection(reportMd, evidenceResults, heading = "关联证据") {
  const lines = [reportMd, "", `## ${heading}`, ""];
  if (!evidenceResults || evidenceResults.length === 0) {
    lines.push("未检索到高相关证据片段。");
    return lines.join("\n");
  }

  evidenceResults.slice(0, 5).forEach((r, idx) => {
    lines.push(`### ${idx + 1}. ${r.relFile} (chunk ${r.chunkIndex}, score=${r.score})`);
    if (r.tags?.length) lines.push(`- 标签: ${r.tags.join(", ")}`);
    lines.push("```text");
    lines.push((r.evidence || "").trim());
    lines.push("```");
    lines.push("");
  });

  return lines.join("\n");
}

function buildBiasParamsFromPatterns(patterns = []) {
  const set = new Set((patterns || []).map((x) => String(x || "")));
  const out = {
    InitialStep: "1e-4",
    MaxStep: "0.02",
    MinStep: "1e-7",
  };

  if (set.has("avalanche_case")) {
    out.Vd = "600";
    out.Vg = "0";
    out.MaxStep = "0.01";
  } else {
    out.Vd = "1.0";
    out.Vg = "6.0";
  }

  if (set.has("nan_error")) {
    out.InitialStep = "1e-5";
    out.MaxStep = "0.01";
  }

  return out;
}

function inferStructureFromText(text = "") {
  const t = String(text || "").toLowerCase();
  if (/\bmis\b/.test(t) && /(p-gan|pgan)/.test(t)) return "MIS p-GaN";
  if (/(p-gan|pgan)/.test(t)) return "p-GaN HEMT";
  if (/schottky/.test(t)) return "Schottky";
  if (/vertical|mosfet/.test(t)) return "Vertical MOSFET";
  return "GaN HEMT";
}

function buildRewriteCardFromDiagnosis(report, logText = "", sourceLabel = "") {
  const patterns = report?.patterns || [];
  const hasAvalanche = patterns.includes("avalanche_case") || /\bbv\b|breakdown|avalanche/i.test(logText);
  const simTargets = hasAvalanche ? ["BV"] : ["IdVg"];
  const structureType = inferStructureFromText(logText);
  const hints = [];

  if (patterns.includes("rhs_explosion") || patterns.includes("not_converged")) {
    hints.push("收敛优先", "平滑偏置步长");
  }
  if (patterns.includes("nan_error")) {
    hints.push("提高数值精度", "低密度区域稳定化");
  }
  if (patterns.includes("avalanche_case")) {
    hints.push("高场区域稳健求解", "BV场景专用设置");
  }

  const biasParams = buildBiasParamsFromPatterns(patterns);
  const knownInputs = sourceLabel ? [sourceLabel] : [];

  return createRequirementCardV2({
    structureType,
    simTargets,
    deliverStage: "SDevice",
    keyConstraints: "收敛优先",
    outputStyle: "可直接替换块",
    knownInputs,
    structureHints: hints.join(", "),
    biasParams,
    customNotes: `Auto-derived from diagnosis patterns: ${(patterns || []).join(", ") || "none"}`,
  });
}

function chooseCaseForRewrite(evidenceCheck, retrieval) {
  const selected = Array.isArray(evidenceCheck?.selected) ? evidenceCheck.selected : [];
  if (selected.length > 0) return selected[0];
  const candidates = Array.isArray(retrieval?.candidates) ? retrieval.candidates : [];
  return candidates[0] || null;
}

function compactSnippet(content, maxLines = 140) {
  const lines = String(content || "").split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  const head = lines.slice(0, maxLines).join("\n");
  return `${head}\n# ... [truncated ${lines.length - maxLines} lines]`;
}

async function commandBuildKnowledgeIndex() {
  try {
    const config = resolveConfig();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "TCAD: 构建/重建知识索引",
        cancellable: false,
      },
      async () => {
        const index = await buildKnowledgeIndex(config, {
          info: loggerInfo,
          error: loggerError,
        });
        vscode.window.showInformationMessage(
          `索引完成：${index.metadata.docsCount} 文档，${index.metadata.chunksCount} 切片，向量维度=${config.vectorDims}。`
        );
      }
    );
  } catch (err) {
    loggerError(String(err?.stack || err));
    vscode.window.showErrorMessage(`构建索引失败: ${String(err?.message || err)}`);
  }
}

function formatStatusReport(status) {
  if (!status || !status.summary) {
    return "# 索引处理状态\n\n未找到状态报告，请先执行“TCAD: 构建/重建知识索引”。";
  }

  const s = status.summary;
  const lines = [];
  lines.push("# 索引处理状态报告");
  lines.push("");
  lines.push(`- 构建时间: ${s.builtAt}`);
  lines.push(`- 知识目录: ${s.docsRoot}`);
  lines.push(`- 扫描到支持类型文件: ${s.encounteredCount}`);
  lines.push(`- 已处理文件数: ${s.indexedCount}`);
  lines.push(`- 解析失败数: ${s.parseErrorCount}`);
  lines.push(`- 生成切片数: ${s.totalChunks}`);
  lines.push("");

  lines.push("## 配置快照");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(s.config || {}, null, 2));
  lines.push("```");
  lines.push("");

  lines.push("## 未处理原因统计");
  lines.push("");
  if (!status.skipped || status.skipped.length === 0) {
    lines.push("- 无。当前支持类型文件均已进入处理流程。\n");
  } else {
    for (const k of status.skipped) {
      if (k.reason === "max_indexed_files_limit") {
        lines.push(`- 文件数上限触发: ${k.count}（limit=${k.limit}）`);
      } else if (k.reason === "max_file_size_limit") {
        lines.push(`- 文件过大跳过: ${k.count}（limitMB=${k.limitMB}）`);
      } else {
        lines.push(`- ${k.reason}: ${k.count || 0}`);
      }
    }
    lines.push("");
  }

  lines.push("## 解析失败（最多前 50 项）");
  lines.push("");
  if (!status.parseErrors || status.parseErrors.length === 0) {
    lines.push("- 无。\n");
  } else {
    for (const e of status.parseErrors.slice(0, 50)) {
      lines.push(`- ${e.relFile} (${e.reason})`);
    }
    lines.push("");
  }

  lines.push("## 已处理文件明细（最多前 200 项）");
  lines.push("");
  lines.push("| 文件 | ext | sizeMB | indexed | parseError | chunks | tags |\n|---|---:|---:|---:|---:|---:|---|");
  for (const f of (status.processedFiles || []).slice(0, 200)) {
    lines.push(`| ${f.relFile} | ${f.ext} | ${f.sizeMB} | ${f.indexed ? "Y" : "N"} | ${f.hasParseError ? "Y" : "N"} | ${f.chunkCount} | ${(f.tags || []).join(", ")} |`);
  }
  lines.push("");
  lines.push("> 注：完整明细请直接查看 status.json 文件。\n");

  return lines.join("\n");
}

async function commandShowIndexStatus() {
  try {
    const config = resolveConfig();
    const status = loadIndexStatus(config.statusPath);
    const md = formatStatusReport(status);
    await openMarkdown(md, "索引处理状态报告");
  } catch (err) {
    loggerError(String(err?.stack || err));
    vscode.window.showErrorMessage(`打开索引状态失败: ${String(err?.message || err)}`);
  }
}

async function commandSearchKnowledge() {
  try {
    const config = resolveConfig();
    const index = await ensureIndex(config);
    if (!index) return;
    const vectorIndex = loadVectorIndex(config.vectorIndexPath);

    const query = await vscode.window.showInputBox({
      title: "TCAD 检索",
      prompt: "输入你要检索的内容，例如: GaN HEMT 收敛 RHS 1e10",
      placeHolder: "GaN HEMT / SDevice / convergence / avalanche ...",
    });

    if (!query || !query.trim()) return;

    const tagBoost = ["material:GaN"];
    if (/收敛|conver|rhs|nan|iteration|errref|precision/i.test(query)) {
      tagBoost.push("topic:Convergence", "stage:SDevice");
    }
    if (/sprocess|工艺|epi|扩散|activation/i.test(query)) {
      tagBoost.push("stage:SProcess");
    }
    if (/breakdown|avalanche|bv/i.test(query)) {
      tagBoost.push("topic:Breakdown");
    }

    const results = searchKnowledge(index, query, {
      topK: 8,
      requireEvidence: true,
      tagBoost,
      retrievalMode: config.retrievalMode,
      vectorIndex,
      hybridWeight: config.hybridWeight,
    });

    const md = formatResultsForPanel(query, results);
    await openMarkdown(md, "检索结果");

    if (!results.length) return;

    const pick = await vscode.window.showQuickPick(
      results.map((r) => ({
        label: r.relFile,
        description: `chunk ${r.chunkIndex} | score=${r.score}`,
        detail: (r.evidence || "").slice(0, 120),
        result: r,
      })),
      { title: "选择要打开的证据源文件（可选）" }
    );

    if (!pick?.result?.relFile) return;

    const targetPath = path.join(config.workspaceFolder, pick.result.relFile);
    if (fs.existsSync(targetPath)) {
      const doc = await vscode.workspace.openTextDocument(targetPath);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  } catch (err) {
    loggerError(String(err?.stack || err));
    vscode.window.showErrorMessage(`知识检索失败: ${String(err?.message || err)}`);
  }
}

async function commandInsertTemplate() {
  try {
    const names = listTemplateNames();
    const pickedName = await vscode.window.showQuickPick(names, {
      title: "选择要插入的 GaN 模板",
    });
    if (!pickedName) return;

    const tpl = getTemplateByName(pickedName);
    if (!tpl) return;

    const method = await vscode.window.showQuickPick(
      ["插入到当前编辑器", "新建文件保存"],
      { title: "选择插入方式" }
    );
    if (!method) return;

    if (method === "插入到当前编辑器") {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("没有活动编辑器，改为新建文件。 ");
      } else {
        await editor.edit((editBuilder) => {
          editBuilder.insert(editor.selection.active, tpl.content);
        });
        vscode.window.showInformationMessage(`已插入模板: ${pickedName}`);
        return;
      }
    }

    const config = resolveConfig();
    const defaultUri = vscode.Uri.file(
      path.join(config.workspaceFolder, tpl.suggestedFileName)
    );
    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: {
        "TCAD Command": ["cmd", "tcl", "txt"],
      },
    });
    if (!uri) return;

    fs.writeFileSync(uri.fsPath, tpl.content, "utf-8");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage(`模板已保存: ${uri.fsPath}`);
  } catch (err) {
    loggerError(String(err?.stack || err));
    vscode.window.showErrorMessage(`模板插入失败: ${String(err?.message || err)}`);
  }
}

async function pickMany(title, options, picked = []) {
  let current = Array.from(new Set(picked));
  while (true) {
    const remain = options.filter((o) => !current.includes(o));
    const labels = [...remain, "完成选择"];
    const pick = await vscode.window.showQuickPick(labels, {
      title: `${title}（已选 ${current.length}）`,
    });
    if (!pick || pick === "完成选择") break;
    current.push(pick);
  }
  return current;
}

async function askRequirementCard() {
  const structureType = await vscode.window.showQuickPick(STRUCTURE_OPTIONS, {
    title: "RequirementCard: 选择器件结构",
  });
  if (!structureType) return null;

  const simTargets = await pickMany("RequirementCard: 选择目标仿真", TARGET_OPTIONS, []);
  if (!simTargets.length) {
    vscode.window.showWarningMessage("未选择仿真目标，至少需选择 1 项。 ");
    return null;
  }

  const deliverStage = await vscode.window.showQuickPick(STAGE_OPTIONS, {
    title: "RequirementCard: 选择交付阶段",
  });
  if (!deliverStage) return null;

  const keyConstraints = await vscode.window.showQuickPick(CONSTRAINT_OPTIONS, {
    title: "RequirementCard: 选择约束偏好",
  });
  if (!keyConstraints) return null;

  const outputStyle = await vscode.window.showQuickPick(OUTPUT_STYLE_OPTIONS, {
    title: "RequirementCard: 选择输出风格",
  });
  if (!outputStyle) return null;

  const knownInputsRaw = await vscode.window.showInputBox({
    title: "RequirementCard: 已有输入（可选）",
    prompt: "可输入已有文件或说明，逗号分隔，例如 sdevice.par, 旧log, 已有tdr",
    placeHolder: "sdevice.par, run1_des.log",
  });

  const structureHintsRaw = await vscode.window.showInputBox({
    title: "RequirementCard: 结构变更要点（可选）",
    prompt: "用于描述结构变化，例如: 增加场板, 改MIS栅, 双沟道, 去掉钝化",
    placeHolder: "增加 field plate, gate 改成 MIS, barrier 厚度调整",
  });

  const geometryParamsRaw = await vscode.window.showInputBox({
    title: "RequirementCard: 几何参数（可选）",
    prompt: "key=value 形式，逗号分隔，例如 lg=1.2,lsg=0.8,lgd=4.0",
    placeHolder: "lg=1.2,lsg=0.8,lgd=4.0,tbarrier=0.02",
  });

  const processParamsRaw = await vscode.window.showInputBox({
    title: "RequirementCard: 工艺参数（可选）",
    prompt: "key=value 形式，逗号分隔，例如 dTemp=950,pGateMg=5e19",
    placeHolder: "dTime=5,dTemp=950,pGateMg=5e19",
  });

  const biasParamsRaw = await vscode.window.showInputBox({
    title: "RequirementCard: 偏置参数（可选）",
    prompt: "key=value 形式，逗号分隔，例如 Vd=1.0,Vg=6.0,InitialStep=1e-4",
    placeHolder: "Vd=1.0,Vg=6.0,InitialStep=1e-4,MaxStep=0.02",
  });

  const customNotes = await vscode.window.showInputBox({
    title: "RequirementCard: 备注（可选）",
    prompt: "例如：优先稳健收敛，允许速度慢一些",
    placeHolder: "先确保收敛，再追求速度",
  });

  return createRequirementCardV2({
    structureType,
    simTargets,
    deliverStage,
    keyConstraints,
    outputStyle,
    knownInputs: knownInputsRaw || "",
    structureHints: structureHintsRaw || "",
    geometryParams: geometryParamsRaw || "",
    processParams: processParamsRaw || "",
    biasParams: biasParamsRaw || "",
    customNotes: customNotes || "",
  });
}

async function askTemplateParameters(templateName, templateObj, card) {
  const templateId = templateObj?.id || "";
  const defaults = placeholderDefaultsForTemplate(templateId, card);
  const placeholders = extractPlaceholders(templateObj?.content || "");
  if (!placeholders.length) {
    return {
      values: {},
      rendered: templateObj?.content || "",
    };
  }

  const values = {};
  for (const ph of placeholders) {
    const v = await vscode.window.showInputBox({
      title: `模板参数: @${ph}@`,
      prompt: `为模板“${templateName}”填写 @${ph}@`,
      value: String(defaults[ph] ?? ""),
      ignoreFocusOut: true,
    });
    if (v === undefined) {
      return null;
    }
    values[ph] = v;
  }

  return {
    values,
    rendered: applyPlaceholderValues(templateObj.content, values),
  };
}

async function commandGenerateByRequirement() {
  try {
    const config = resolveConfig();
    const index = await ensureIndex(config);
    if (!index) return;
    const vectorIndex = loadVectorIndex(config.vectorIndexPath);

    const card = await askRequirementCard();
    if (!card) return;

    const retrieval = retrieveSimilarCases(index, card, {
      vectorIndex,
      retrievalMode: config.retrievalMode,
      hybridWeight: config.hybridWeight,
      topK: 6,
    });
    const evidenceCheck = selectEvidenceByPolicy(retrieval, card.evidencePolicy || {});

    if (!evidenceCheck.pass) {
      const reason = (evidenceCheck.violations || []).join(", ") || "evidence_policy_failed";
      vscode.window.showErrorMessage(`证据约束不满足，已停止生成: ${reason}`);
      return;
    }

    const picks = [];
    const byRelFile = new Map();
    const candidatePool = [
      ...(evidenceCheck.selected || []),
      ...(retrieval.candidates || []),
    ];
    for (const c of candidatePool) {
      if (!c?.relFile) continue;
      if (!/\.(cmd|par|tcl|prf|txt|md|rst)$/i.test(String(c.relFile))) continue;
      if (byRelFile.has(c.relFile)) continue;
      byRelFile.set(c.relFile, c);
      picks.push({
        label: `案例: ${c.relFile}`,
        description: `merged=${c.mergedScore} | ${c.sourceType || "unknown"}`,
        detail: (c.evidence || "").slice(0, 140),
        type: "case",
        value: c.relFile,
      });
    }

    const templateCandidates = recommendTemplateNames(card);
    for (const t of templateCandidates) {
      picks.push({
        label: `模板: ${t}`,
        description: "内置模板",
        detail: "当相似案例不理想时使用模板回退",
        type: "template",
        value: t,
      });
    }

    if (!picks.length) {
      vscode.window.showWarningMessage("未找到可用案例或模板。请先检查索引。");
      return;
    }

    const chosen = await vscode.window.showQuickPick(picks, {
      title: "按 RequirementCard 选择生成来源（相似案例优先）",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!chosen) return;

    let rendered = "";
    let summaryMd = "";

    if (chosen.type === "case") {
      const relFile = chosen.value;
      const selected = byRelFile.get(relFile);
      const resolved = resolveCaseFile(index, config.workspaceFolder, relFile);
      if (!resolved?.text) {
        vscode.window.showErrorMessage(`无法读取案例文件: ${relFile}`);
        return;
      }

      const adapt = adaptContentByCard(resolved.text, card, {
        sourceRelFile: relFile,
      });
      rendered = adapt.content;

      const cardMd = renderRequirementCardMarkdown(card, `case:${relFile}`, {});
      const policyMd = formatEvidencePolicyMarkdown(evidenceCheck, card.evidencePolicy || {});
      const evidenceMd = formatCaseEvidenceMarkdown(
        {
          ...retrieval,
          candidates: [
            ...((evidenceCheck.selected || []).filter((x) => x?.relFile === relFile)),
            ...(evidenceCheck.selected || []).filter((x) => x?.relFile !== relFile),
            ...(retrieval.candidates || []).filter((x) => x.relFile !== relFile),
          ],
        },
        5
      );
      const rewriteMd = formatRewriteSummaryMarkdown(adapt);
      summaryMd = [cardMd, "", policyMd, "", evidenceMd, "", rewriteMd].join("\n");
    } else {
      const pickedName = chosen.value;
      const tpl = getTemplateByName(pickedName);
      if (!tpl) {
        vscode.window.showErrorMessage(`模板不存在: ${pickedName}`);
        return;
      }

      const withParams = await askTemplateParameters(pickedName, tpl, card);
      if (!withParams) return;

      rendered = withParams.rendered;
      const cardMd = renderRequirementCardMarkdown(card, pickedName, withParams.values);
      const policyMd = formatEvidencePolicyMarkdown(evidenceCheck, card.evidencePolicy || {});
      const evidenceMd = formatCaseEvidenceMarkdown(retrieval, 5);
      summaryMd = [cardMd, "", policyMd, "", evidenceMd].join("\n");
    }

    await openMarkdown(summaryMd, "RequirementCard");

    const method = await vscode.window.showQuickPick(
      ["插入到当前编辑器", "新建文件保存"],
      { title: "选择生成结果落地方式" }
    );
    if (!method) return;

    if (method === "插入到当前编辑器") {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("没有活动编辑器，改为新建文件。 ");
      } else {
        await editor.edit((editBuilder) => {
          editBuilder.insert(editor.selection.active, rendered);
        });
        vscode.window.showInformationMessage("已按 RequirementCard 生成并插入当前编辑器");
        return;
      }
    }

    const defaultFile =
      chosen.type === "case"
        ? `generated_${String(card.deliverStage || "SDevice").toLowerCase()}_from_case.cmd`
        : "generated_by_requirement.cmd";
    const defaultUri = vscode.Uri.file(path.join(config.workspaceFolder, defaultFile));
    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: {
        "TCAD Command": ["cmd", "tcl", "txt"],
      },
    });
    if (!uri) return;

    fs.writeFileSync(uri.fsPath, rendered, "utf-8");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage(`已按 RequirementCard 生成模板: ${uri.fsPath}`);
  } catch (err) {
    loggerError(String(err?.stack || err));
    vscode.window.showErrorMessage(`需求驱动生成失败: ${String(err?.message || err)}`);
  }
}

async function readActiveOrPickFile() {
  const active = vscode.window.activeTextEditor;
  if (active && active.document) {
    const useActive = await vscode.window.showQuickPick(
      ["使用当前编辑器内容", "选择日志文件"],
      {
        title: "日志来源",
      }
    );
    if (useActive === "使用当前编辑器内容") {
      return {
        source: active.document.fileName || "untitled",
        text: active.document.getText(),
      };
    }
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "Log/Out/TXT": ["log", "out", "txt", "cmd"],
      All: ["*"],
    },
  });
  if (!picked || picked.length === 0) {
    return null;
  }
  const filePath = picked[0].fsPath;
  return {
    source: filePath,
    text: fs.readFileSync(filePath, "utf-8"),
  };
}

async function commandDiagnoseLog() {
  try {
    const input = await readActiveOrPickFile();
    if (!input) return;

    const report = diagnoseLog(input.text);
    let md = `来源: ${input.source}\n\n` + formatDiagnosisReport(report);

    const config = resolveConfig();
    const index = loadKnowledgeIndex(config.indexPath);
    const vectorIndex = loadVectorIndex(config.vectorIndexPath);
    if (index) {
      const q = buildPatternEvidenceQuery(report.patterns);
      const evidence = searchKnowledge(index, q, {
        topK: 5,
        requireEvidence: true,
        tagBoost: ["material:GaN", "topic:Convergence", "stage:SDevice"],
        retrievalMode: config.retrievalMode,
        vectorIndex,
        hybridWeight: config.hybridWeight,
      });
      md = appendEvidenceSection(md, evidence, "相关官方/本地证据片段");

      const rewriteCard = buildRewriteCardFromDiagnosis(report, input.text, input.source);
      const rewriteRetrieval = retrieveSimilarCases(index, rewriteCard, {
        vectorIndex,
        retrievalMode: config.retrievalMode,
        hybridWeight: config.hybridWeight,
        topK: 6,
      });
      const rewriteEvidence = selectEvidenceByPolicy(
        rewriteRetrieval,
        rewriteCard.evidencePolicy || {}
      );
      const policyMd = formatEvidencePolicyMarkdown(
        rewriteEvidence,
        rewriteCard.evidencePolicy || {}
      );

      const chosenCase = chooseCaseForRewrite(rewriteEvidence, rewriteRetrieval);
      if (chosenCase?.relFile) {
        const resolved = resolveCaseFile(index, config.workspaceFolder, chosenCase.relFile);
        if (resolved?.text) {
          const adapt = adaptContentByCard(resolved.text, rewriteCard, {
            sourceRelFile: chosenCase.relFile,
          });
          const cardMd = renderRequirementCardMarkdown(
            rewriteCard,
            `diagnosis:${chosenCase.relFile}`,
            {}
          );
          const caseEvidenceMd = formatCaseEvidenceMarkdown(
            {
              ...rewriteRetrieval,
              candidates: [
                chosenCase,
                ...(rewriteEvidence.selected || []).filter(
                  (x) => x?.relFile && x.relFile !== chosenCase.relFile
                ),
                ...(rewriteRetrieval.candidates || []).filter(
                  (x) => x.relFile !== chosenCase.relFile
                ),
              ],
            },
            5
          );
          const rewriteMd = formatRewriteSummaryMarkdown(adapt);
          const snippet = compactSnippet(adapt.content, 140);

          md += "\n\n## 诊断回流改写建议\n\n";
          md += [cardMd, "", policyMd, "", caseEvidenceMd, "", rewriteMd].join("\n");
          md += "\n\n### 建议替换片段（截断预览）\n\n```tcad\n";
          md += snippet;
          md += "\n```\n";
        }
      }
    }

    await openMarkdown(md, "日志诊断报告");
  } catch (err) {
    loggerError(String(err?.stack || err));
    vscode.window.showErrorMessage(`日志诊断失败: ${String(err?.message || err)}`);
  }
}

async function commandConvergencePrescription() {
  try {
    const symptom = await vscode.window.showInputBox({
      title: "输入收敛问题症状",
      prompt: "例如：RHS 爆炸，第一步就不收敛，出现 NAN，BV 难收敛",
      placeHolder: "RHS 1e10 / NAN / did not converge / GradQuasiFermi ...",
    });
    if (!symptom || !symptom.trim()) return;

    const pseudoReport = diagnoseLog(symptom);
    let md = `# 收敛性处方建议\n\n症状: ${symptom}\n\n`;
    md += formatDiagnosisReport(pseudoReport);
    md += "\n" + formatConvergencePlanMarkdown(
      buildConvergencePlan({ symptom, patterns: pseudoReport.patterns })
    );

    const config = resolveConfig();
    const index = await ensureIndex(config);
    const vectorIndex = loadVectorIndex(config.vectorIndexPath);
    if (index) {
      const evidence = searchKnowledge(index, symptom, {
        topK: 5,
        requireEvidence: true,
        tagBoost: ["material:GaN", "topic:Convergence", "stage:SDevice"],
        retrievalMode: config.retrievalMode,
        vectorIndex,
        hybridWeight: config.hybridWeight,
      });
      md = appendEvidenceSection(md, evidence, "可参考的证据与模板片段");
    }

    await openMarkdown(md, "收敛处方报告");
  } catch (err) {
    loggerError(String(err?.stack || err));
    vscode.window.showErrorMessage(`收敛处方失败: ${String(err?.message || err)}`);
  }
}

function activate(context) {
  loggerInfo("TCAD GaN Assistant 已激活。");

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tcadAssistant.buildKnowledgeIndex",
      commandBuildKnowledgeIndex
    ),
    vscode.commands.registerCommand(
      "tcadAssistant.searchKnowledge",
      commandSearchKnowledge
    ),
    vscode.commands.registerCommand(
      "tcadAssistant.showIndexStatus",
      commandShowIndexStatus
    ),
    vscode.commands.registerCommand(
      "tcadAssistant.insertTemplate",
      commandInsertTemplate
    ),
    vscode.commands.registerCommand(
      "tcadAssistant.generateByRequirement",
      commandGenerateByRequirement
    ),
    vscode.commands.registerCommand(
      "tcadAssistant.diagnoseLog",
      commandDiagnoseLog
    ),
    vscode.commands.registerCommand(
      "tcadAssistant.convergencePrescription",
      commandConvergencePrescription
    )
  );
}

function deactivate() {
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = undefined;
  }
}

module.exports = {
  activate,
  deactivate,
};
