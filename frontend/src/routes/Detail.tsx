import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ReviewPane } from '../components/ReviewPane';
import { useStore } from '../state/store';
import {
  createTasks,
  deleteTask,
  fetchItems,
  fetchTaskDetail,
  fetchTasks,
  retryTask,
} from '../lib/api';
import { SIMILARITY_THRESHOLD } from '@shared/constants';
import { errorHint, errorSpec, errorText } from '@shared/errors';
import type { SourceItem, Task, TaskStatus } from '@shared/types';

type ListType = 'items' | 'reviewing' | 'queue' | 'published' | 'failed' | 'all';

/** CHG-0002：任务归属账号显示成名字，而不是让人去猜 #id 是谁 */
function useAccountNames(): Record<number, string> {
  const { accounts } = useStore();
  const map: Record<number, string> = {};
  for (const a of accounts) map[a.id] = a.name;
  return map;
}

const TABS: { id: ListType; label: string }[] = [
  { id: 'items', label: '素材池' },
  { id: 'reviewing', label: '待复核' },
  { id: 'queue', label: '待发布' },
  { id: 'published', label: '已发布' },
  { id: 'failed', label: '失败' },
  { id: 'all', label: '全部任务' },
];

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待处理',
  fetched: '改写中',
  rewritten: '待质检',
  reviewing: '待复核',
  publishing: '发布中',
  published: '已发布',
  failed: '失败',
};

const STATUS_TONE: Record<TaskStatus, string> = {
  pending: '',
  fetched: 'badge-indigo',
  rewritten: 'badge-indigo',
  reviewing: 'badge-amber',
  publishing: 'badge-indigo',
  published: 'badge-teal',
  failed: 'badge-red',
};

function TableStatusFilter(type: ListType): TaskStatus | undefined {
  switch (type) {
    case 'reviewing':
      return 'reviewing';
    case 'queue':
      return 'publishing';
    case 'published':
      return 'published';
    case 'failed':
      return 'failed';
    default:
      return undefined;
  }
}

/**
 * 失败原因：错误码翻成人话（附录 D 唯一口径）。
 * 相似度能拿到实际值时直接写进原因，避免用户只看到「SIMILARITY」还要自己去对照。
 */
