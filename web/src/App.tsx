import { useEffect, useState } from 'react';
import { api } from './api';
import type { FormInput, ProjectListItem } from './types';
import Workbench from './Workbench';

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [openCode, setOpenCode] = useState<string | null>(null);

  useEffect(() => {
    api.me().then((r) => setAuthed(r.authed)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="flex h-full items-center justify-center text-gray-400">Loading…</div>;

  if (!authed) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <form
          className="w-80 rounded-2xl bg-white p-6 shadow"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr('');
            try {
              await api.login(password);
              setAuthed(true);
            } catch {
              setErr('密码错误');
            }
          }}
        >
          <div className="mb-1 text-lg font-bold">EaseSourcer</div>
          <div className="mb-4 text-xs text-gray-500">素材生产工作台 · 请输入访问密码</div>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="密码"
          />
          {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
          <button className="mt-4 w-full rounded-lg py-2 text-sm font-semibold text-gray-900" style={{ background: '#2dd4a0' }}>
            登录
          </button>
        </form>
      </div>
    );
  }

  if (openCode) return <Workbench code={openCode} onClose={() => setOpenCode(null)} onCodeChange={setOpenCode} />;
  return <Home onOpen={setOpenCode} onLogout={async () => { await api.logout(); setAuthed(false); }} />;
}

function fmtEta(sec: number): string {
  if (sec <= 0) return '即将完成';
  if (sec < 60) return `约剩 ${sec}s`;
  return `约剩 ${Math.ceil(sec / 60)} 分钟`;
}
function jobProgress(job?: ProjectListItem['job']): { pct: number | null; eta: number | null; label: string } {
  if (!job || job.status !== 'running') return { pct: null, eta: null, label: '' };
  const label = job.step || '处理中';
  if (job.total && job.current != null && job.current > 0) {
    const pct = Math.round((job.current / job.total) * 100);
    let eta: number | null = null;
    try {
      const elapsed = (Date.now() - new Date(job.startedAt).getTime()) / 1000;
      eta = Math.max(0, Math.round((elapsed / job.current) * (job.total - job.current)));
    } catch {
      /* ignore */
    }
    return { pct, eta, label };
  }
  return { pct: null, eta: null, label };
}

type Tab = 'active' | 'done' | 'archived';
function categoryOf(p: ProjectListItem): Tab {
  if (p.archived) return 'archived';
  if (p.markedReady) return 'done';
  return 'active';
}

