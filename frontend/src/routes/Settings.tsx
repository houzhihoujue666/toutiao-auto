import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import {
  fetchPromptTemplate,
  fetchSettings,
  loginLlm,
  resumeCircuit,
  savePromptTemplate,
  saveSettings,
  testLlm,
  type SettingsResult,
} from '../lib/api';
import { FREE_LLM_PRESETS } from '@shared/constants';
import type { AppConfigItem } from '@shared/types';

const UNITS: Record<string, string> = {
  dailyPublishLimit: '条 / 天',
  minPublishIntervalMin: '分钟',
  similarityThreshold: '≤ 该值放行',
  wordRange: '格式 200-300',
  circuitBreakFailures: '次',
  rewriteTimeoutMs: '毫秒',
  rewriteRetry: '次',
  minLength: '字',
  maxLength: '字',
  idleBrowserReleaseMin: '分钟',
};

/** 实现红线 —— 附录 B，界面里也放一份，防止开发时 forget */
const REDLINES = [
  '选择器不许写进业务代码：必须放 config/selectors/，否则平台改版一次漏三处',
  '不许先改状态后写库：正确顺序是先落库再改状态，否则崩溃后无从恢复',
  '不许主动修改网页发出的请求：只能旁听，绝不拦截或伪造',
  '不许把图片塞进数据库：只存路径，文件放 data/media/',
  '不许提交 data/ 目录：内含登录态，必须进 .gitignore',
  '发布必须做幂等检查：崩溃重启可能重复发布，属不可逆扣分项',
  '熔断不许自动恢复：必须由人在控制台点「恢复」',
  '不许并行操作同一账号：同一账号必须严格串行',
];

/**
 * 设置 —— §3.4：只放与「设置参数」相关的内容（CHG-0005）。
 * 账号管理 / 流水线状态 / 风险告警 / 合规说明已迁出（账号信息全收口到启动页）。
 */
