---
id: VER-NNNN
status: draft
owner:
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# 验证记录

## 验收对照

| 需求 ID     | 验收标准 | 验证方式                   | 结果 |
| ----------- | -------- | -------------------------- | ---- |
| REQ-NNNN-01 | ……       | 前端测试 / 接口测试 / 手工 | ✅   |
| REQ-NNNN-02 | ……       |                            | ✅   |

## 测试

| 层   | 文件                                    | 新增用例 |
| ---- | --------------------------------------- | -------- |
| 前端 | `frontend/tests/xxx.test.tsx`           | ……       |
| 后端 | `backend/tests/integration/xxx.test.ts` | ……       |

## 执行命令与结果

```bash
npm run typecheck   # ✅
npm test            # ✅ xxx passed
```

## 遗留问题

- （本次未解决、登记到下一包或 `postmortem/`）
