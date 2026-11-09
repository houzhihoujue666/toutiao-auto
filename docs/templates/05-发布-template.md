---
id: REL-NNNN
status: draft
owner:
created: YYYY-MM-DD
updated: YYYY-MM-DD
code_version: vX.Y.Z
---

# 发布记录

## 发布内容

- 对应变更包：`changes/NNNN-xxx/`
- CHANGELOG 分类：Added / Changed / Deprecated / Removed / Fixed / Security

## 发布步骤

1. 更新根 `CHANGELOG.md`（`Unreleased` → 新版本段）
2. 提交（Conventional Commits，正文写 `CHG-NNNN`）
3. 打 tag：`git tag vX.Y.Z` 并 push
4. 更新 `docs/INDEX.md` 变更总表

## 回滚方案

- 代码：`git revert <commit>` / 回退到上一个 tag
- 数据：是否需要回滚迁移 / 清 `data/`（说明影响）

## 实际结果与偏差

- 与设计/需求不一致的地方：**如实记录**（偏差不记，后面无从复盘）。
