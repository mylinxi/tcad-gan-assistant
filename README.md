# TCAD GaN Assistant

[English README](./README_EN.md)

这是一个面向 Sentaurus TCAD 工作流的本地化 VSCode 助手，重点服务于 GaN HEMT 建模、检索、模板生成、日志诊断和收敛优化。

这个仓库的核心目标不是做一个“通用聊天机器人”，而是把本地的官方手册、案例工程、OCR 文本和个人经验笔记组织成一个真正能辅助 TCAD 工程工作的本地 RAG 工具。

## 核心能力

- 本地知识索引：扫描 `PDF / HTML / TXT / CMD / TCL / PAR / PRF` 等资料，完成切片、标签推断和索引构建。
- 混合检索：支持 `lexical`、`vector`、`hybrid` 三种检索模式，并返回证据片段。
- 需求驱动生成：基于 `RequirementCard` 自动推荐模板、检索相似案例并做参数化改写。
- 日志诊断：识别 `RHS 爆炸`、`NAN`、`GradQuasiFermi`、`Avalanche`、线性求解器问题等典型模式。
- 收敛处方：生成“分轮实验 + 最小回滚”的策略，而不是只给一句泛泛建议。

## 这次为什么看起来文件少

如果你之前看到的只有两三个文件，那是因为我先帮你做了一个“GitHub 提炼包”，只放了说明文件，还没把源码本体拷过来。

现在这个目录已经补上了项目的核心源码，包括：

- `src/`：主要业务逻辑
- `scripts/`：检查脚本、smoke 脚本、OCR 脚本
- `package.json` / `package-lock.json`
- 中文 `README.md`
- 英文 `README_EN.md`
- `.gitignore`

## 为什么没有把所有原始内容都搬进来

这不是“项目只有这些”，而是我有意把不适合直接开源上传的内容排除了：

- `代码资料库/`：通常包含官方文档、示例或你自己的资料，可能有版权或隐私问题
- `.tcad-assistant/`：本地生成的索引、向量索引、OCR 缓存和状态报告
- `node_modules/`：依赖安装产物
- `*.vsix`：本地打包产物
- 临时草稿和中间报告文件

也就是说：核心代码已经在这里了，但“大体积资料库”和“本地产物”没有一起带过来，这是正常的 GitHub 仓库整理方式。

## 工作流

```text
本地资料库
  -> 文档解析与切片
  -> 标签推断与质量评分
  -> lexical / vector / hybrid 检索
  -> RequirementCard + 相似案例检索 + 模板填充
  -> 日志诊断 + 收敛策略 + Markdown 报告
```

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

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 基础检查

```bash
npm run check
```

3. 在 VSCode 中打开当前目录，按 `F5` 启动扩展开发宿主。

## 说明

- 默认知识库目录约定为仓库根目录下的 `代码资料库/`
- 如果你暂时不上传资料库，也不影响先上传源码仓库
- 后续你可以再按需要把可公开的示例资料单独补进来