function failureReason(code: string | null, similarity?: number): { text: string; hint: string } {
  if (!code) return { text: '未记录失败原因', hint: '' };
  if (code === 'SIMILARITY') {
    const gate = SIMILARITY_THRESHOLD.toFixed(2);
    return {
      text:
        similarity !== undefined
          ? `相似度 ${similarity.toFixed(2)} 超过 ${gate} 闸门，已拦截`
          : `相似度超过 ${gate} 闸门，已拦截`,
      hint: errorHint(code),
    };
  }
  // 带上阶段（改写 / 质检 / 发布…），光看「无成功标志」不知道是哪一步出的问题
  const spec = errorSpec(code);
  const phase = spec && spec.phase !== '任意' && spec.phase !== '接口' ? `${spec.phase}：` : '';
  return { text: `${phase}${errorText(code)}`, hint: errorHint(code) };
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

/** 明细 —— §3.4：/list/:type，六种片；数字既是状态也是入口 */
export function Detail(): React.ReactNode {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const { summary, accounts, activeId, switchAccount, summaryLoaded, notify, refresh, version } = useStore();
  const listType = (TABS.some((t) => t.id === type) ? type : 'reviewing') as ListType;
  const accountNames = useAccountNames();

  const [items, setItems] = useState<SourceItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [similarities, setSimilarities] = useState<Record<number, number>>({});

  useEffect(() => {
    // CHG-0002：先知道「当前是哪个账号」再取列表，避免 summary 到达后又多拉一次
    if (!summaryLoaded) return;
    void (async () => {
      // CHG-0002：素材池与任务都按当前账号取，切换账号后这里的依赖会触发重取
      if (listType === 'items') {
        const r = await fetchItems(activeId);
        setItems(r.items);
        setTasks([]);
      } else {
        const t = await fetchTasks(TableStatusFilter(listType), activeId);
        setTasks(t);
        setItems([]);
      }
    })().catch((e: unknown) => notify('bad', '加载失败', (e as Error).message));
    // version：后端通过 WS 推来任务状态变化时重取列表，避免「计数有了、列表还是空的」
  }, [listType, notify, version, activeId, summaryLoaded]);

  // 列表接口只给任务，相似度需要按任务取（取前 20 条，够看）
  useEffect(() => {
    if (listType === 'items' || tasks.length === 0) {
      setSimilarities({});
      return;
    }
    let alive = true;
    void Promise.all(tasks.slice(0, 20).map((t) => fetchTaskDetail(t.id).catch(() => null))).then(
      (list) => {
        if (!alive) return;
        const map: Record<number, number> = {};
        for (const d of list) if (d?.rewrite) map[d.task.id] = d.rewrite.similarity;
        setSimilarities(map);
      },
    );
    return () => {
      alive = false;
    };
  }, [tasks, listType]);

  const counts = useMemo(() => {
    const c = summary?.counts;
    return {
      items: c?.items ?? 0,
      reviewing: c?.reviewing ?? 0,
      queue: c?.queue ?? 0,
      published: c?.publishedToday ?? 0,
      failed: c?.failed ?? 0,
      all: undefined,
    } as Record<ListType, number | undefined>;
  }, [summary]);

  const onCreateTasks = async () => {
    setBusy(true);
    try {
      // CHG-0002：建出来的任务归属当前账号
      const r = await createTasks(selected, activeId);
      notify('ok', `已生成 ${r.created} 个任务`, '改写与配图会自动推进，完成后出现在「待复核」');
      setSelected([]);
      await refresh();
      if (r.created > 0) navigate('/list/reviewing');
    } catch (e) {
      notify('bad', '生成任务失败', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onRetry = async (id: number) => {
    try {
      await retryTask(id);
      notify('info', `任务 #${id} 已重试`, '回到队列重新改写');
      await refresh();
      setTasks(await fetchTasks(TableStatusFilter(listType), activeId));
    } catch (e) {
      notify('bad', '重试失败', (e as Error).message);
    }
  };

  const onDelete = async (id: number) => {
    // 删除会连改写稿 / 发布记录 / 日志一起清掉，必须二次确认
    if (!window.confirm(`删除任务 #${id}？改写稿、发布记录与日志会一并清除，不可恢复。`)) return;
    try {
      await deleteTask(id);
      notify('ok', `任务 #${id} 已删除`, '失败列表里不再显示这一条');
      await refresh();
      setTasks(await fetchTasks(TableStatusFilter(listType), activeId));
    } catch (e) {
      notify('bad', '删除失败', (e as Error).message);
    }
  };

  return (
    <main className="view">
      <div className="row" style={{ marginBottom: 14 }}>
        <select
          className="sel"
          aria-label="切换账号"
          data-testid="detail-account-switch"
          value={activeId}
          onChange={(e) => void switchAccount(Number(e.target.value))}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.id === activeId ? '（当前）' : ''}
            </option>
          ))}
        </select>
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab${t.id === listType ? ' is-on' : ''}`}
              onClick={() => navigate(`/list/${t.id}`)}
            >
              {t.label}
              {counts[t.id] !== undefined && <span className="tab-n">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => void refresh()}>
          <Icon name="i-refresh" />
          刷新
        </button>
      </div>

      {reviewId && (
        <div style={{ marginBottom: 16 }}>
          <ReviewPane
            taskId={reviewId}
            notify={notify}
            onClose={() => setReviewId(null)}
            onDone={() => {
              setReviewId(null);
              void refresh();
              void fetchTasks(TableStatusFilter(listType)).then(setTasks);
            }}
          />
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h3>{TABS.find((t) => t.id === listType)?.label}</h3>
          <span className="sub">
            {listType === 'items'
              ? '勾选后生成任务；已自动去重'
              : '点击「复核」查看原文与改写稿并决定放行'}
          </span>
          <span className="spacer" />
          {listType === 'items' && (
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || selected.length === 0}
              onClick={() => void onCreateTasks()}
            >
              <Icon name="i-bolt" />
              生成任务{selected.length > 0 ? `（${selected.length}）` : ''}
            </button>
          )}
        </div>
        <div className="card-b flush">
          {listType === 'items' ? (
            <ItemsTable items={items} selected={selected} setSelected={setSelected} />
          ) : (
            <TasksTable
              tasks={tasks}
              listType={listType}
              similarities={similarities}
              accountNames={accountNames}
              multiAccount={accounts.length > 1}
              onReview={setReviewId}
              onRetry={(id) => void onRetry(id)}
              onDelete={(id) => void onDelete(id)}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function ItemsTable({
  items,
  selected,
  setSelected,
}: {
  items: SourceItem[];
  selected: number[];
  setSelected: (ids: number[]) => void;
}): React.ReactNode {
  if (items.length === 0) {
    return (
      <div className="empty">
        <Icon name="i-crawl" />
        素材池是空的
        <div className="small">回工作台点「开始采集」，或等自动采集</div>
      </div>
    );
  }
  const all = selected.length === items.length;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 34 }}>
              <input
                type="checkbox"
                aria-label="全选"
                checked={all}
                onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.id) : [])}
              />
            </th>
            <th>作者</th>
            <th>正文摘要</th>
            <th>话题</th>
            <th className="num">热度</th>
            <th className="num">评论</th>
            <th>采集时间</th>
            <th className="num">图片</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`选择素材 ${it.id}`}
                  checked={selected.includes(it.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, it.id] : selected.filter((x) => x !== it.id),
                    )
                  }
                />
              </td>
              <td className="nowrap">{it.author}</td>
              <td className="clip">
                <span className="clamp">{it.content}</span>
              </td>
              <td>
                {it.topics.slice(0, 2).map((t) => (
                  <span key={t} className="tag" style={{ marginRight: 4 }}>
                    {t}
                  </span>
                ))}
              </td>
              <td className="num">{it.likeCount}</td>
              <td className="num">{it.commentCount}</td>
              <td className="nowrap muted small">{ago(it.fetchedAt)}</td>
              <td className="num">{it.images.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TasksTable({
  tasks,
  listType,
  similarities,
  accountNames,
  multiAccount,
  onReview,
  onRetry,
  onDelete,
}: {
  tasks: Task[];
  listType: ListType;
  similarities: Record<number, number>;
  /** CHG-0002：账号 id → 账号名 */
  accountNames: Record<number, string>;
  multiAccount: boolean;
  onReview: (id: number) => void;
  onRetry: (id: number) => void;
  onDelete: (id: number) => void;
}): React.ReactNode {
  if (tasks.length === 0) {
    return (
      <div className="empty">
        <Icon name="i-tasks" />
        没有符合条件的任务
        <div className="small">
          {listType === 'reviewing' ? '去素材池勾选素材生成任务' : '流水线跑起来后会自动出现'}
        </div>
      </div>
    );
  }
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>任务</th>
            {multiAccount && <th>账号</th>}
            <th>状态</th>
            <th>策略</th>
            <th className="num">相似度</th>
            <th className="num">重试</th>
            <th>失败原因</th>
            <th>更新时间</th>
            <th className="nowrap">操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const reason = failureReason(t.errorCode, similarities[t.id]);
            return (
              <tr key={t.id}>
                <td className="mono">#{t.id}</td>
                {multiAccount && (
                  <td className="nowrap" data-testid={`task-account-${t.id}`}>
                    {accountNames[t.accountId] ?? `#${t.accountId}`}
                  </td>
                )}
                <td>
                  <span className={`badge ${STATUS_TONE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                </td>
                <td className="muted small">{t.imageStrategy}</td>
                <td className="num">
                  {similarities[t.id] !== undefined ? similarities[t.id]!.toFixed(2) : '—'}
                </td>
                <td className="num">{t.retryCount}</td>
                <td className="clip">
                  {t.errorCode ? (
                    <>
                      <span
                        className="clamp"
                        title={`${reason.text}${reason.hint ? ` · ${reason.hint}` : ''}`}
                      >
                        {reason.text}
                      </span>
                      <span className="muted small mono">{t.errorCode}</span>
                    </>
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
                <td className="nowrap muted small">{ago(t.updatedAt)}</td>
                <td className="nowrap">
                  {t.status === 'reviewing' && (
                    <button className="btn btn-sm btn-primary" onClick={() => onReview(t.id)}>
                      <Icon name="i-review" />
                      复核
                    </button>
                  )}
                  {(t.status === 'published' || t.status === 'publishing') && (
                    <button className="btn btn-sm" onClick={() => onReview(t.id)}>
                      留证
                    </button>
                  )}
                  {t.status === 'failed' && (
                    <>
                      <button className="btn btn-sm" onClick={() => onRetry(t.id)}>
                        <Icon name="i-refresh" />
                        重试
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        style={{ marginLeft: 6 }}
                        onClick={() => onDelete(t.id)}
                      >
                        <Icon name="i-trash" />
                        删除
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
