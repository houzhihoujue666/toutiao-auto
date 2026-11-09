import { useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Icon } from './components/Icon';
import { Toasts } from './components/Toasts';
import { LogDrawer } from './components/LogDrawer';
import { Launcher } from './routes/Launcher';
import { Detail } from './routes/Detail';
import { Settings } from './routes/Settings';
import { useStore } from './state/store';

const NAV = [
  { to: '/', icon: 'i-overview', label: '启动' },
  { to: '/list/reviewing', icon: 'i-review', label: '明细' },
  { to: '/settings', icon: 'i-settings', label: '设置' },
] as const;

const TITLES: Record<string, { title: string; sub: string }> = {
  '/': { title: '启动', sub: '每个账号的状态与发布入口集中在这里' },
  '/settings': { title: '设置', sub: '可调项立即生效；安全项锁死不给出口' },
};

function header(): { title: string; sub: string } {
  return { title: '明细', sub: '按状态查看素材与任务，数字既是状态也是入口' };
}

export function App(): React.ReactNode {
  const { summary, connected, logs } = useStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const meta =
    (location.pathname.startsWith('/list') ? header() : TITLES[location.pathname]) ?? TITLES['/']!;

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-brand">
          <span className="rail-mark" aria-hidden="true" />
          <span className="rail-brand-t">
            <b>微头条流水线</b>
            <i>Weitoutiao Pipeline</i>
          </span>
        </div>
        <nav className="rail-nav" aria-label="主导航">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `rail-item${isActive || (n.to === '/list/reviewing' && location.pathname.startsWith('/list')) ? ' is-on' : ''}`
              }
            >
              <Icon name={n.icon} />
              <span className="rail-item-t">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="rail-env">
            <span
              className={`dot ${connected ? 'dot-ok' : ''}`}
              style={connected ? undefined : { background: '#C97A16' }}
            />
            {connected ? '本机运行 · 已连后端' : '本机运行 · 后端未连接'}
          </div>
          <div className="rail-ver">依据方案 v4.0 · 模式 {summary?.runtimeMode ?? '—'}</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-l">
            <h1>{meta.title}</h1>
            <p>{meta.sub}</p>
          </div>
          <div className="topbar-r">
            <button
              className="btn btn-ghost"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              <Icon name="i-logs" />
              实时日志
              <span className="btn-badge">{logs.length}</span>
            </button>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Launcher />} />
          {/* CHG-0002：activeId 变化由 Detail 内部的 effect 依赖触发重取，不重挂载组件 */}
          <Route path="/list/:type" element={<Detail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      <LogDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <Toasts />
    </div>
  );
}
