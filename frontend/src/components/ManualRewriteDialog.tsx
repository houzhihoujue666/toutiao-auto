import { useCallback, useEffect, useState } from 'react';
import { fetchTaskDetail, saveRewrite, type TaskDetail } from '../lib/api';
import type { Task } from '@shared/types';

const LLM_HOME = 'https://chat.deepseek.com/';

/**
 * 人工粘贴改写稿 —— §3.5 manual 模式。
 * 目的：把「复制什么 / 送到哪 / 粘回哪里」三步压进一个弹出层，
 * 一键复制 + 一键打开模型站 + 一个大粘贴框，用户不用猜、不用找。
 */
export function ManualRewriteDialog({
  tasks,
  onClose,
  onDone,
}: {
  tasks: Task[];
  onClose: () => void;
  onDone: () => void;
}): React.ReactNode {
  const [idx, setIdx] = useState(0);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const total = tasks.length;
  const current = tasks[idx] ?? null;

  useEffect(() => {
    if (!current) return;
    let alive = true;
    setDetail(null);
    setText('');
    setMsg(null);
    setCopied(false);
    void fetchTaskDetail(current.id)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setText(d.rewrite?.rewrittenText ?? '');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [current]);

  const prompt = detail?.prompt ?? '';
  const chars = text.replace(/\s/g, '').length;
  const ready = chars > 0;

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setMsg(null);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setMsg({ tone: 'bad', text: '浏览器不允许自动复制，请手动点进提示词框按 Ctrl+C' });
    }
  }, [prompt]);

  const submit = async (): Promise<void> => {
    if (!current) return;
    if (!ready) {
      setMsg({ tone: 'bad', text: '先把模型生成的内容粘到右边「改写稿」里再保存' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await saveRewrite(current.id, text);
      if (idx + 1 < total) {
        setIdx(idx + 1);
        setMsg({ tone: 'ok', text: `第 ${idx + 1} 条已保存，程序接管中；继续下一条` });
      } else {
        setMsg({ tone: 'ok', text: '全部保存完毕，已进入配图 → 质检 → 自动发布' });
        window.setTimeout(() => onDone(), 900);
      }
    } catch (e) {
      setMsg({ tone: 'bad', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!current) return null;

  return (
    <div className="ovl" role="dialog" aria-modal="true" aria-label="粘贴改写稿">
      <div className="sheet">
        <div className="sheet-h">
          <h3 style={{ margin: 0 }}>粘贴改写稿</h3>
          <span className="badge badge-indigo">
            第 {idx + 1} / {total} 条 · 任务 #{current.id}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </div>

        <div className="sheet-b">
          <div className="steps">
            <div className={`step ${copied ? '' : 'on'}`}>
              <span className="n">1</span>
              <span>
                <b>复制提示词</b>
                <div className="muted small">点下面「复制提示词」，内容自动进剪贴板</div>
              </span>
            </div>
            <div className={`step ${copied && !ready ? 'on' : ''}`}>
              <span className="n">2</span>
              <span>
                <b>到 DeepSeek 生成</b>
                <div className="muted small">点「打开 DeepSeek」，粘贴发送，等它写完</div>
              </span>
            </div>
            <div className={`step ${ready ? 'on' : ''}`}>
              <span className="n">3</span>
              <span>
                <b>把结果粘回来</b>
                <div className="muted small">模型输出的内容，粘到右边「改写稿」框里</div>
              </span>
            </div>
            <div className="step">
              <span className="n">4</span>
              <span>
                <b>保存，自动发布</b>
                <div className="muted small">保存后自动配图 → 质检 → 按间隔发出</div>
              </span>
            </div>
          </div>

          <div className="compare">
            <div>
              <div className="compare-h">
                <h4>① 提示词（复制这个）</h4>
                <button
                  className={`btn btn-sm ${copied ? 'btn-primary' : ''}`}
                  onClick={() => void copyPrompt()}
                  disabled={!prompt}
                  data-testid="copy-prompt"
                >
                  {copied ? '已复制 ✓' : '复制提示词'}
                </button>
              </div>
              <div style={{ marginTop: 10 }}>
                <a
                  className="btn btn-sm"
                  href={LLM_HOME}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="open-llm"
                >
                  <span aria-hidden>↗</span> 打开 DeepSeek（新窗口）
                </a>
              </div>
              <textarea
                className="prose mono prompt-box"
                readOnly
                value={prompt}
                aria-label="提示词"
                style={{ marginTop: 10 }}
                onFocus={(e) => e.currentTarget.select()}
              />
              {detail?.source && (
                <details style={{ marginTop: 10 }}>
                  <summary className="small muted">
                    看原文（{detail.source.content.replace(/\s/g, '').length} 字）
                  </summary>
                  <div className="small muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                    {detail.source.content}
                  </div>
                </details>
              )}
            </div>

            <div>
              <div className="compare-h">
                <h4>③ 改写稿（粘到这里）</h4>
                <span className="muted small">{chars} 字</span>
              </div>
              <textarea
                className="prose paste-box"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="把 DeepSeek 生成的内容粘贴到这里（Ctrl+V）"
                aria-label="改写稿"
                style={{ marginTop: 10 }}
                data-testid="paste-rewrite"
              />
            </div>
          </div>

          {msg && (
            <div className={`note ${msg.tone === 'ok' ? 'note-teal' : 'note-red'}`}>{msg.text}</div>
          )}
        </div>

        <div className="sheet-f">
          <span className="muted small">
            保存后程序接管：配图 → 质检 → 自动放行 → 按 ★15 分钟间隔发出
          </span>
          <span style={{ flex: 1 }} />
          {total > 1 && idx + 1 < total && (
            <button className="btn btn-sm" onClick={() => setIdx(idx + 1)} disabled={busy}>
              跳过这条
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={busy || !ready}
            data-testid="save-rewrite"
          >
            {busy ? '保存中…' : idx + 1 < total ? '保存并继续下一条' : '保存并自动发布'}
          </button>
        </div>
      </div>
    </div>
  );
}
