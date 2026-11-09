import { useNavigate } from 'react-router-dom';

export interface StatCardProps {
  title: string;
  value: number | string;
  unit?: string;
  desc?: string;
  tone?: '' | 'attn' | 'bad';
  /** 数字的百分比进度（0~1），用于额度类卡片 */
  progress?: number;
  to?: string;
  hint?: string;
}

/** 数字卡：既是数据，也是入口（§3.4 界面约定：点数字进明细） */
export function StatCard({
  title,
  value,
  unit,
  desc,
  tone = '',
  progress,
  to,
  hint,
}: StatCardProps): React.ReactNode {
  const navigate = useNavigate();
  const cls = ['stat', tone === 'attn' ? 'stat-attn' : '', tone === 'bad' ? 'stat-bad' : '']
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      <span className="stat-t">{title}</span>
      <span className="stat-v">
        {value}
        {unit && <span className="stat-u">{unit}</span>}
      </span>
      {progress !== undefined && (
        <span className="bar">
          <i style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
        </span>
      )}
      {desc && <span className="stat-d">{desc}</span>}
    </>
  );

  if (!to) return <div className={cls}>{content}</div>;
  return (
    <button className={cls} onClick={() => navigate(to)} title={hint ?? `查看${title}`}>
      {content}
    </button>
  );
}
