const path = require("path");
const vscode = require("vscode");

function getWorkspaceFolder() {
  const ws = vscode.workspace.workspaceFolders;
  if (!ws || ws.length === 0) {
    return null;
  }
  return ws[0].uri.fsPath;
}

function resolveWorkspaceVar(value, workspaceFolder) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{workspaceFolder\}/g, workspaceFolder || "");
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeRetrievalMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "vector" || mode === "hybrid" || mode === "lexical") {
    return mode;
  }
  return "hybrid";
}

function resolveConfig() {
  const cfg = vscode.workspace.getConfiguration("tcadAssistant");
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    throw new Error("未打开工作区，无法读取 tcadAssistant 配置。");
  }

  const docsRootRaw = cfg.get("docsRoot", "${workspaceFolder}/代码资料库");
  const indexPathRaw = cfg.get(
    "indexPath",
    "${workspaceFolder}/.tcad-assistant/index.json"
  );
  const statusPathRaw = cfg.get(
    "statusPath",
    "${workspaceFolder}/.tcad-assistant/index-status.json"
  );
  const vectorIndexPathRaw = cfg.get(
    "vectorIndexPath",
    "${workspaceFolder}/.tcad-assistant/vector-index.json"
  );

  const docsRoot = path.normalize(resolveWorkspaceVar(docsRootRaw, workspaceFolder));
  const indexPath = path.normalize(
    resolveWorkspaceVar(indexPathRaw, workspaceFolder)
  );
  const statusPath = path.normalize(
    resolveWorkspaceVar(statusPathRaw, workspaceFolder)
  );
  const vectorIndexPath = path.normalize(
    resolveWorkspaceVar(vectorIndexPathRaw, workspaceFolder)
  );

  const retrievalMode = normalizeRetrievalMode(cfg.get("retrievalMode", "hybrid"));
  const vectorDims = Math.round(clampNumber(cfg.get("vectorDims", 384), 32, 4096, 384));
  const hybridWeight = clampNumber(cfg.get("hybridWeight", 0.62), 0, 1, 0.62);

  return {
    workspaceFolder,
    docsRoot,
    indexPath,
    statusPath,
    vectorIndexPath,
    retrievalMode,
    vectorDims,
    hybridWeight,
    maxChunkChars: Number(cfg.get("maxChunkChars", 1200)),
    chunkOverlapChars: Number(cfg.get("chunkOverlapChars", 180)),
    maxFileSizeMB: Number(cfg.get("maxFileSizeMB", 50)),
    maxIndexedFiles: Number(cfg.get("maxIndexedFiles", 4000)),
  };
}

module.exports = {
  getWorkspaceFolder,
  resolveConfig,
};
