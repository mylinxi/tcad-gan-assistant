# TCAD GaN Assistant

[English README](./README_EN.md)

面向 Sentaurus TCAD 工作流的本地化 VSCode 助手，重点覆盖 GaN HEMT 建模、知识检索、模板生成、日志诊断和收敛优化。

项目采用本地优先的 RAG 方案，把手册、官方案例、OCR 文本和个人经验沉淀为可检索、可引用、可复用的工程知识库。相比通用问答工具，它更关注 TCAD 场景里的真实工作链路，例如 SDE 结构搭建、SProcess 工艺步骤、SDevice 求解配置以及日志排错。

## 项目亮点

- 本地知识索引：支持 `PDF`、`HTML`、`TXT`、`CMD`、`TCL`、`PAR`、`PRF` 等资料统一解析、切片、建索引。
- 混合检索：提供 `lexical`、`vector`、`hybrid` 三种模式，兼顾关键词精确匹配和语义召回。
- 证据可追溯：检索结果返回证据片段、标签、来源类型和质量权重，方便回查原始资料。
- 需求驱动生成：通过 `RequirementCard` 描述结构类型、仿真目标、阶段和约束，自动联动模板推荐与参数填充。
- 案例差异改写：优先从官方实例中检索“语法载体文件”，再结合参数槽位做差异化改写。
- 日志诊断与收敛处方：对常见失败模式给出建议补丁，并输出分轮实验计划和最小回滚策略。
- OCR 流水线：针对大体积扫描 PDF 提供 OCR 辅助脚本，便于把原始资料纳入本地知识库。

## 典型使用场景

- 为 Sentaurus 手册、案例库和个人笔记建立统一的本地知识检索入口。
- 根据建模需求快速生成 GaN HEMT 的 SDE、SProcess、SDevice 起步模板。
- 针对 `IdVg`、`IdVd`、`BV`、`Switching`、`SelfHeating` 等目标组织案例和命令片段。
- 对 `_des.log`、`_des.out` 中的收敛错误做规则化分析，快速定位数值问题。
- 将扫描版 PDF 资料转成可检索文本，提高知识库覆盖度。

## 工作流

```text
本地资料库
  -> 文档解析与切片
  -> 标签推断与质量评分
  -> lexical / vector / hybrid 检索
  -> RequirementCard + 相似案例检索 + 模板填充
  -> 日志诊断 + 收敛策略 + Markdown 报告
```

## VSCode 命令入口

- `TCAD: 构建/重建知识索引`
- `TCAD: 查看索引处理状态`
- `TCAD: 检索手册与实例`
- `TCAD: 按建模需求生成（RequirementCard）`
- `TCAD: 一键插入 GaN 模板`
- `TCAD: 日志报错诊断`
- `TCAD: 收敛性处方建议`

## 目录结构

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

## 核心模块说明

- `src/extension.js`：VSCode 扩展入口，负责命令注册和整体编排。
- `src/indexer.js`：资料解析、切片、标签推断、质量评分、索引与状态报告生成。
- `src/search.js`：词法检索、向量检索和 hybrid 排序。
- `src/vector.js`：本地轻量向量化实现，使用 hashing + TF + L2 归一化。
- `src/requirement.js`：`RequirementCard` 定义、参数解析、模板推荐。
- `src/caseBased.js`：相似案例召回、证据筛选、槽位改写，是需求驱动生成的核心。
- `src/diagnostics.js`：日志模式识别和针对性修复片段建议。
- `src/prescription.js`：把诊断结果转成可执行的分轮实验计划。

## 检索与生成机制

- 索引阶段会对文本做分块、分词、标签推断和来源质量评估。
- 向量检索采用轻量本地实现，基于 hashing + term frequency + L2 normalization。
- `hybrid` 模式会融合词法分数和向量分数，并结合 `sourceQuality` 与 `noisePenalty` 调整最终排序。
- 生成阶段先依据 `RequirementCard` 检索相似案例，再选择适合当前阶段的模板和参数槽位进行填充。

## 配置项

在 VSCode 设置中搜索 `tcadAssistant`：

- `tcadAssistant.docsRoot`：知识库根目录，默认 `代码资料库/`
- `tcadAssistant.indexPath`：知识索引输出路径
- `tcadAssistant.statusPath`：索引状态报告输出路径
- `tcadAssistant.vectorIndexPath`：向量索引输出路径
- `tcadAssistant.retrievalMode`：`hybrid` / `lexical` / `vector`
- `tcadAssistant.hybridWeight`：混合检索中的词法权重
- `tcadAssistant.vectorDims`：向量维度
- `tcadAssistant.maxChunkChars`：切片长度
- `tcadAssistant.chunkOverlapChars`：切片重叠长度
- `tcadAssistant.maxFileSizeMB`：单文件解析上限
- `tcadAssistant.maxIndexedFiles`：最多索引文件数

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 基础检查

```bash
npm run check
```

3. 如需准备知识库，在仓库根目录创建 `代码资料库/`，并放入手册、案例或 OCR 文本。

4. 在 VSCode 中打开当前目录，按 `F5` 启动扩展开发宿主。

5. 打开命令面板，依次执行：

```text
TCAD: 构建/重建知识索引
TCAD: 检索手册与实例
TCAD: 按建模需求生成（RequirementCard）
```

## 开发与验证

- `npm run check`：检查核心文件是否存在，并做基础语法校验。
- `npm run smoke`：在存在 `代码资料库/` 的情况下，执行一轮索引、检索、诊断和案例检索验证。
- `npm run ocr:scanned`：对扫描 PDF 执行 OCR，输出到 `代码资料库/OCR文本/`。

## 项目现状

- 当前版本聚焦本地检索、模板生成和规则诊断，不自动执行 Sentaurus 仿真流程。
- 日志诊断和收敛建议以启发式规则为主，适合持续加入更多历史 case 进行扩展。
- 仓库默认提供扩展源码和辅助脚本，知识库内容可按实际工作环境自行挂载。
