import { useState } from 'react';
import { Icon } from './Icon';
import { useStore } from '../state/store';

const LEVELS = ['all', 'info', 'warn', 'error', 'debug'] as const;

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 实时日志抽屉 —— 与 demo 一致：右侧抽屉 + 等级过滤 + 暂停推送 */
export function LogDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactNode {
  const { logs } = useStore();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const [paused, setPaused] = useState(false);
  const [snapshot, setSnapshot] = useState<typeof logs>([]);

  const source = paused ? snapshot : logs;
  const shown = level === 'all' ? source : source.filter((l) => l.level === level);

  const togglePause = () => {
    if (!paused) setSnapshot(logs);
    setPaused((p) => !p);
  };

  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <aside
        className={`drawer${open ? ' is-open' : ''}`}
        aria-label="实时日志"
        aria-hidden={!open}
      >
        <div className="drawer-h">
          <div>
            <h2>实时日志</h2>
            <p>
              WebSocket <code>/ws</code> 推送 · 已过 <code>redact</code> 脱敏
            </p>
          </div>
          <button className="btn btn-icon" aria-label="关闭日志" onClick={onClose}>
            <Icon name="i-close" />
          </button>
        </div>
        <div className="drawer-filters">
          {LEVELS.map((l) => (
            <button
              key={l}
              className={`chip${level === l ? ' is-on' : ''}`}
              onClick={() => setLevel(l)}
            >
              {l}
            </button>
          ))}
          <button className="chip chip-ghost" onClick={togglePause}>
            {paused ? '继续推送' : '暂停推送'}
          </button>
        </div>
        <div className="drawer-body" data-testid="log-body">
          {shown.length === 0 && (
            <div className="empty">
              <Icon name="i-logs" />
              暂无日志
            </div>
          )}
          {shown.map((l) => (
            <div key={l.id} className="log" data-level={l.level}>
              <span className="log-t">{timeOf(l.ts)}</span>
              <span className="log-l">{l.level}</span>
              <span className="log-m">
                {l.taskId ? `#${l.taskId} ` : ''}
                {l.message}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
