# Repository Notes

本文件用于补充仓库结构和开源整理要点，方便后续维护或继续扩展。

## 仓库主体

当前仓库主要包含三部分：

- `src/`：VSCode 扩展核心逻辑
- `scripts/`：检查、smoke 验证和 OCR 辅助脚本
- `README`、`package.json`、`.gitignore`：项目说明与基础配置

## 最具代表性的核心文件

- `src/extension.js`
- `src/indexer.js`
- `src/search.js`
- `src/vector.js`
- `src/requirement.js`
- `src/caseBased.js`
- `src/diagnostics.js`
- `src/prescription.js`

这些文件基本覆盖了项目的三条主线：本地 RAG、需求驱动生成、日志诊断与收敛建议。

## 本地工作区约定

- 默认知识库目录为仓库根目录下的 `代码资料库/`
- 索引、状态报告、OCR 缓存等运行时产物输出到 `.tcad-assistant/`
- `npm run smoke` 和 `npm run ocr:scanned` 在存在本地资料库时效果最佳

## 适合继续补充的内容

- 一组可公开的示例资料或最小样例知识库
- 扩展运行截图或命令演示图
- 更完整的诊断规则样例
- 模板生成前后对比示例

## 发布前检查

```bash
npm install
npm run check
git status
```

如果需要同步到 GitHub：

```bash
git add .
git commit -m "Update documentation"
git push
```
