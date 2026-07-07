import { useState, useEffect, useRef } from 'react';
import { api } from './api';

// 统一「创新业务内部服务」密码门设计（深色 + canvas 动效）。单访问密码，校验走 api.login。
export default function Gate({ onOk }: { onOk: () => void }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const submit = async () => {
    setErr('');
    try {
      await api.login(password);
      onOk();
    } catch {
      setErr('密码不正确，请重试');
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0, h = 0, dpr = 1, raf = 0;
    const colors = [[64, 92, 120], [90, 110, 140], [70, 120, 110], [60, 80, 110], [80, 100, 130]];
    const orbs = Array.from({ length: 5 }, (_, i) => ({
      x: Math.random(), y: Math.random(), r: 0.3 + Math.random() * 0.22,
      vx: (Math.random() - 0.5) * 0.00015, vy: (Math.random() - 0.5) * 0.00015,
      c: colors[i % colors.length] as number[], ph: Math.random() * Math.PI * 2,
    }));
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const gridStep = 34;
    let t = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += 0.0045;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const o of orbs) {
        o.x += o.vx; o.y += o.vy;
        if (o.x < -0.2 || o.x > 1.2) o.vx *= -1;
        if (o.y < -0.2 || o.y > 1.2) o.vy *= -1;
        const cx = o.x * w, cy = o.y * h, rad = o.r * Math.max(w, h);
        const alpha = 0.12 + (0.5 + 0.5 * Math.sin(t + o.ph)) * 0.1;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, `rgba(${o.c[0]},${o.c[1]},${o.c[2]},${alpha})`);
        g.addColorStop(1, `rgba(${o.c[0]},${o.c[1]},${o.c[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      const off = (t * 22) % gridStep;
      for (let x = -off; x < w + gridStep; x += gridStep) {
        for (let y = -off; y < h + gridStep; y += gridStep) {
          const wave = 0.5 + 0.5 * Math.sin((x + y) * 0.012 - t * 2.2);
          ctx.fillStyle = `rgba(160,195,225,${0.1 + wave * 0.3})`;
          ctx.beginPath(); ctx.arc(x, y, 1.1 + wave * 1.6, 0, Math.PI * 2); ctx.fill();
        }
      }
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'radial-gradient(140% 120% at 50% 8%,#12171f 0%,#0a0d12 55%,#07090c 100%)', fontFamily: "'IBM Plex Sans',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif" }}>
      <style>{'@keyframes gate-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}.eg-in::placeholder{color:#4a5568}.eg-btn:hover{background:linear-gradient(180deg,rgba(56,70,92,.95),rgba(38,49,66,.95));border-color:rgba(127,214,194,.4)}'}</style>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 420, animation: 'gate-rise .9s cubic-bezier(.16,1,.3,1) both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22, paddingLeft: 2 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg,#2e3a4d,#1a2230)', border: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#7fd6c2', boxShadow: '0 0 10px rgba(127,214,194,.55)' }} />
            </div>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: '#6b7a90' }}>创新业务内部服务</span>
          </div>
          <div style={{ borderRadius: 18, padding: '34px 32px 30px', background: 'linear-gradient(180deg,rgba(23,29,38,.78),rgba(15,19,26,.78))', border: '1px solid rgba(255,255,255,.06)', boxShadow: '0 24px 60px -20px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.04)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
            <h1 style={{ margin: 0, fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 500, letterSpacing: '-.01em', color: '#e6ecf5' }}>EaseSourcer</h1>
            <p style={{ margin: '10px 0 26px', fontSize: 13.5, lineHeight: 1.6, color: '#7a879b' }}>素材生产工作台 · 该服务受访问控制保护，请输入密码以继续。</p>
            <label style={{ display: 'block', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: '#5c6a7e', marginBottom: 9 }}>访问密码</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 48, borderRadius: 11, background: 'rgba(9,12,17,.75)', border: '1px solid rgba(255,255,255,.08)', transition: 'border-color .25s,box-shadow .25s' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}><rect x="4" y="10.5" width="16" height="10" rx="2.5" stroke="#5c6a7e" strokeWidth="1.6" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="#5c6a7e" strokeWidth="1.6" /></svg>
              <input className="eg-in" type="password" autoFocus placeholder="请输入密码" value={password}
                onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
                onFocus={(e) => { const p = e.target.parentElement!; p.style.borderColor = 'rgba(127,214,194,.45)'; p.style.boxShadow = '0 0 0 3px rgba(127,214,194,.08)'; }}
                onBlur={(e) => { const p = e.target.parentElement!; p.style.borderColor = 'rgba(255,255,255,.08)'; p.style.boxShadow = 'none'; }}
                style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#e6ecf5', fontSize: 14.5, fontFamily: 'inherit', height: '100%' }} />
            </div>
            <div style={{ minHeight: 20, margin: '9px 2px 0', fontSize: 12, color: '#d08a8a' }}>{err}</div>
            <button className="eg-btn" onClick={submit} style={{ width: '100%', marginTop: 6, height: 48, borderRadius: 11, border: '1px solid rgba(127,214,194,.22)', background: 'linear-gradient(180deg,rgba(46,58,77,.9),rgba(31,40,54,.9))', color: '#dfe8f2', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, letterSpacing: '.02em', cursor: 'pointer', transition: 'background .25s,border-color .25s' }}>进入</button>
          </div>
        </div>
      </div>
    </div>
  );
}
