import { Icon } from './Icon';
import { useStore, type ToastKind } from '../state/store';

const ICONS: Record<ToastKind, string> = {
  info: 'i-crawl',
  ok: 'i-check2',
  warn: 'i-warn',
  bad: 'i-warn',
};

export function Toasts(): React.ReactNode {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">
          <Icon name={ICONS[t.kind]} />
          <div className="toast-b">
            <span>{t.text}</span>
            {t.hint && <small>{t.hint}</small>}
          </div>
          <button className="btn btn-icon" aria-label="关闭提示" onClick={() => dismissToast(t.id)}>
            <Icon name="i-close" />
          </button>
        </div>
      ))}
    </div>
  );
}
