import { useNavigate } from 'react-router-dom';
import type { Summary } from '@shared/types';

type Tone = 'idle' | 'live' | 'wait' | 'done' | 'bad';

interface Step {
  id: string;
  step: string;
  title: string;
  count: number;
  tone: Tone;
  desc: string;
  to?: string;
}

/** 流水线轨（demo 的签名元素）：数字既是状态，也是入口 */
export function PipelineRail({ summary }: { summary: Summary }): React.ReactNode {
  const navigate = useNavigate();
  const c = summary.counts;
  const steps: Step[] = [
    {
      id: 'items',
      step: '①',
      title: '素材池',
      count: c.items,
      tone: c.items > 0 ? 'live' : 'idle',
      desc: '热点页取数 · 20 条 ≤60 秒',
      to: '/list/items',
    },
    {
      id: 'running',
      step: '②',
      title: '改写配图',
      count: c.running,
      tone: c.running > 0 ? 'live' : 'idle',
      desc: '改写 → 配图 → 质检自动推进',
    },
    {
      id: 'reviewing',
      step: '③',
      title: '自动放行',
      count: c.reviewing,
      tone: c.reviewing > 0 ? 'live' : 'idle',
      desc: '质检通过即入队，无需确认',
      to: '/list/reviewing',
    },
    {
      id: 'queue',
      step: '④',
      title: '发布队列',
      count: c.queue,
      tone: c.queue > 0 ? 'live' : 'idle',
      desc: `严格串行 · 最小间隔 ${summary.minPublishIntervalMinutes ?? 15} 分钟`,
      to: '/list/queue',
    },
    {
      id: 'published',
      step: '⑤',
      title: '已发布',
      count: c.publishedToday,
      tone: 'done',
      desc: `今日额度 ${summary.quota.used}/${summary.quota.limit}`,
      to: '/list/published',
    },
    {
      id: 'failed',
      step: '⑥',
      title: '失败',
      count: c.failed,
      tone: c.failed > 0 ? 'bad' : 'idle',
      desc: '可人工重试',
      to: '/list/failed',
    },
  ];

  return (
    <div className="pipeline">
      {steps.map((s) => (
        <button
          key={s.id}
          className={`ps${s.tone === 'live' ? ' is-live' : ''}`}
          data-tone={s.tone}
          data-testid={`ps-${s.id}`}
          onClick={() => s.to && navigate(s.to)}
        >
          <span className="ps-head">
            <span className="ps-node">{s.step}</span>
            <span className="ps-c">{s.count}</span>
          </span>
          <span className="ps-t">{s.title}</span>
          <span className="ps-bar" />
        </button>
      ))}
    </div>
  );
}
