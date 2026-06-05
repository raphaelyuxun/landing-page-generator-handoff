import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import Preview from './Preview';
import type { ContentData, GeneratedAsset, ImageMeta, KnobsConfig, KnobState, LogEntry, Project, ProductData, RevisionPlan } from './types';

const BRAND = '#2dd4a0';
const M1_MODULES = ['stats', 'certifications', 'testimonials'] as const;
const M2_MODULES = ['trust', 'faq'] as const;

export default function Workbench({ code, onClose, onCodeChange }: { code: string; onClose: () => void; onCodeChange?: (c: string) => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [knobsCfg, setKnobsCfg] = useState<KnobsConfig | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [admin, setAdmin] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [dimsOpen, setDimsOpen] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'issues'>('all');
  const [logOpen, setLogOpen] = useState(false);
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [showInputs, setShowInputs] = useState(false);
  const [inputsAll, setInputsAll] = useState(false);
  const [editingInput, setEditingInput] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [instruction, setInstruction] = useState('');
  const [plan, setPlan] = useState<RevisionPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptInit = useRef(false);

  const load = () => api.getProject(code).then(setProject).catch((e) => setErr(String(e)));
  useEffect(() => {
    load();
    api.getKnobsConfig().then(setKnobsCfg).catch(() => {});
  }, [code]);

  // poll for background job progress
  useEffect(() => {
    if (project?.job?.status !== 'running') return;
    const id = setInterval(() => {
      api.getProject(code).then(setProject).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [project?.job?.status, code]);

  // initialize the prompt box from knobState once (then local-controlled)
  useEffect(() => { promptInit.current = false; }, [code]);
  useEffect(() => {
    if (!promptInit.current && project?.knobState) {
      setPrompt(project.knobState.directionNote || '');
      promptInit.current = true;
    }
  }, [project?.knobState]);

  if (!project) return <div className="flex h-full items-center justify-center text-gray-400">{err || 'Loading…'}</div>;

  const jobRunning = project.job?.status === 'running';
  const ro = !!project.archived; // 已归档 → 只读，禁用一切改动

  // sync (fast) actions — show transient busy label
  const run = async (label: string, fn: () => Promise<Project>) => {
    if (ro) return;
    setBusy(label);
    setErr('');
    try {
      setProject(await fn());
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy('');
    }
  };

  // async job actions — return the project with job=running, polling takes over
  const startJob = async (fn: () => Promise<Project>) => {
    if (ro) return;
    setErr('');
    try {
      setProject(await fn());
    } catch (e) {
      setErr(String(e));
    }
  };

  // the operator's free-text directive (replaces fiddling with individual knobs)
  const savePrompt = (val: string) => {
    setPrompt(val);
    if (ro) return;
    if (promptTimer.current) clearTimeout(promptTimer.current);
    promptTimer.current = setTimeout(() => {
      const ks = project.knobState || {};
      api.setKnobs(code, null, { ...ks, directionNote: val }).then(setProject).catch((e) => setErr(String(e)));
    }, 700);
  };
  const appendToPrompt = (line: string) => savePrompt(prompt ? `${prompt}\n${line}` : line);

  const ks = project.knobState;
  const template = (ks?.template || 'm1') as 'm1' | 'm2';
  const content = project.contentDraft;
  const products = project.productsDraft || [];

  const updateDraft = async (nextContent: ContentData, nextProducts: ProductData[], edit?: unknown) => {
    if (ro) return;
    setProject({ ...project, contentDraft: nextContent, productsDraft: nextProducts });
    await api.saveDraft(code, nextContent, nextProducts, edit).then(setProject).catch((e) => setErr(String(e)));
  };

  const removeModule = (key: string) => {
    if (!content) return;
    const next = { ...content };
    delete (next as any)[key];
    updateDraft(next, products, { at: new Date().toISOString(), kind: 'remove-module', path: key });
  };

  const hasGenerated = !!content;
  const assetUrl = (name?: string) => (name ? `/assets/${code}/${name}` : undefined);

  // Step 1: ask the assistant to understand the instruction + propose a Todo list
  const sendInstruction = async () => {
    if (ro) return;
    const ins = instruction.trim();
    if (!ins) return;
    setErr('');
    setPlanning(true);
    try {
      setPlan(await api.planRevision(code, ins));
    } catch (e) {
      setErr(String(e));
    } finally {
      setPlanning(false);
    }
  };
  // Step 2: user confirmed → execute the plan
  const confirmApply = async () => {
    if (ro || !plan) return;
    setErr('');
    try {
      setProject(await api.revise(code, instruction.trim(), plan));
      setInstruction('');
      setPlan(null);
    } catch (e) {
      setErr(String(e));
    }
  };

  const jobLabel = (k?: string) =>
    k === 'profile' ? '生成品类画像' : k === 'copy' ? '生成文案' : k === 'images' ? '生成图片' : k === 'generate' || k === 'auto' ? '生成全部素材' : k === 'revise' ? '应用修改' : '处理中';

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-sm text-gray-500">← 返回</button>
          <span className="font-semibold">{project.code}</span>
          {!ro && (
            <button
              onClick={async () => {
                const nc = window.prompt('落地页 URL slug（code，决定上线网址；全局唯一，重复会被拒绝）', project.code);
                if (!nc || nc.trim() === project.code) return;
                try {
                  const np = await api.renameCode(code, nc.trim());
                  setProject(np);
                  onCodeChange?.(np.code);
                } catch (e) {
                  alert(String(e).replace(/^Error:\s*/, ''));
                }
              }}
              className="text-xs text-gray-400 hover:text-gray-700"
              title="修改落地页 URL slug"
            >
              ✎ slug
            </button>
          )}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{project.state}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {busy && <span className="text-gray-400">{busy}…</span>}
          {err && <span className="max-w-xs truncate text-red-500" title={err}>{err}</span>}
          {ro && <span className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600">📦 已归档 · 只读</span>}
          {!ro && hasGenerated && !project.markedReady && (
            <button onClick={() => run('标记完成', () => api.markReady(code, true))} disabled={jobRunning} className="rounded-lg px-4 py-1.5 text-xs font-semibold text-gray-900 disabled:opacity-50" style={{ background: BRAND }}>✓ 标记完成</button>
          )}
          {!ro && project.markedReady && (
            <>
              <span className="rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-600">已标记完成</span>
              <button onClick={() => run('取消标记', () => api.markReady(code, false))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-500">取消</button>
              <a href={api.exportUrl(code)} className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white" style={{ background: '#1f2937' }}>导出 zip</a>
            </>
          )}
        </div>
      </div>

      {ro && (
        <div className="flex items-center gap-2 bg-gray-100 px-4 py-2 text-sm text-gray-600">
          <span>📦</span>
          <span>此任务已归档，当前为<b>只读</b>模式。如需修改，请到列表「已归档」中点「放回」。</span>
        </div>
      )}

      {/* job progress / error banner */}
      {project.job && project.job.status !== 'done' && (
        <div
          className={`flex items-center gap-3 px-4 py-2 text-sm ${project.job.status === 'error' ? 'bg-red-50 text-red-700' : 'text-gray-800'}`}
          style={project.job.status === 'running' ? { background: '#e6fbf3' } : {}}
        >
          {project.job.status === 'running' ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
              <span className="font-medium">{jobLabel(project.job.kind)}</span>
              <span className="text-gray-600">{project.job.step}</span>
              {project.job.total ? (
                <span className="ml-auto flex items-center gap-2">
                  <span className="h-1.5 w-40 overflow-hidden rounded-full bg-white/70">
                    <span className="block h-full rounded-full" style={{ width: `${Math.round(((project.job.current || 0) / project.job.total) * 100)}%`, background: BRAND }} />
                  </span>
                  <span className="text-xs text-gray-500">{project.job.current || 0}/{project.job.total}</span>
                </span>
              ) : null}
            </>
          ) : (
            <>
              <span className="font-medium">生成失败</span>
              <span className="truncate" title={project.job.error}>{project.job.error}</span>
              <button onClick={load} className="ml-auto text-xs underline">刷新</button>
            </>
          )}
        </div>
      )}

      <div className="grid flex-1 grid-cols-[300px_1fr_320px] overflow-hidden">
        {/* LEFT: config (first run) → prompt (after first generation) */}
        <div className="overflow-y-auto border-r border-gray-200 bg-gray-50 p-3 text-sm">
          {hasGenerated ? (
            /* ===== 修改模式：统一 Prompt 入口 ===== */
            <>
              <Section title="与素材助手对话">
                {!plan ? (
                  <>
                    <textarea
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs"
                      rows={4}
                      placeholder={'用一句话描述要改什么，例如：\n· 标题更强调耐腐蚀和压力等级\n· banner 换成车间产线场景\n· 第 2 个产品的图背景太乱，重做\n· 所有产品图都用更亮的白底'}
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                    />
                    <button onClick={sendInstruction} disabled={planning || jobRunning || ro || !instruction.trim()} className="mt-2 w-full rounded-lg px-3 py-2 text-xs font-semibold text-gray-900 disabled:opacity-50" style={{ background: BRAND }}>
                      {planning ? '理解中…' : '发送'}
                    </button>
                    <div className="mt-1 text-[10px] text-gray-400">助手会先复述理解、列出待办，确认后再执行。</div>
                  </>
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs">
                    <div className="font-semibold text-gray-700">🤖 我的理解</div>
                    <div className="mt-1 text-gray-600">{plan.understanding}</div>
                    {plan.todos.length > 0 && (
                      <>
                        <div className="mt-2 font-semibold text-gray-700">将执行</div>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-gray-600">
                          {plan.todos.map((t, i) => <li key={i}>{t}</li>)}
                        </ul>
                      </>
                    )}
                    <div className="mt-2 text-[10px] text-gray-400">
                      影响：{[plan.copy && '文案', plan.banner && 'banner', plan.productIndexes.length ? `产品图 ${plan.productIndexes.map((i) => i + 1).join(',')}` : ''].filter(Boolean).join('、') || '（无）'}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={confirmApply} disabled={jobRunning} className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-900 disabled:opacity-50" style={{ background: BRAND }}>确认执行</button>
                      <button onClick={() => setPlan(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs">重新描述</button>
                    </div>
                  </div>
                )}
              </Section>

              <Section title={<button onClick={() => setShowInputs(!showInputs)} className="text-left">输入与配置 {showInputs ? '▲' : '▼'}</button>}>
                {showInputs && (
                  <div className="space-y-2 text-xs text-gray-600">
                    <div><b>类别:</b> {project.formInput.categoryHint || '—'}</div>
                    <div><b>产品:</b> {project.formInput.products.map((p) => p.nameEn).join('、')}</div>
                    {project.categoryProfile && <div><b>画像:</b> {project.categoryProfile.categoryLabel}</div>}
                    <div><b>模版:</b> {ks?.template} · <b>识别产品:</b> {project.formInput.products.length} 个</div>
                    <RawUpload code={code} onDone={load} />
                    <button onClick={() => startJob(() => api.profile(code))} className="text-gray-400 underline disabled:opacity-50" disabled={jobRunning}>重新识别产品/画像（会需要重新生成）</button>
                  </div>
                )}
              </Section>
            </>
          ) : (
            /* ===== 首次配置模式 ===== */
            <>
              <Section title="客户输入">
                <div className="space-y-1 text-xs text-gray-600">
                  <div><b>类别:</b> {project.formInput.categoryHint || '—'}</div>
                  <div><b>产品:</b> {project.formInput.products[0]?.nameEn} / {project.formInput.products[0]?.nameCn}</div>
                  <div><b>描述:</b> {project.formInput.productFeaturesCn || '—'}</div>
                  <div><b>原图:</b> {project.formInput.products[0]?.rawImages?.length || 0} 张</div>
                </div>
                <RawUpload code={code} onDone={load} />
              </Section>

              <Section title="品类画像">
                {!project.categoryProfile ? (
                  <button onClick={() => startJob(() => api.profile(code))} className="w-full rounded-lg px-3 py-2 text-xs font-semibold text-gray-900 disabled:opacity-50" style={{ background: BRAND }} disabled={jobRunning}>
                    ① 生成品类画像 + 识别产品
                  </button>
                ) : (
                  <div className="text-xs text-gray-600">
                    <div className="font-medium">{project.categoryProfile.categoryLabel}</div>
                    <div className="mt-1 text-gray-400">锚点: {project.categoryProfile.matchedAnchors.join(', ')}</div>
                    <div className="text-gray-400">识别产品: {project.formInput.products.length} 个</div>
                    <button onClick={() => startJob(() => api.profile(code))} className="mt-2 text-gray-400 underline disabled:opacity-50" disabled={jobRunning}>重新生成画像/产品</button>
                  </div>
                )}
              </Section>

              {project.recommendedCombos && (
                <Section title="推荐组合 (一键选用)">
                  <div className="space-y-2">
                    {project.recommendedCombos.map((c) => (
                      <button key={c.archetype} onClick={() => run('应用组合', () => api.setKnobs(code, c.archetype, { directionNote: prompt }))}
                        className="w-full rounded-lg border border-gray-200 p-2 text-left text-xs hover:border-gray-400">
                        <div className="font-semibold">{c.displayName}</div>
                        <div className="text-gray-400">{c.fitFor}</div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {ks && (
                <Section title="调整方向 (可选)">
                  <textarea
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs"
                    rows={4}
                    placeholder={'用自然语言描述整体方向（可留空，之后也能改），例如：\n· 语气克制专业，突出工厂产能与 CE 认证\n· 产品图用工业现场风格、冷静专业色调'}
                    value={prompt}
                    onChange={(e) => savePrompt(e.target.value)}
                  />
                  <div className="mt-3 flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-1">品牌色
                      <input type="color" value={ks.brandColor || '#2dd4a0'} onChange={(e) => run('更新', () => api.setKnobs(code, null, { ...ks, brandColor: e.target.value }))} />
                    </label>
                    <span className="text-gray-400">版式：模版1（暂固定）</span>
                  </div>
                  {knobsCfg && (
                    <div className="mt-3">
                      <button onClick={() => setDimsOpen(!dimsOpen)} className="text-[11px] text-gray-500">💡 可写入的调整维度（点击加入） {dimsOpen ? '▲' : '▼'}</button>
                      {dimsOpen && (
                        <div className="mt-2 space-y-1">
                          {Object.entries(knobsCfg.knobs).filter(([, d]) => !d.freeText && d.options.length > 0).map(([key, d]) => (
                            <div key={key} className="flex items-start gap-1">
                              <button onClick={() => appendToPrompt(`${d.label}：${d.options[0].label}`)} className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-200">+ {d.label}</button>
                              <span className="text-[10px] leading-5 text-gray-400">{d.options.map((o) => o.label).join(' / ')}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {knobsCfg && (
                    <div className="mt-3">
                      <button onClick={() => setAdvanced(!advanced)} className="text-[11px] text-gray-500">⚙ 高级：精细旋钮（可选） {advanced ? '▲' : '▼'}</button>
                      {advanced && (
                        <div className="mt-2">
                          <label className="mb-1 block text-[10px] text-gray-400"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> 管理选项</label>
                          <KnobEditor knobsCfg={knobsCfg} ks={ks} admin={admin} onChange={(next) => run('更新', () => api.setKnobs(code, null, next as any))} onCfgChange={async (cfg) => { await api.saveKnobsConfig(cfg); setKnobsCfg(cfg); }} />
                        </div>
                      )}
                    </div>
                  )}
                </Section>
              )}

              {ks && (
                <button onClick={() => startJob(() => api.generateAll(code))} disabled={jobRunning || ro} className="mb-4 w-full rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-900 disabled:opacity-50" style={{ background: BRAND }}>
                  ✨ 生成全部素材（文案 + 图片，约数分钟）
                </button>
              )}
            </>
          )}

          {/* 全部输入内容（左栏，默认收起，用于快速确认 / 编辑兜底） */}
          <Section title={
            <div className="flex items-center justify-between">
              <button onClick={() => setInputsAll(!inputsAll)} className="text-left">全部输入内容 {inputsAll ? '▲' : '▼'}</button>
              <button onClick={() => setEditingInput(true)} disabled={jobRunning || ro} className="rounded border border-gray-300 px-2 py-0.5 text-[10px] text-gray-500 hover:border-gray-400 disabled:opacity-40">✎ 编辑/替换</button>
            </div>
          }>
            {inputsAll && <InputDump project={project} code={code} onImg={setLightbox} />}
          </Section>

          {/* L2 Prompt 存档（左栏，折叠） */}
          {project.l2Prompts && (
            <Section title={<button onClick={() => setShowPrompts(!showPrompts)} className="text-left">L2 Prompt 存档 {showPrompts ? '▲' : '▼'}</button>}>
              {showPrompts && (
                <div className="space-y-2">
                  {project.l2Prompts.copy && (
                    <details><summary className="cursor-pointer text-xs font-medium">文案 prompt</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[10px] text-gray-600">{project.l2Prompts.copy.text}</pre>
                    </details>
                  )}
                  {project.l2Prompts.images?.map((p, i) => (
                    <details key={i}><summary className="cursor-pointer text-xs font-medium">{p.label || `图片 prompt #${i + 1}`}</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[10px] text-gray-600">{p.text}</pre>
                    </details>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* 接口 Payload 存档（左栏，默认收起；仅外部接口创建的任务有） */}
          {project.apiPayload != null && (
            <Section title={<button onClick={() => setPayloadOpen(!payloadOpen)} className="text-left">接口 Payload 存档 {payloadOpen ? '▲' : '▼'}</button>}>
              {payloadOpen && (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-900 p-2 font-mono text-[10px] leading-5 text-gray-300">{JSON.stringify(project.apiPayload, null, 2)}</pre>
              )}
            </Section>
          )}

          {/* 生成日志（左栏底部，默认收起） */}
          <Section
            title={
              <div className="flex items-center justify-between">
                <button onClick={() => setLogOpen(!logOpen)} className="text-left">生成日志 {logOpen ? '▲' : '▼'}</button>
                {logOpen && (
                  <span className="flex gap-1 text-[10px]">
                    <button onClick={() => setLogFilter('all')} className={`rounded px-1.5 py-0.5 ${logFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-500'}`}>全部</button>
                    <button onClick={() => setLogFilter('issues')} className={`rounded px-1.5 py-0.5 ${logFilter === 'issues' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-500'}`}>仅警告/错误</button>
                  </span>
                )}
              </div>
            }
          >
            {logOpen && <LogPanel logs={project.logs || []} filter={logFilter} />}
          </Section>
        </div>

        {/* CENTER: preview */}
        <div className="overflow-y-auto bg-gray-100 p-4">
          {content ? (
            <div className="mx-auto max-w-5xl overflow-hidden rounded-xl shadow">
              <Preview code={code} content={content} products={products} assets={project.assets || []} template={template} version={project.assetsVersion || project.createdAt} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">尚未生成文案 — 在左栏配置后点「生成文案」</div>
          )}
        </div>

        {/* RIGHT: all generated assets */}
        <div className="overflow-y-auto border-l border-gray-200 bg-white p-3 text-sm">
          {!hasGenerated ? (
            <div className="mt-12 px-4 text-center text-xs leading-6 text-gray-400">完成首次生成后，<br />这里会显示全部产物：<br />文案模块、banner、参考图、产品图</div>
          ) : (
            <>
              {project.validationReport && project.validationReport.hardClaimViolations.length > 0 && (
                <Section title="校验提示">
                  {project.validationReport.hardClaimViolations.map((v, i) => (
                    <div key={i} className="mb-1 rounded bg-yellow-50 p-2 text-xs text-yellow-700">{v.path}: {v.reason} → {v.action}</div>
                  ))}
                </Section>
              )}

              <Section title="文案模块 (改 / 删)">
                <ModuleTree content={content!} template={template} onRemove={removeModule} onEdit={(next) => updateDraft(next, products)} />
              </Section>

              <Section title="产品文案">
                <div className="space-y-2">
                  {products.map((p, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-2 text-xs">
                      <CommitField className="w-full font-medium outline-none" value={p.productName} onCommit={(v) => { const np = [...products]; np[i] = { ...p, productName: v }; updateDraft(content!, np); }} />
                      <CommitField multiline rows={2} className="mt-1 w-full text-gray-500 outline-none" value={p.description || ''} onCommit={(v) => { const np = [...products]; np[i] = { ...p, description: v }; updateDraft(content!, np); }} />
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="图片产物">
                <AssetsGallery code={code} assets={project.assets || []} products={products} version={project.assetsVersion || project.createdAt} onImg={setLightbox} />
              </Section>
            </>
          )}
        </div>
      </div>

      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
      {editingInput && (
        <EditInputModal
          project={project}
          code={code}
          onClose={() => setEditingInput(false)}
          onSaved={(p) => { setEditingInput(false); setProject(p); }}
        />
      )}
    </div>
  );
}

/** 编辑输入内容弹窗（兜底）：带入现有信息可改，可 zip 替换全部图片；保存即干净重跑全量生成 */
function EditInputModal({ project, code, onClose, onSaved }: { project: Project; code: string; onClose: () => void; onSaved: (p: Project) => void }) {
  const echo = (project.echo || {}) as Record<string, string>;
  const seed = project.formInput.products[0];
  const [merchantName, setMerchantName] = useState(echo.merchant_name || project.formInput.merchantName || '');
  const [nickname, setNickname] = useState(echo.nickname || '');
  const [categoryHint, setCategoryHint] = useState(project.formInput.categoryHint || '');
  const [nameCn, setNameCn] = useState(seed?.nameCn || '');
  const [nameEn, setNameEn] = useState(seed?.nameEn || '');
  const [productDesc, setProductDesc] = useState(project.formInput.productFeaturesCn || seed?.sellingPointCn || '');
  const [excludeRegion, setExcludeRegion] = useState(echo.exclude_region || '');
  // 图片工作列表：每张 = {ref, url, nameCn, nameEn, description}；初始读 imageMeta（兼容旧 imageDescriptions）
  const metaInit: Record<string, ImageMeta> = project.formInput.imageMeta
    || Object.fromEntries(Object.entries(project.formInput.imageDescriptions || {}).map(([r, d]) => [r, { description: d } as ImageMeta]));
  const initImgs = (project.formInput.allRawImages && project.formInput.allRawImages.length
    ? project.formInput.allRawImages
    : project.formInput.products.flatMap((p) => p.rawImages || []))
    .filter((r, i, a) => a.indexOf(r) === i)
    .map((ref) => ({ ref, url: `/assets/${code}/${ref}`, nameCn: metaInit[ref]?.nameCn || '', nameEn: metaInit[ref]?.nameEn || '', description: metaInit[ref]?.description || '' }));
  const [imgs, setImgs] = useState(initImgs);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const onZip = async (file: File | null) => {
    if (!file) return;
    setErr('');
    setUploading(true);
    try {
      const r = await api.stageZip(code, file);
      // zip = 替换全部：用 zip 的图替换工作列表
      setImgs(r.images.map((im) => ({ ref: im.ref, url: im.url, nameCn: '', nameEn: '', description: '' })));
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setUploading(false);
    }
  };
  const onAddImage = async (file: File | null) => {
    if (!file) return;
    setErr('');
    setUploading(true);
    try {
      const r = await api.stageImage(code, file);
      // 单张追加到工作列表
      setImgs((cur) => [...cur, { ref: r.ref, url: r.url, nameCn: '', nameEn: '', description: '' }]);
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setUploading(false);
    }
  };
  const removeImg = (ref: string) => setImgs((cur) => cur.filter((im) => im.ref !== ref));
  const setField = (ref: string, k: 'nameCn' | 'nameEn' | 'description', v: string) =>
    setImgs((cur) => cur.map((im) => (im.ref === ref ? { ...im, [k]: v } : im)));

  const submit = async () => {
    setErr('');
    if (!nameEn.trim()) return setErr('请填写产品英文名');
    setBusy(true);
    try {
      const meta: Record<string, ImageMeta> = {};
      imgs.forEach((im) => {
        const m: ImageMeta = {};
        if (im.nameCn.trim()) m.nameCn = im.nameCn.trim();
        if (im.nameEn.trim()) m.nameEn = im.nameEn.trim();
        if (im.description.trim()) m.description = im.description.trim();
        if (m.nameCn || m.nameEn || m.description) meta[im.ref] = m;
      });
      const p = await api.editInput(code, { merchantName, nickname, categoryHint, nameCn, nameEn, productDesc, excludeRegion }, { meta, images: imgs.map((im) => im.ref) });
      onSaved(p);
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/, ''));
      setBusy(false);
    }
  };

  const field = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-semibold">编辑输入内容</div>
        <div className="mb-4 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">保存后将用新输入<b>重新生成全部素材</b>（覆盖当前文案与图片，并重置「标记完成」），约数分钟。</div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium text-gray-500">客户公司名</label><input className={field} value={merchantName} onChange={(e) => setMerchantName(e.target.value)} /></div>
          <div><label className="text-xs font-medium text-gray-500">昵称</label><input className={field} value={nickname} onChange={(e) => setNickname(e.target.value)} /></div>
        </div>
        <label className="mt-3 block text-xs font-medium text-gray-500">产品类别</label>
        <input className={field} value={categoryHint} onChange={(e) => setCategoryHint(e.target.value)} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium text-gray-500">产品中文名</label><input className={field} value={nameCn} onChange={(e) => setNameCn(e.target.value)} /></div>
          <div><label className="text-xs font-medium text-gray-500">产品英文名 *</label><input className={field} value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></div>
        </div>
        <label className="mt-3 block text-xs font-medium text-gray-500">产品描述</label>
        <textarea className={field} rows={3} value={productDesc} onChange={(e) => setProductDesc(e.target.value)} />
        <label className="mt-3 block text-xs font-medium text-gray-500">排除地区</label>
        <input className={field} value={excludeRegion} onChange={(e) => setExcludeRegion(e.target.value)} />

        <div className="mt-4 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-500">图片信息（{imgs.length} 张）</label>
          <div className="flex items-center gap-1">
            <label className="cursor-pointer rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:border-emerald-400">
              {uploading ? '处理中…' : '➕ 单张添加'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { onAddImage(e.target.files?.[0] || null); e.currentTarget.value = ''; }} />
            </label>
            <label className="cursor-pointer rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:border-emerald-400">
              📦 压缩包替换全部
              <input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { onZip(e.target.files?.[0] || null); e.currentTarget.value = ''; }} />
            </label>
          </div>
        </div>
        <div className="mt-1 text-[11px] text-gray-400">可单张添加、单张删除（✕），或用压缩包替换全部；每张可填中文名 / 英文名 / 描述（均可选，作生成强参考）。取消编辑不影响原图。</div>
        {imgs.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-gray-300 p-4 text-center text-xs text-gray-400">暂无图片 — 点「单张添加」或「压缩包替换全部」</div>
        ) : (
          <div className="mt-2 space-y-2">
            {imgs.map((im) => (
              <div key={im.ref} className="flex gap-2">
                <div className="relative shrink-0">
                  <img src={im.url} alt="" className="h-20 w-20 rounded border border-gray-200 object-cover" />
                  <button onClick={() => removeImg(im.ref)} title="删除这张图" className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white shadow hover:bg-red-600">✕</button>
                </div>
                <div className="flex w-full flex-col gap-1">
                  <div className="grid grid-cols-2 gap-1">
                    <input className="rounded border border-gray-200 px-2 py-1 text-xs" placeholder="产品中文名（可选）" value={im.nameCn} onChange={(e) => setField(im.ref, 'nameCn', e.target.value)} />
                    <input className="rounded border border-gray-200 px-2 py-1 text-xs" placeholder="产品英文名（可选）" value={im.nameEn} onChange={(e) => setField(im.ref, 'nameEn', e.target.value)} />
                  </div>
                  <textarea
                    className="min-h-[2.5rem] w-full resize-none rounded border border-gray-200 px-2 py-1 text-xs"
                    placeholder="图片描述（可选），例如：户外防腐不锈钢外壳"
                    value={im.description}
                    onChange={(e) => setField(im.ref, 'description', e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {err && <div className="mt-3 text-xs text-red-500">{err}</div>}
        <div className="mt-5 flex gap-2">
          <button disabled={busy} onClick={submit} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-50" style={{ background: BRAND }}>{busy ? '保存并重新生成…' : '保存并重新生成'}</button>
          <button disabled={busy} onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">取消</button>
        </div>
      </div>
    </div>
  );
}

/** 全屏图片查看：关闭角标 + 缩放 + 拖拽平移 */
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const zoomBy = (f: number) => setScale((s) => Math.min(8, Math.max(0.2, +(s * f).toFixed(3))));
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }); };
  const btn = 'flex h-8 min-w-8 items-center justify-center rounded-md bg-white/90 px-2 text-sm font-semibold text-gray-800 shadow hover:bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={onClose}>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button className={btn} title="缩小" onClick={() => zoomBy(1 / 1.25)}>−</button>
        <button className={btn} title="重置" onClick={reset}>{Math.round(scale * 100)}%</button>
        <button className={btn} title="放大" onClick={() => zoomBy(1.25)}>+</button>
        <button className={btn} title="关闭 (Esc)" onClick={onClose}>✕</button>
      </div>
      <img
        src={url}
        alt=""
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => { zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }}
        onMouseDown={(e) => { e.preventDefault(); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; setGrabbing(true); }}
        onMouseMove={(e) => { if (drag.current) setPos({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) }); }}
        onMouseUp={() => { drag.current = null; setGrabbing(false); }}
        onMouseLeave={() => { drag.current = null; setGrabbing(false); }}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, cursor: grabbing ? 'grabbing' : 'grab', maxHeight: '88vh', maxWidth: '88vw' }}
        className="select-none rounded-lg shadow-2xl"
      />
    </div>
  );
}

/** 原始输入内容展示（文字 + 输入原图），只读，用于快速确认 */
function InputDump({ project, code, onImg }: { project: Project; code: string; onImg: (url: string) => void }) {
  const f = project.formInput;
  const echo = (project.echo || {}) as Record<string, string>;
  const imgs = (f.allRawImages && f.allRawImages.length ? f.allRawImages : f.products.flatMap((p) => p.rawImages || []))
    .filter((r, i, a) => a.indexOf(r) === i);
  const Row = ({ k, v }: { k: string; v?: string }) => (
    <div className="flex gap-1"><span className="shrink-0 text-gray-400">{k}：</span><span className="break-words text-gray-700">{v || '—'}</span></div>
  );
  return (
    <div className="space-y-2 text-xs">
      <div className="space-y-1 rounded-lg bg-white p-2">
        <Row k="客户公司名" v={echo.merchant_name} />
        <Row k="昵称" v={echo.nickname} />
        <Row k="产品类别" v={f.categoryHint} />
        <Row k="产品中文名" v={f.products[0]?.nameCn} />
        <Row k="产品英文名" v={f.products[0]?.nameEn} />
        <Row k="产品描述" v={f.productFeaturesCn || f.products[0]?.sellingPointCn} />
        {echo.exclude_region && <Row k="排除地区" v={echo.exclude_region} />}
        {echo.task_type && <Row k="任务类型" v={echo.task_type} />}
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase text-gray-400">输入原图与信息 ({imgs.length})</div>
        {imgs.length === 0 ? (
          <div className="text-gray-400">无</div>
        ) : (
          <div className="space-y-1.5">
            {imgs.map((r, i) => {
              const u = `/assets/${code}/${r}`;
              const m: ImageMeta | undefined = (project.formInput.imageMeta || {})[r]
                || ((project.formInput.imageDescriptions || {})[r] ? { description: (project.formInput.imageDescriptions || {})[r] } : undefined);
              const hasAny = m && (m.nameCn || m.nameEn || m.description);
              return (
                <div key={i} className="flex gap-2">
                  <img src={u} alt="" onClick={() => onImg(u)} className="h-12 w-12 shrink-0 cursor-zoom-in rounded border border-gray-200 object-cover" />
                  <div className="min-w-0 flex-1 self-center text-[11px] leading-snug text-gray-600">
                    {hasAny ? (
                      <>
                        {(m!.nameCn || m!.nameEn) && <div className="text-gray-700">{[m!.nameCn, m!.nameEn].filter(Boolean).join(' / ')}</div>}
                        {m!.description && <div className="text-gray-500">{m!.description}</div>}
                      </>
                    ) : (
                      <span className="text-gray-300">（无信息）</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetsGallery({ code, assets, products, version, onImg }: { code: string; assets: GeneratedAsset[]; products: ProductData[]; version: string; onImg: (url: string) => void }) {
  const url = (n: string) => `/assets/${code}/${n}?v=${encodeURIComponent(version)}`;
  const banner = assets.find((a) => a.kind === 'banner');
  const refs = assets.filter((a) => a.kind === 'style-reference');
  const prods = assets.filter((a) => a.kind === 'product').sort((a, b) => a.exportName.localeCompare(b.exportName));
  const Thumb = ({ a, label }: { a: GeneratedAsset; label: string }) => (
    <div className="block">
      <div className="relative">
        <img src={url(a.exportName)} alt={label} onClick={() => onImg(url(a.exportName))} className="aspect-square w-full cursor-zoom-in rounded-lg border border-gray-200 object-cover" />
        {a.qa?.needsAttention && <span className="absolute right-1 top-1 rounded bg-amber-500 px-1 text-[9px] text-white" title="需人工检查（图中疑似有文字等）">⚠</span>}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-gray-500" title={label}>{label}</div>
    </div>
  );
  if (assets.length === 0) return <div className="text-xs text-gray-400">暂无图片</div>;
  return (
    <div className="space-y-3">
      {banner && (
        <div>
          <div className="mb-1 text-[10px] uppercase text-gray-400">Banner</div>
          <Thumb a={banner} label="banner" />
        </div>
      )}
      <div>
        <div className="mb-1 text-[10px] uppercase text-gray-400">产品图 ({prods.length})</div>
        <div className="grid grid-cols-2 gap-2">
          {prods.map((a) => (
            <Thumb key={a.exportName} a={a} label={products[a.productIndex ?? -1]?.productName || a.exportName.replace('images/', '')} />
          ))}
        </div>
      </div>
      {refs.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase text-gray-400">参考图 ({refs.length}) · 产品图应与此风格一致</div>
          <div className="grid grid-cols-2 gap-2">
            {refs.map((a) => (
              <Thumb key={a.exportName} a={a} label={a.exportName.replace('images/', '').replace('.png', '')} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LogPanel({ logs, filter }: { logs: LogEntry[]; filter: 'all' | 'issues' }) {
  const ref = useRef<HTMLDivElement>(null);
  const filtered = filter === 'issues' ? logs.filter((l) => l.level !== 'info') : logs;
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [filtered.length]);
  const color = (lv: LogEntry['level']) => (lv === 'error' ? 'text-red-400' : lv === 'warn' ? 'text-amber-400' : 'text-gray-400');
  const icon = (lv: LogEntry['level']) => (lv === 'error' ? '✗' : lv === 'warn' ? '⚠' : '·');
  const t = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
    } catch {
      return '';
    }
  };
  return (
    <div ref={ref} className="max-h-80 min-h-[8rem] overflow-auto rounded-lg bg-gray-900 p-2 font-mono text-[10px] leading-5">
      {filtered.length === 0 ? (
        <div className="text-gray-500">暂无日志</div>
      ) : (
        filtered.map((l, i) => (
          <div key={i} className={color(l.level)}>
            <span className="text-gray-600">{t(l.at)}</span> {icon(l.level)} {l.msg}
          </div>
        ))
      )}
    </div>
  );
}

/** 文本输入：编辑时只改本地状态（丝滑、不卡），失焦（或单行回车）才提交到预览+保存。
 *  外部 value 变化（如重新生成/AI 修改）时同步刷新。 */
function CommitField({
  value,
  onCommit,
  multiline,
  className,
  rows,
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  className?: string;
  rows?: number;
}) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  if (multiline) {
    return <textarea className={className} rows={rows} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />;
  }
  return (
    <input
      className={className}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</div>
      {children}
    </div>
  );
}

function RawUpload({ code, onDone }: { code: string; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState(false);
  return (
    <div className="mt-2">
      <input ref={ref} type="file" accept=".zip,application/zip" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setUp(true);
        try {
          await api.uploadZip(code, f);
          onDone();
        } finally {
          setUp(false);
        }
      }} />
      <button onClick={() => ref.current?.click()} className="text-xs text-gray-400 underline">{up ? '上传中…' : '+ 追加产品图压缩包 (i2i 用)'}</button>
    </div>
  );
}

function KnobEditor({ knobsCfg, ks, admin, onChange, onCfgChange }: {
  knobsCfg: KnobsConfig;
  ks: KnobState;
  admin: boolean;
  onChange: (next: KnobState) => void;
  onCfgChange: (cfg: KnobsConfig) => void;
}) {
  const groups: Record<string, string[]> = { shared: [], image: [], copy: [] };
  for (const [key, def] of Object.entries(knobsCfg.knobs)) (groups[def.group] ||= []).push(key);

  const set = (key: string, value: any) => onChange({ ...ks, [key]: value });

  return (
    <div className="space-y-3">
      {(['shared', 'image', 'copy'] as const).map((g) => (
        <div key={g}>
          <div className="mb-1 text-[10px] uppercase text-gray-300">{g}</div>
          {groups[g].map((key) => {
            const def = knobsCfg.knobs[key];
            const cur = (ks as any)[key];
            if (def.freeText) {
              return (
                <div key={key} className="mb-1">
                  <label className="text-[11px] text-gray-500">{def.label}</label>
                  <input className="w-full rounded border border-gray-200 px-2 py-1 text-xs" value={cur || ''} onChange={(e) => set(key, e.target.value)} />
                </div>
              );
            }
            if (def.multi) {
              return (
                <div key={key} className="mb-1">
                  <label className="text-[11px] text-gray-500">{def.label}</label>
                  <div className="flex flex-wrap gap-1">
                    {def.options.map((o) => {
                      const on = Array.isArray(cur) && cur.includes(o.value);
                      return (
                        <button key={o.value} onClick={() => set(key, on ? cur.filter((x: string) => x !== o.value) : [...(cur || []), o.value])}
                          className={`rounded-full px-2 py-0.5 text-[10px] ${on ? 'text-gray-900' : 'bg-gray-100 text-gray-500'}`} style={on ? { background: BRAND } : {}}>
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }
            return (
              <div key={key} className="mb-1">
                <label className="text-[11px] text-gray-500">{def.label}</label>
                <div className="flex gap-1">
                  <select className="w-full rounded border border-gray-200 px-2 py-1 text-xs" value={cur} onChange={(e) => set(key, e.target.value)}>
                    {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {admin && (
                    <button title="删除当前选项" className="text-red-400" onClick={() => {
                      const cfg = structuredClone(knobsCfg);
                      cfg.knobs[key].options = cfg.knobs[key].options.filter((o) => o.value !== cur);
                      onCfgChange(cfg);
                    }}>−</button>
                  )}
                </div>
                {admin && (
                  <button className="text-[10px] text-gray-400 underline" onClick={() => {
                    const value = prompt('新选项 value (英文)'); if (!value) return;
                    const label = prompt('显示名 label') || value;
                    const block = prompt(def.group === 'image' ? '注入图片 L2 的模板片段 (l2Block)' : '注入文案 L2 的指令 (copyDirective)') || '';
                    const cfg = structuredClone(knobsCfg);
                    cfg.knobs[key].options.push(def.group === 'image' ? { value, label, l2Block: block } : { value, label, copyDirective: block });
                    onCfgChange(cfg);
                  }}>+ 新增选项</button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ModuleTree({ content, template, onRemove, onEdit }: {
  content: ContentData;
  template: 'm1' | 'm2';
  onRemove: (key: string) => void;
  onEdit: (next: ContentData) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const modules = template === 'm1' ? M1_MODULES : M2_MODULES;
  const present = ['title', 'subtitle', 'cta', ...modules].filter((k) => k === 'title' || k === 'subtitle' || (content as any)[k]);

  return (
    <div className="space-y-1">
      {present.map((key) => (
        <div key={key} className="rounded-lg border border-gray-200">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-medium">{key}</span>
            <div className="flex gap-2 text-xs">
              <button onClick={() => setEditing(editing === key ? null : key)} className="text-gray-400">改</button>
              {key !== 'title' && key !== 'subtitle' && <button onClick={() => onRemove(key)} className="text-red-400">−</button>}
            </div>
          </div>
          {editing === key && <ModuleEditor content={content} field={key} onEdit={onEdit} />}
        </div>
      ))}
    </div>
  );
}

function ModuleEditor({ content, field, onEdit }: { content: ContentData; field: string; onEdit: (n: ContentData) => void }) {
  const set = (v: any) => onEdit({ ...content, [field]: v });
  if (field === 'title' || field === 'subtitle') {
    return <CommitField multiline rows={2} className="w-full border-t border-gray-100 p-2 text-xs outline-none" value={(content as any)[field] || ''} onCommit={set} />;
  }
  // generic JSON editor for module objects (keeps it robust across module shapes)
  return (
    <textarea
      className="w-full border-t border-gray-100 p-2 font-mono text-[10px] outline-none"
      rows={6}
      defaultValue={JSON.stringify((content as any)[field], null, 2)}
      onBlur={(e) => {
        try {
          set(JSON.parse(e.target.value));
        } catch {
          /* ignore invalid json until valid */
        }
      }}
    />
  );
}
