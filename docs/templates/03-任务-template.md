---
id: TASK-NNNN
status: draft
owner:
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# 任务分解

按用户故事组织，标依赖与对应需求 ID，实现时逐条勾选。

## 用户故事 1：……

- [ ] TASK-01 「……」需求：REQ-NNNN-01 依赖：无 文件：`path`
  - [ ] 写测试
  - [ ] 实现
  - [ ] 自测

## 用户故事 2：……

- [ ] TASK-02 「……」需求：REQ-NNNN-02 依赖：TASK-01 文件：`path`

## 完成判定

- [ ] 每条需求 ID 都有对应任务
- [ ] 任务之间有明确依赖顺序
- [ ] 契约（`shared/`）已先落地