function Home({ onOpen, onLogout }: { onOpen: (code: string) => void; onLogout: () => void }) {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('active');
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const [archivingCode, setArchivingCode] = useState<string | null>(null); // 处理中
  const [exitingCode, setExitingCode] = useState<string | null>(null); // 正在播放消失动画

  const refresh = () => api.listProjects().then(setProjects).catch(() => {});
  const doArchive = async (code: string, archived: boolean) => {
    setArchivingCode(code);
    try {
      await api.archive(code, archived);
      setArchivingCode(null);
      setConfirmCode(null);
      // 乐观更新（计数即时变化）+ 退出动画后再真正移除
      setProjects((prev) => prev.map((p) => (p.code === code ? { ...p, archived } : p)));
      setExitingCode(code);
      window.setTimeout(() => { setExitingCode(null); refresh(); }, 360);
    } catch (e) {
      setArchivingCode(null);
      alert(String(e).replace(/^Error:\s*/, ''));
    }
  };
  const flash = (code: string) => {
    setHighlight(code);
    window.setTimeout(() => setHighlight((h) => (h === code ? null : h)), 4000);
  };
  const retry = async (code: string) => {
    try {
      await api.autorun(code);
      flash(code);
      refresh();
    } catch (e) {
      alert(String(e));
    }
  };
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000); // live progress for running jobs
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">EaseSourcer 素材生产工作台</h1>
          <div className="mt-2 text-xs leading-relaxed text-gray-500">
            <div className="font-medium text-gray-600">任务创建入口</div>
            <div>1. 云工厂后台的 Google 投放任务列表中的「创建落地页」按钮</div>
            <div>2. 右侧「创建落地页」按钮</div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={() => setCreating(true)} className="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold text-gray-900" style={{ background: '#2dd4a0' }}>+ 创建落地页</button>
          <button onClick={onLogout} className="whitespace-nowrap rounded-lg border border-gray-300 px-4 py-2 text-sm">退出</button>
        </div>
      </div>

      {creating && <NewProject onCreated={(code) => { setCreating(false); setTab('active'); flash(code); refresh(); }} onCancel={() => setCreating(false)} />}

      {(() => {
        const counts: Record<Tab, number> = { active: 0, done: 0, archived: 0 };
        projects.forEach((p) => { counts[categoryOf(p)]++; });
        const visible = projects.filter((p) => categoryOf(p) === tab || p.code === exitingCode); // 已按 updatedAt 倒序；正在播放消失动画的行临时保留
        const tabs: { key: Tab; label: string }[] = [
          { key: 'active', label: '处理中' },
          { key: 'done', label: '已完成' },
          { key: 'archived', label: '已归档' },
        ];
        return (
          <>
            <div className="mb-3 flex gap-1 border-b border-gray-200">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setTab(t.key); setConfirmCode(null); }}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.key ? 'border-emerald-500 font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  {t.label} <span className="ml-0.5 text-xs text-gray-400">{counts[t.key]}</span>
                </button>
              ))}
            </div>

            <div className="divide-y divide-gray-200 rounded-2xl border border-gray-200">
              {visible.length === 0 && <div className="p-6 text-center text-sm text-gray-400">该列表暂无任务</div>}
              {visible.map((p) => {
                const running = p.job?.status === 'running';
                const failed = p.job?.status === 'error';
                const isArchived = tab === 'archived';
                const restoreTarget = p.markedReady ? '已完成' : '处理中';
                const exiting = exitingCode === p.code;
                const processing = archivingCode === p.code;
                const { pct, eta, label } = jobProgress(p.job);
                return (
                  <div key={p.code} className={`grid transition-all duration-300 ease-in-out ${exiting ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
                    <div className={exiting ? 'overflow-hidden' : 'overflow-visible'}>
                      <div className={`p-4 transition-all duration-300 ${p.code === highlight ? 'bg-emerald-50' : ''} ${processing ? 'opacity-50' : ''}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold break-words">{p.merchantName ? `${p.merchantName}-${p.code}` : p.code}</div>
                            <div className="text-xs text-gray-400">
                              slug: {p.code} · {isArchived ? '已归档' : running ? '⏳ 生成中' : failed ? '⚠ 生成失败' : p.state} · {p.productCount ?? '?'} 产品 · {p.updatedAt}
                            </div>
                          </div>
                          <div className="relative flex shrink-0 gap-2">
                            {failed && !isArchived && <button onClick={() => retry(p.code)} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-900" style={{ background: '#2dd4a0' }}>重试</button>}
                            <button onClick={() => onOpen(p.code)} className="whitespace-nowrap rounded-lg border border-gray-300 px-3 py-1.5 text-sm">{running ? '查看进度' : isArchived ? '查看' : '打开'}</button>
                            <button onClick={() => setConfirmCode(confirmCode === p.code ? null : p.code)} disabled={processing} className="whitespace-nowrap rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 disabled:opacity-50">{isArchived ? '放回' : '归档'}</button>
                            {confirmCode === p.code && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setConfirmCode(null)} />
                                <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
                                  {isArchived ? (
                                    <div className="mb-2 text-gray-700">确认放回？将回到「<b>{restoreTarget}</b>」列表</div>
                                  ) : (
                                    <div className="mb-2 text-gray-700">确认归档此任务？归档后为只读，可在「已归档」放回。</div>
                                  )}
                                  <div className="flex justify-end gap-2">
                                    <button onClick={() => setConfirmCode(null)} disabled={processing} className="rounded border border-gray-300 px-2.5 py-1 disabled:opacity-50">取消</button>
                                    <button onClick={() => doArchive(p.code, !isArchived)} disabled={processing} className="inline-flex items-center gap-1 rounded px-2.5 py-1 font-semibold text-gray-900 disabled:opacity-80" style={{ background: '#2dd4a0' }}>
                                      {processing && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-700 border-t-transparent" />}
                                      {processing ? '处理中' : '确定'}
                                    </button>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        {running && (
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-xs text-gray-500">
                              <span>{label}</span>
                              <span>{pct != null ? `${pct}%　` : ''}{eta != null ? fmtEta(eta) : ''}</span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                              <div className="h-full rounded-full transition-all" style={{ width: pct != null ? `${pct}%` : '25%', background: '#2dd4a0' }} />
                            </div>
                          </div>
                        )}
                        {failed && !isArchived && <div className="mt-2 text-xs text-red-500">{p.job?.error || '生成失败'} · 点「重试」重新生成</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
    </div>
  );
}

function NewProject({ onCreated, onCancel }: { onCreated: (code: string) => void; onCancel: () => void }) {
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [nameCn, setNameCn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [zip, setZip] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!merchant.trim()) return setErr('请填写客户公司名');
    if (!category.trim()) return setErr('请填写产品类别');
    if (!nameEn.trim()) return setErr('请填写产品英文名');
    const form: FormInput = {
      code: '',
      merchantName: merchant.trim(),
      categoryHint: category.trim(),
      companyIntroCn: '',
      productFeaturesCn: description.trim(),
      useScenariosCn: '',
      products: [{ nameCn: nameCn.trim(), nameEn: nameEn.trim(), sellingPointCn: description.trim(), rawImages: [] }],
    };
    try {
      setBusy('创建中');
      const p = await api.createProject(form);
      if (zip) {
        setBusy('上传产品图');
        await api.uploadZip(p.code, zip);
      }
      setBusy('开始生成');
      await api.autorun(p.code); // kick off full generation in the background
      onCreated(p.code);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy('');
    }
  };

  const field = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
      <div className="mb-4 text-lg font-semibold">新建项目</div>

      <label className="text-xs font-medium text-gray-500">客户公司名 *</label>
      <input className={field} placeholder="如：金华市飞马箱包有限公司（决定列表显示名）" value={merchant} onChange={(e) => setMerchant(e.target.value)} />

      <label className="mt-3 block text-xs font-medium text-gray-500">产品类别 *</label>
      <input className={field} placeholder="如：化工原料 / 工业机械 / 食品配料" value={category} onChange={(e) => setCategory(e.target.value)} />

      <label className="mt-3 block text-xs font-medium text-gray-500">产品描述</label>
      <textarea className={field} rows={3} placeholder="产品的卖点、特性、用途等（中文）" value={description} onChange={(e) => setDescription(e.target.value)} />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500">产品中文名</label>
          <input className={field} placeholder="如：叶酸 食品级" value={nameCn} onChange={(e) => setNameCn(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">产品英文名 *</label>
          <input className={field} placeholder="如：Folic Acid Food Grade" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </div>
      </div>

      <label className="mt-3 block text-xs font-medium text-gray-500">上传产品图压缩包 (.zip)</label>
      <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-4 text-sm text-gray-500 transition-colors hover:border-emerald-400 hover:bg-emerald-50/50">
        <span className="text-base">📦</span>
        <span className={zip ? 'font-medium text-gray-700' : ''}>{zip ? zip.name : '点击选择 .zip 压缩包（产品照片）'}</span>
        <input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => setZip(e.target.files?.[0] || null)} />
      </label>
      {zip && <div className="mt-1 text-center text-[11px] text-gray-400">{(zip.size / 1024 / 1024).toFixed(1)} MB · 点击可重新选择</div>}

      {err && <div className="mt-3 text-xs text-red-500">{err}</div>}
      <div className="mt-4 flex gap-2">
        <button disabled={!!busy} onClick={submit} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-900" style={{ background: '#2dd4a0' }}>
          {busy ? `${busy}…` : '创建任务'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">取消</button>
      </div>
    </div>
  );
}
