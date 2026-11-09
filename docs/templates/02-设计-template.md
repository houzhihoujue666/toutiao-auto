---
id: DEC-NNNN
status: draft
owner:
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# 设计：标题

> 章节对齐 Google Design Doc：重点是**权衡**，不是实现手册。

## Context and Scope

客观背景与范围（不是需求文档），需要读者具备的前置知识。

## Goals / Non-Goals

- Goals：……
- Non-Goals：（本来可以是目标、但明确放弃的）……

## 方案

先给概览，再给细节。写清数据与状态怎么流。

## Alternatives Considered

| 方案 | 优点 | 缺点 | 未选原因 |
| ---- | ---- | ---- | -------- |
| A    |      |      |          |
| B    |      |      |          |

## 横切关注点

- 风控与限速：
- 幂等与不可逆动作：
- 合规（声明 / 首发）：
- 数据脱敏与敏感信息：
- 可观测性（日志 / 告警）：

## 影响的文件清单

- `path/to/file.ts` —— 改什么

## 需要新决策吗

若存在难逆转的取舍 → 在 `docs/decisions/` 写 ADR，并在此链接。
