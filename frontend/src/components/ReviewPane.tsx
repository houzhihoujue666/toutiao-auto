import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import {
  fetchTaskDetail,
  publishTask,
  discardTask,
  saveRewrite,
  type TaskDetail,
} from '../lib/api';
import { FORCE_DECLARATION } from '@shared/constants';

/**
 * 复核面板 —— §6.8：并排对比原文与改写稿，相似度、四项质检、配图来源都在同屏，
 * 「通过并发布」是唯一的放行按钮；不合格时按钮禁用并说明原因。
 */
export function ReviewPane({
  taskId,
  onClose,
  onDone,
  notify,
}: {
  taskId: number;
  onClose: () => void;
  onDone: () => void;
  notify: (kind: 'ok' | 'bad' | 'info', text: string, hint?: string) => void;
}): React.ReactNode {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchTaskDetail(taskId).then((d) => {
      if (!alive) return;
      setDetail(d);
      setText(d.rewrite?.rewrittenText ?? '');
    });
    return () => {
      alive = false;
    };
  }, [taskId]);

  if (!detail) {
    return (
      <div className="card">
        <div className="card-b">
          <div className="empty">
            <Icon name="i-refresh" />
            正在加载任务 #{taskId}…
          </div>
        </div>
      </div>
    );
  }

  const { task, source, rewrite, record, stock, threshold } = detail;
  const sim = rewrite?.similarity ?? 1;
  const flags = rewrite?.qualityFlags ?? [];
  const similarityOk = sim <= threshold;
  const sensitive = flags.filter((f) => f.startsWith('SENSITIVE'));
  const lowReadability = flags.includes('LOW_READABILITY');
  const gateOk = similarityOk && sensitive.length === 0;
  const topic = source?.topics[0] ?? '';

  const wait = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await fn();
      notify('ok', okText);
      onDone();
    } catch (e) {
      notify('bad', '操作失败', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="review-pane">
      <div className="card-h">
        <h3>任务 #{task.id} · 复核</h3>
        <span className="sub">
          策略 {task.imageStrategy} · 重试 {task.retryCount} 次
          {task.errorCode && ` · 错误码 ${task.errorCode}`}
        </span>
        <span className="spacer" />
        <button className="btn btn-icon" aria-label="关闭复核" onClick={onClose}>
          <Icon name="i-close" />
        </button>
      </div>

      <div className="compare">
        <div>
          <div className="compare-h">
            <h4>原文</h4>
            <span className="badge">#{source?.platformItemId ?? '—'}</span>
          </div>
          <div className="prose">{source?.content ?? '（素材已丢失）'}</div>
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>作者</dt>
            <dd>{source?.author ?? '—'}</dd>
            <dt>热度 / 评论</dt>
            <dd className="mono">
              {source?.likeCount ?? 0} / {source?.commentCount ?? 0}
            </dd>
            <dt>话题</dt>
            <dd>{topic || '—'}</dd>
          </dl>
        </div>
        <div>
          <div className="compare-h">
            <h4>改写稿（可直接编辑）</h4>
            <span className="badge badge-indigo">{FORCE_DECLARATION}</span>
          </div>
          <textarea
            className="prose"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="改写稿"
            placeholder={
              rewrite ? '' : '把大模型生成的改写内容粘贴到这里；保存后会自动配图、质检并发布'
            }
          />
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted small">{text.replace(/\s/g, '').length} 字</span>
            <span className="spacer" />
            <button
              className="btn btn-sm"
              disabled={busy || !text.trim()}
              onClick={() => void wait(() => saveRewrite(task.id, text), '改写稿已保存')}
            >
              保存修改
            </button>
          </div>
        </div>
      </div>

      <div className="card-b" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="grid g-side">
          <div>
            <div className="gauge">
              <span
                className={`gauge-num`}
                style={{ color: similarityOk ? 'var(--teal)' : 'var(--red)' }}
              >
                {sim.toFixed(2)}
              </span>
              <div className="gauge-side">
                <div className="bar">
                  <i
                    style={{
                      width: `${Math.min(100, sim * 100)}%`,
                      background: similarityOk ? 'var(--teal)' : 'var(--red)',
                    }}
                  />
                </div>
                <div className="gauge-scale">
                  <span>0</span>
                  <span>闸门 {threshold}</span>
                  <span>1</span>
                </div>
              </div>
            </div>
            <div className="checklist" style={{ marginTop: 12 }}>
              <div className="check">
                <span className={`check-i ${similarityOk ? 'ok' : 'bad'}`}>
                  {similarityOk ? '✓' : '!'}
                </span>
                <span>
                  <b>相似度</b>
                  <div className="muted small">
                    {similarityOk
                      ? `${sim.toFixed(2)} ≤ 闸门 ${threshold}`
                      : `${sim.toFixed(2)} 超过闸门 ${threshold}，需重写`}
                  </div>
                </span>
              </div>
              <div className="check">
                <span className={`check-i ${sensitive.length === 0 ? 'ok' : 'bad'}`}>
                  {sensitive.length === 0 ? '✓' : '!'}
                </span>
                <span>
                  <b>敏感词</b>
                  <div className="muted small">
                    {sensitive.length === 0 ? '本地词库未命中' : `命中：${sensitive.join('、')}`}
                  </div>
                </span>
              </div>
              <div className="check">
                <span className={`check-i ${lowReadability ? 'warn' : 'ok'}`}>
                  {lowReadability ? '!' : '✓'}
                </span>
                <span>
                  <b>可读性</b>
                  <div className="muted small">
                    {lowReadability ? '启发式告警（仅标记，不拦截）' : '句长分布正常'}
                  </div>
                </span>
              </div>
            </div>
          </div>

          <div>
            <div className="eyebrow">配图 {rewrite?.images.length ?? 0} 张</div>
            <div className="shots" style={{ marginTop: 8 }}>
              {(rewrite?.images ?? []).map((rel) => {
                const row = stock.find((s) => s.localPath === rel);
                return (
                  <figure key={rel} className="shot" style={{ margin: 0 }}>
                    <div className="shot-img">
                      <img
                        src={`/api/media/${rel}`}
                        alt={rel}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>
                    <figcaption className="shot-b">
                      <b>{row ? row.provider : '洗过的原图'}</b>
                      <span className="muted small">
                        {row?.license ?? 'EXIF 已剥离 · 轻旋转调色'}
                      </span>
                      <span className="muted small clamp" title={rel}>
                        {rel}
                      </span>
                    </figcaption>
                  </figure>
                );
              })}
              {(rewrite?.images ?? []).length === 0 && (
                <div className="empty">
                  <Icon name="i-crawl" />
                  没有配图
                </div>
              )}
            </div>
            {record && (
              <div className="note note-teal" style={{ marginTop: 10 }}>
                已有发布记录：{record.status}
                {record.publishedUrl ? ` · ${record.publishedUrl}` : ''}
              </div>
            )}
          </div>
        </div>

        <div className="row row-end" style={{ marginTop: 14 }}>
          <span className="muted small">
            发布将以「{FORCE_DECLARATION}」声明，并断言「头条首发」未勾选
          </span>
          <span className="spacer" />
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => void wait(() => discardTask(task.id), '任务已丢弃')}
          >
            <Icon name="i-close" />
            丢弃
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !gateOk}
            title={gateOk ? '通过后进入发布队列' : '质检未通过，不能直接发布'}
            onClick={() => void wait(() => publishTask(task.id), '已加入发布队列')}
          >
            <Icon name="i-play" />
            通过并发布
          </button>
        </div>
        {!gateOk && (
          <div className="note note-red" style={{ marginTop: 10 }}>
            质检未通过：{sim > threshold ? `相似度 ${sim.toFixed(2)} 超闸门 ${threshold}` : ''}
            {sensitive.length ? ` · 命中敏感词 ${sensitive.join('、')}` : ''}。请改动写稿后再试。
          </div>
        )}
      </div>
    </div>
  );
}