export function Settings(): React.ReactNode {
  const { summary, activeId, notify, refresh } = useStore();
  const [settings, setSettings] = useState<SettingsResult | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  /** 「免费 AI 改写」卡片里选中的预设；custom = 不改草稿，自己填 */
  const [preset, setPreset] = useState('zhipu');

  useEffect(() => {
    void fetchSettings()
      .then((s) => {
        setSettings(s);
        setDraft(Object.fromEntries(s.editable.map((i) => [i.key, i.value])));
      })
      .catch((e: unknown) => notify('bad', '设置加载失败', (e as Error).message));
    void fetchPromptTemplate()
      .then((t) => setTemplate(t.content))
      .catch(() => undefined);
  }, [notify]);

  const dirty =
    settings?.editable.some((i) => draft[i.key] !== undefined && draft[i.key] !== i.value) ?? false;

  const onSave = async () => {
    setBusy(true);
    try {
      const r = await saveSettings(draft);
      notify('ok', `已保存 ${Object.keys(r.saved).length} 项`, '可调项立即生效，不用重启');
      const fresh = await fetchSettings();
      setSettings(fresh);
      setDraft(Object.fromEntries(fresh.editable.map((i) => [i.key, i.value])));
      await refresh();
    } catch (e) {
      notify('bad', '保存失败', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 先保存草稿再试打一次，避免测的是旧 Key */
  const onTestApi = async () => {
    setBusy(true);
    try {
      await saveSettings(draft);
      const r = await testLlm();
      notify('ok', `连接正常 · 免费 AI 可以用了（${r.model} · ${r.ms}ms）`, r.sample);
      const fresh = await fetchSettings();
      setSettings(fresh);
      setDraft(Object.fromEntries(fresh.editable.map((i) => [i.key, i.value])));
      await refresh();
    } catch (e) {
      notify('bad', '没连上，检查一下钥匙', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 选一个免费模型预设：只改草稿里的地址 / 模型名，保存前都还能反悔 */
  const applyPreset = (id: string) => {
    setPreset(id);
    const p = FREE_LLM_PRESETS.find((x) => x.id === id);
    if (!p) return; // custom：保留用户自己填的值
    setDraft((d) => ({
      ...d,
      'llm.mode': 'api',
      'llm.api.baseUrl': p.baseUrl,
      'llm.api.model': p.model,
    }));
    notify('info', `已换成「${p.label}」`, '地址和型号已经填好，点「填好了，测试一下」确认能不能用');
  };

  const copyText = (text: string, label: string) => {
    if (!navigator.clipboard) {
      notify('bad', '复制失败', '当前环境不支持剪贴板，请手动选中复制');
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => notify('ok', `${label}已复制`))
      .catch(() => notify('bad', '复制失败', '请手动选中文本复制'));
  };

  const onSaveTemplate = async () => {
    try {
      const r = await savePromptTemplate(template);
      notify('ok', '提示词模板已更新');
      setTemplate(r.content);
    } catch (e) {
      notify('bad', '模板保存失败', (e as Error).message);
    }
  };

  const circuitOpen = summary?.circuit.state === 'open';
  const presetNote = FREE_LLM_PRESETS.find((p) => p.id === preset)?.note;

  return (
    <main className="view">
      <div className="grid g-side">
        <div style={{ display: 'grid', gap: 16 }}>
          {/* 可调项 */}
          <div className="card">
            <div className="card-h">
              <h3>可调设置</h3>
              <span className="sub">改完立即生效，不用重启；超出允许范围会提示你改回来</span>
              <span className="spacer" />
              <button
                className="btn btn-sm btn-primary"
                disabled={!dirty || busy}
                onClick={() => void onSave()}
              >
                <Icon name="i-check2" />
                保存修改
              </button>
            </div>
            <div className="card-b">
              {settings?.editable.map((item) => (
                <ConfigRow
                  key={item.key}
                  item={item}
                  value={draft[item.key] ?? item.value}
                  onChange={(v) => setDraft((d) => ({ ...d, [item.key]: v }))}
                />
              ))}
              {!settings && <div className="empty">加载中…</div>}
            </div>
          </div>

          {/* 提示词模板 */}
          <details className="fold">
            <summary>提示词模板（§6.4 · 界面 / 提示词 / 强化重写段三处同源）</summary>
            <div className="fold-b">
              <div className="form-row">
                <label htmlFor="tpl">默认模板</label>
                <textarea
                  id="tpl"
                  className="prose mono"
                  style={{ minHeight: 220 }}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                />
                <span className="hint">必须保留 {'{{originalText}}'} 占位符，否则原文无法注入</span>
              </div>
              <div className="row row-end" style={{ marginTop: 10 }}>
                <button className="btn btn-sm" onClick={() => void onSaveTemplate()}>
                  保存模板
                </button>
              </div>
            </div>
          </details>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {/* 免费 AI 改写引导（ADR-0016）：面向不懂编程的运营者，只讲「怎么办」 */}
          <div className="card">
            <div className="card-h">
              <h3>免费 AI 改写</h3>
              <span className="sub">不用充值 · 申请一次就一直能用</span>
              <span className="spacer" />
              <span className="badge badge-teal">¥0</span>
            </div>
            <div className="card-b" style={{ display: 'grid', gap: 14 }}>
              <div className="note note-teal">
                <div>
                  <b>改写文章不用花钱，只差你申请一次</b>
                  <div className="small" style={{ marginTop: 4, lineHeight: 1.7 }}>
                    软件默认用免费 AI 帮你改写，不用买套餐、也不用登录网页版。下面三步花几分钟，<b>只做一次</b>，以后点「启动」就自动改写，不用再管。各家免费政策可能调整，以官网说明为准。
                  </div>
                </div>
              </div>

              <div className="redline" style={{ gap: 10 }}>
                <div className="redline-i">
                  <span className="n">1</span>
                  <span>
                    <b>用手机号注册一个账号</b>
                    <div className="small" style={{ marginTop: 3, lineHeight: 1.7 }}>
                      点{' '}
                      <a href="https://open.bigmodel.cn/" target="_blank" rel="noreferrer">
                        这里打开智谱官网 ↗
                      </a>
                      ，用手机号注册登录就行。官网可能提示做实名认证，那是官网自己的流程、跟本软件无关；
                      <b>按官网说明，调用接口不强制实名</b>，页面没要求就能跳过，真要求了照着填一次就好。
                    </div>
                  </span>
                </div>
                <div className="redline-i">
                  <span className="n">2</span>
                  <span>
                    <b>复制一串「钥匙」</b>
                    <div className="small" style={{ marginTop: 3, lineHeight: 1.7 }}>
                      在官网找「API Keys」（有的页面叫「API 密钥管理」），点「添加新的 API KEY」，把生成的一长串字符复制下来。它就是软件去 AI 那边干活时出示的通行证，只属于你，别发给别人。<b>先复制存好：这串字符通常只完整显示一次。</b>
                    </div>
                  </span>
                </div>
                <div className="redline-i">
                  <span className="n">3</span>
                  <span>
                    <b>把钥匙粘进来，点一下「测试」</b>
                    <div className="small" style={{ marginTop: 3, lineHeight: 1.7 }}>
                      回到本页的「可调设置」区域，找到「API Key」那一行，把刚复制的字符粘进去；再点本卡片下面的「填好了，测试一下」。看到右上角提示「连接正常」就成了。
                    </div>
                  </span>
                </div>
              </div>

              <div className="row">
                <label htmlFor="llm-preset" className="small">
                  用哪一家（已帮你选好，一般不用改）
                </label>
                <select
                  id="llm-preset"
                  value={preset}
                  onChange={(e) => applyPreset(e.target.value)}
                  style={{ minWidth: 230 }}
                >
                  {FREE_LLM_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">自己填（给懂技术的人）</option>
                </select>
                <span className="spacer" />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={() => void onTestApi()}
                  data-testid="test-llm-api"
                >
                  <Icon name="i-bolt" />
                  填好了，测试一下
                </button>
              </div>

              {settings && (
                <div className="row">
                  {draft['llm.api.key'] ? (
                    <span className="badge badge-teal">钥匙已填好，可以点「测试一下」了</span>
                  ) : (
                    <span className="badge badge-amber">还差第 3 步：把钥匙粘进「可调设置」</span>
                  )}
                </div>
              )}
              <div className="muted small" style={{ lineHeight: 1.7 }}>
                看到「连接正常」就大功告成。没连上？多半是复制时少了字符，重新粘贴再试；免费档偶尔要排队，等一分钟再试也行。
              </div>

              <details className="fold">
                <summary>想换一家 AI，或者给懂技术的同事看参数（一般用不到）</summary>
                <div className="fold-b" style={{ display: 'grid', gap: 12 }}>
                  <div className="small" style={{ lineHeight: 1.7 }}>
                    下面的地址和型号已经帮你填好了，普通使用完全不用动；只有换服务商、或者让懂技术的人排查问题时才需要看。换一家时，钥匙也要换成那家官网新申请的。
                  </div>
                  <div className="row">
                    <span className="mono small">
                      {draft['llm.api.baseUrl'] ?? ''} · {draft['llm.api.model'] ?? ''}
                    </span>
                    <span className="spacer" />
                    <button
                      className="btn btn-sm"
                      onClick={() => copyText(draft['llm.api.baseUrl'] ?? '', '接口地址')}
                    >
                      复制地址
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => copyText(draft['llm.api.model'] ?? '', '型号')}
                    >
                      复制型号
                    </button>
                  </div>
                  {presetNote && <div className="muted small">{presetNote}</div>}
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>哪家 AI</th>
                          <th>去哪个网站申请</th>
                          <th>用的型号</th>
                          <th>要留意</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>智谱（推荐 · 已选好）</td>
                          <td>
                            <a href="https://open.bigmodel.cn/" target="_blank" rel="noreferrer">
                              open.bigmodel.cn
                            </a>
                          </td>
                          <td className="mono">glm-4.7-flash</td>
                          <td>免费，改写几百字够用</td>
                        </tr>
                        <tr>
                          <td>硅基流动</td>
                          <td>siliconflow.cn</td>
                          <td className="mono">Qwen/Qwen2.5-7B-Instruct</td>
                          <td>有没有免费型号，看官网模型广场</td>
                        </tr>
                        <tr>
                          <td>阿里百炼</td>
                          <td>通义控制台</td>
                          <td className="mono">qwen-plus</td>
                          <td>送的额度会过期，以官网为准</td>
                        </tr>
                        <tr>
                          <td>DeepSeek</td>
                          <td>platform.deepseek.com</td>
                          <td className="mono">deepseek-chat</td>
                          <td>要花钱，默认不选</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="muted small">
                    免费政策和次数限制各家会变（智谱 2026-11-14 复核，其余 2026-11-11 核对），以官网「模型 / 价格」页为准，本项目不替厂商打包票。
                  </div>
                </div>
              </details>

              {summary?.external.llm.mode === 'web' && (
                <div className="note">
                  <div>
                    <b>你还在用旧的「网页版改写」</b>
                    <div className="small" style={{ marginTop: 4, lineHeight: 1.7 }}>
                      网页版是让软件去点网页，平台一改版就容易出错。建议在「可调设置」把「改写方式」选成写着{' '}
                      <span className="mono">api</span> 的那一项（也就是官方接口），再按上面三步拿一把免费钥匙。不换也能继续用，只是更容易卡住。
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 外部账号与登录（CHG-0005：保留，承载 LLM 测试 / 登录，属外部依赖配置） */}
          <div className="card">
            <div className="card-h">
              <h3>外部账号与登录</h3>
              <span className="sub">头条账号登录与发布在启动页卡片操作；这里只管大模型与外部依赖</span>
            </div>
            <div className="card-b" style={{ display: 'grid', gap: 10 }}>
              <div className="redline-i">
                <span className="n">1</span>
                <span>
                  <b>{summary?.external.toutiao.label ?? '头条账号'}</b>
                  <div className="muted small">登录与发布请到启动页卡片操作</div>
                </span>
              </div>
              <div className="redline-i">
                <span className="n">2</span>
                <span>
                  <b>{summary?.external.llm.label ?? '大模型'}</b>
                  <div className="muted small">
                    {summary?.external.llm.mode === 'api'
                      ? '默认用免费 AI 改写，不花钱；钥匙在本页「可调设置」里填，怎么申请看上面三步'
                      : summary?.external.llm.mode === 'web'
                        ? '网页版不花钱，但要登录、平台一改版就容易出错；遇到登录提示会停下来等你处理'
                        : '不调用外部 AI，也不花钱；随时可以切回免费自动改写'}
                  </div>
                </span>
              </div>
              <div className="redline-i">
                <span className="n">3</span>
                <span>
                  <b>图库 {summary?.external.stock.label ?? '—'}</b>
                  <div className="muted small">取不到图就只用处理过的原图，绝不使用有版权风险的素材</div>
                </span>
              </div>

              {summary?.external.llm.mode === 'api' && (
                <div className="row">
                  <span className="badge badge-teal">
                    {summary.external.llm.label}：全自动，无需登录
                  </span>
                  <span className="spacer" />
                  <span className="muted small">怎么测试，看上方「免费 AI 改写」卡片</span>
                </div>
              )}

              {summary?.runtimeMode === 'real' && summary.external.llm.needLogin && (
                <div className="row">
                  <span className="badge badge-amber">
                    {summary.external.llm.label}：需要你本人登录一次
                  </span>
                  <span className="spacer" />
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      void loginLlm()
                        .then((r) => notify('info', r.message))
                        .catch((e: unknown) => notify('bad', '打开失败', (e as Error).message))
                    }
                  >
                    <Icon name="i-account" />
                    去登录
                  </button>
                </div>
              )}

              {circuitOpen && (
                <div className="note note-red">
                  <div>
                    <b>账号已熔断</b>：连续失败 {summary?.circuit.consecutiveFailures} 次（阈值{' '}
                    {summary?.circuit.threshold}）。
                    <div className="small">队列已停工，不会自动恢复，请确认问题后点「恢复」。</div>
                  </div>
                  <button
                    className="btn btn-sm btn-amber"
                    style={{ marginTop: 8 }}
                    onClick={() =>
                      void resumeCircuit(activeId)
                        .then(() => {
                          notify('ok', '已恢复，队列继续');
                          return refresh();
                        })
                        .catch((e: unknown) => notify('bad', '恢复失败', (e as Error).message))
                    }
                  >
                    恢复（人工）
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 锁定项 */}
          <div className="card">
            <div className="card-h">
              <h3>锁定项</h3>
              <span className="sub">风控与合规相关，界面只展示，不给配置出口</span>
            </div>
            <div className="card-b">
              {settings?.locked.map((item) => (
                <div key={item.key} className="cfg">
                  <div className="cfg-l">
                    <b>{item.label}</b>
                    <div className="cfg-u">{item.hint}</div>
                  </div>
                  <div className="cfg-e">
                    <input value={item.value} readOnly disabled aria-label={item.label} />
                    <span className="field-lock">锁定</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 实现红线 */}
          <div className="card">
            <div className="card-h">
              <h3>实现红线</h3>
              <span className="sub">附录 B</span>
            </div>
            <div className="card-b">
              <div className="redline">
                {REDLINES.map((r, i) => (
                  <div key={r} className="redline-i">
                    <span className="n">{String(i + 1).padStart(2, '0')}</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function ConfigRow({
  item,
  value,
  onChange,
}: {
  item: AppConfigItem;
  value: string;
  onChange: (v: string) => void;
}): React.ReactNode {
  const id = `cfg-${item.key}`;
  return (
    <div
      className="cfg"
      style={item.valueType === 'textarea' ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}
    >
      <div className="cfg-l">
        <label htmlFor={id}>
          <b>{item.label}</b>
        </label>
        <div className="cfg-u">{item.hint}</div>
      </div>
      <div className="cfg-e" style={item.valueType === 'textarea' ? { width: '100%' } : undefined}>
        {item.valueType === 'textarea' ? (
          <textarea
            id={id}
            className="mono"
            style={{ width: '100%', minHeight: 150, fontSize: 12.5, lineHeight: 1.7 }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={item.label}
            data-testid={`cfg-${item.key}`}
          />
        ) : item.valueType === 'select' ? (
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
            {(item.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : item.valueType === 'boolean' ? (
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="false">关闭</option>
            <option value="true">开启</option>
          </select>
        ) : (
          <input
            id={id}
            type={
              item.valueType === 'number'
                ? 'number'
                : item.valueType === 'password'
                  ? 'password'
                  : 'text'
            }
            value={value}
            min={item.min ?? undefined}
            max={item.max ?? undefined}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {UNITS[item.key] && <span className="cfg-u">{UNITS[item.key]}</span>}
      </div>
    </div>
  );
}
