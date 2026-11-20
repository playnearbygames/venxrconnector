import type { Connection, UsageSummary, User } from './repo.js';

// ============================================================================
// Helpers
// ============================================================================
export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—';
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return 'never';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const ICONS: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-8"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v4"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
};
const icon = (name: string, size = 16) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

const LOGO = `<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#lg)"/><path d="M9 10l7 13 7-13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ============================================================================
// Styles
// ============================================================================
const CSS = `
:root{
  --bg:#f6f7fb;--surface:#fff;--surface-2:#f1f3f8;--text:#0f172a;--muted:#5b6478;--faint:#8a93a6;--border:#e3e7ef;
  --brand:#1d64f2;--brand-hover:#1652cc;--brand-ink:#fff;--brand-soft:#e9f0ff;--violet:#7c3aed;
  --ok:#15803d;--ok-soft:#dcfce7;--warn:#b45309;--warn-soft:#fef3c7;--danger:#dc2626;--danger-soft:#fee2e2;
  --code:#f3f5f9;--shadow:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.06);--radius:14px;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0b0d12;--surface:#12151c;--surface-2:#191d26;--text:#e7eaf1;--muted:#9aa3b5;--faint:#6b7386;--border:#252a35;
  --brand:#4d8bff;--brand-hover:#6b9dff;--brand-soft:#16223d;--ok:#4ade80;--ok-soft:#10291a;--warn:#fbbf24;--warn-soft:#2d2410;
  --danger:#f87171;--danger-soft:#2d1415;--code:#0e1117;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);
}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3{letter-spacing:-.02em;line-height:1.2;margin:0}
p{margin:0}
.i{flex:none;vertical-align:-3px}
.container{max-width:1120px;margin:0 auto;padding:0 20px}
.muted{color:var(--muted)}.faint{color:var(--faint)}.small{font-size:13px}.mono{font-family:ui-monospace,"JetBrains Mono",Consolas,monospace}

/* ---------- header ---------- */
.site-header{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--border)}
.site-header .container{display:flex;align-items:center;justify-content:space-between;height:64px;gap:16px}
.brand{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:700;font-size:17px}
.brand:hover{text-decoration:none}.brand .tag{font-weight:500;color:var(--muted);font-size:14px}
.nav{display:flex;align-items:center;gap:6px}
.nav a.link{color:var(--muted);padding:8px 12px;border-radius:8px;font-weight:500;font-size:14px}
.nav a.link:hover,.nav a.link.active{color:var(--text);background:var(--surface-2);text-decoration:none}
.user-chip{display:flex;align-items:center;gap:8px;padding-left:10px;margin-left:6px;border-left:1px solid var(--border)}
.avatar{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#3b82f6,#7c3aed);color:#fff;font-weight:700;font-size:13px}
@media (max-width:640px){.brand .tag,.user-email,.nav a.hide-sm,.hide-sm{display:none}.nav a.link{padding:8px 8px}.user-chip{padding-left:8px;margin-left:2px;gap:6px}}

/* ---------- buttons ---------- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:10px;padding:9px 16px;
  background:var(--brand);color:var(--brand-ink);font:inherit;font-weight:600;font-size:14px;cursor:pointer;transition:background .15s,border-color .15s,transform .05s;white-space:nowrap}
.btn:hover{background:var(--brand-hover);text-decoration:none}.btn:active{transform:translateY(1px)}
.btn-lg{padding:13px 22px;font-size:15px;border-radius:12px}
.btn-sm{padding:6px 11px;font-size:13px;border-radius:8px}
.btn-ghost{background:var(--surface);color:var(--text);border-color:var(--border)}.btn-ghost:hover{background:var(--surface-2)}
.btn-danger{background:transparent;color:var(--danger);border-color:var(--border)}.btn-danger:hover{background:var(--danger-soft)}
.btn-block{width:100%}
.btn[aria-disabled=true]{opacity:.45;pointer-events:none}
form.inline{display:inline;margin:0}

/* ---------- cards / badges ---------- */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}
.card-pad{padding:24px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 24px;border-bottom:1px solid var(--border)}
.card-head h2{font-size:16px;display:flex;align-items:center;gap:10px}
.card-body{padding:24px}
.badge{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--surface-2);color:var(--muted)}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.ok{background:var(--ok-soft);color:var(--ok)}.badge.warn{background:var(--warn-soft);color:var(--warn)}.badge.danger{background:var(--danger-soft);color:var(--danger)}
.badge.plain::before{display:none}
.icon-tile{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand);flex:none}

/* ---------- flash ---------- */
.flash{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-radius:12px;margin:20px 0 0;font-size:14px;font-weight:500}
.flash.ok{background:var(--ok-soft);color:var(--ok)}.flash.err{background:var(--danger-soft);color:var(--danger)}
.flash button{margin-left:auto;background:none;border:0;color:inherit;cursor:pointer;padding:0;opacity:.7}

/* ---------- forms ---------- */
label{display:block;font-weight:600;font-size:13px;margin:16px 0 6px}
.input{width:100%;padding:11px 13px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font:inherit;transition:border-color .15s,box-shadow .15s}
.input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 4px var(--brand-soft)}

/* ---------- tables ---------- */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:12px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:0}
code{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;background:var(--code);border:1px solid var(--border);padding:1px 6px;border-radius:6px}
pre{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;background:var(--code);border:1px solid var(--border);border-radius:10px;padding:14px 16px;overflow-x:auto;margin:12px 0 0;line-height:1.6}

/* ---------- landing ---------- */
.hero{padding:72px 0 56px;display:grid;grid-template-columns:1.05fr 1fr;gap:56px;align-items:center}
.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:var(--brand-soft);color:var(--brand);font-size:13px;font-weight:600}
.hero h1{font-size:clamp(34px,5vw,54px);margin:20px 0 18px;font-weight:800;letter-spacing:-.035em}
.grad{background:linear-gradient(90deg,#1d64f2,#7c3aed);-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{font-size:18px;color:var(--muted);max-width:540px}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}
.trust{display:flex;gap:18px;flex-wrap:wrap;margin-top:22px;color:var(--muted);font-size:13px}
.trust span{display:inline-flex;align-items:center;gap:6px}
.chat{background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:0 20px 60px rgba(29,100,242,.12),var(--shadow);overflow:hidden}
.chat-top{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border);font-size:13px;color:var(--muted);font-weight:500}
.chat-top .dots{display:flex;gap:5px}.chat-top .dots i{width:9px;height:9px;border-radius:50%;background:var(--border)}
.chat-body{padding:20px;display:flex;flex-direction:column;gap:14px}
.bubble{max-width:88%;padding:11px 14px;border-radius:14px;font-size:14px}
.bubble.user{align-self:flex-end;background:var(--brand);color:#fff;border-bottom-right-radius:4px}
.bubble.ai{background:var(--surface-2);border-bottom-left-radius:4px}
.toolcall{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;font-size:12px;font-family:ui-monospace,Consolas,monospace;color:var(--muted);border:1px dashed var(--border);border-radius:8px;padding:6px 10px}
.toolcall .ok{color:var(--ok)}
.mini{margin-top:10px;width:100%;font-size:12.5px;background:var(--surface);border-radius:8px;overflow:hidden}
.mini td{padding:7px 10px}
.clients{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:8px 0 64px}
.clients .label{color:var(--faint);font-size:13px;font-weight:500;margin-right:6px}
.chip{padding:7px 14px;border-radius:999px;border:1px solid var(--border);background:var(--surface);font-size:13px;font-weight:600}
.section{padding:64px 0;border-top:1px solid var(--border)}
.section-head{text-align:center;max-width:620px;margin:0 auto 40px}
.section-head h2{font-size:32px;margin-bottom:12px}
.steps3{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;counter-reset:s}
.step3{padding:26px}
.step3 .num{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:var(--brand);color:#fff;font-weight:700;margin-bottom:16px}
.step3 h3{font-size:17px;margin-bottom:8px}
.features{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
.feature{padding:24px}.feature h3{font-size:15px;margin:14px 0 6px}
.final-cta{text-align:center;padding:56px 24px;background:linear-gradient(135deg,#1d64f2,#7c3aed);border-radius:20px;color:#fff;margin:64px 0}
.final-cta h2{font-size:30px;margin-bottom:10px}.final-cta p{opacity:.85;margin-bottom:26px}
.final-cta .btn{background:#fff;color:#1d3fae}.final-cta .btn:hover{background:#eef2ff}
.site-footer{border-top:1px solid var(--border);padding:28px 0;color:var(--faint);font-size:13px}
.site-footer .container{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media (max-width:900px){.hero{grid-template-columns:1fr;padding-top:48px;gap:40px}.steps3{grid-template-columns:1fr}.features{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.features{grid-template-columns:1fr}}

/* ---------- auth ---------- */
.auth-wrap{min-height:calc(100vh - 65px);display:grid;place-items:center;padding:40px 16px}
.auth-card{width:100%;max-width:420px;padding:36px}
.auth-card h1{font-size:24px;margin:18px 0 6px}
.auth-points{margin:26px 0 0;padding:18px 0 0;border-top:1px solid var(--border);display:grid;gap:8px;font-size:13px;color:var(--muted)}
.auth-points span{display:flex;gap:8px;align-items:center}.auth-points .i{color:var(--ok)}

/* ---------- dashboard ---------- */
.page-head{padding:36px 0 8px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.page-head h1{font-size:28px;margin-bottom:6px}
.progress{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}
.pstep{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;background:var(--surface);border:1px solid var(--border)}
.pstep .dot{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13px;background:var(--surface-2);color:var(--muted);flex:none}
.pstep.done .dot{background:var(--ok);color:#fff}
.pstep.current{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.pstep.current .dot{background:var(--brand);color:#fff}
.pstep b{display:block;font-size:14px}.pstep span{font-size:12px;color:var(--muted)}
.dash{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;padding-bottom:64px;align-items:start}
.dash .col{display:grid;gap:24px;grid-template-columns:minmax(0,1fr)}
.dash>*,.dash .col>*{min-width:0}
@media (max-width:960px){.dash{grid-template-columns:minmax(0,1fr)!important}.progress{grid-template-columns:1fr}}
@media (max-width:560px){.card-body,.card-pad{padding:18px}.card-head{padding:16px 18px}.stats{grid-template-columns:1fr 1fr}.stats .stat:last-child{grid-column:span 2}.page-head h1{font-size:24px}.auth-card{padding:26px}}
.connect-empty{text-align:center;padding:36px 24px}
.connect-empty .icon-tile{width:52px;height:52px;border-radius:14px;margin:0 auto 16px}
.connect-empty h3{font-size:18px;margin-bottom:8px}
.connect-empty p{max-width:420px;margin:0 auto 22px}
.meta-line{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:14px;color:var(--muted);margin-bottom:18px}
.meta-line b{color:var(--text);font-weight:600}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.copy-field{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 14px;border:1px solid var(--border);border-radius:12px;background:var(--code)}
.copy-field input{flex:1;min-width:0;border:0;background:transparent;color:var(--text);font:13px ui-monospace,Consolas,monospace;outline:none}
.secret{filter:blur(4px);transition:filter .15s}body.show-secrets .secret{filter:none}
.note{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:10px;background:var(--warn-soft);color:var(--warn);font-size:13px;margin-top:14px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-top:22px;overflow-x:auto}
.tab{background:none;border:0;border-bottom:2px solid transparent;padding:10px 14px;font:inherit;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap}
.tab[aria-selected=true]{color:var(--brand);border-bottom-color:var(--brand)}
.panel{padding-top:16px;font-size:14px}.panel[hidden]{display:none}
.panel ol{margin:0;padding-left:20px;display:grid;gap:6px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.stat{padding:16px;border-radius:12px;background:var(--surface-2)}
.stat .v{font-size:26px;font-weight:700;letter-spacing:-.02em}.stat .l{font-size:12px;color:var(--muted);font-weight:500}
.bars{display:flex;align-items:flex-end;gap:6px;height:110px;margin-top:22px;padding:0 2px}
.bars div{flex:1;background:var(--brand);border-radius:5px 5px 2px 2px;min-height:3px;opacity:.85;transition:opacity .15s}
.bars div:hover{opacity:1}
.bars div.zero{background:var(--border);opacity:1}
.bars-axis{display:flex;justify-content:space-between;font-size:11px;color:var(--faint);margin-top:6px}
.prompt{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:11px 13px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-size:13.5px;cursor:pointer}
.prompt:hover{border-color:var(--brand);background:var(--brand-soft)}
.prompt .i{color:var(--faint)}
.list{display:grid;gap:8px}
.kv{display:grid;gap:10px;font-size:13.5px}
.kv div{display:flex;gap:10px;align-items:flex-start}.kv .i{color:var(--brand);margin-top:2px}
.empty{padding:28px;text-align:center;color:var(--muted);font-size:14px}
`;

// ============================================================================
// Client-side behaviour (copy buttons, tabs, prompt copy, flash dismiss)
// ============================================================================
const JS = `
document.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const src = copyBtn.getAttribute('data-copy');
    const text = src.startsWith('#') ? document.querySelector(src).value : src;
    try { await navigator.clipboard.writeText(text); } catch {}
    const label = copyBtn.querySelector('.label');
    if (label) { const old = label.innerHTML; label.textContent = 'Copied!'; setTimeout(() => label.innerHTML = old, 1400); }
  }
  const tab = e.target.closest('[role=tab]');
  if (tab) {
    const group = tab.closest('[data-tabs]');
    group.querySelectorAll('[role=tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    group.querySelectorAll('[role=tabpanel]').forEach(p => p.hidden = p.id !== tab.getAttribute('aria-controls'));
  }
  const reveal = e.target.closest('[data-reveal]');
  if (reveal) { const on = document.body.classList.toggle('show-secrets'); reveal.querySelector('.label').textContent = on ? 'Hide' : 'Show'; }
  const close = e.target.closest('[data-dismiss]');
  if (close) close.parentElement.remove();
});
`;

// ============================================================================
// Layout
// ============================================================================
interface LayoutOpts {
  user?: User | null;
  admin?: boolean;
  active?: 'dashboard' | 'admin';
  flash?: { msg?: string; err?: string };
  bare?: boolean; // landing page manages its own container
}

export function layout(title: string, body: string, opts: LayoutOpts = {}) {
  const { user, admin, active, flash } = opts;
  const nav = user
    ? `<nav class="nav">
        <a class="link ${active === 'dashboard' ? 'active' : ''}" href="/dashboard">Dashboard</a>
        ${admin ? `<a class="link ${active === 'admin' ? 'active' : ''}" href="/admin">Admin</a>` : ''}
        <div class="user-chip">
          <span class="avatar" title="${esc(user.email)}">${esc(user.email[0]?.toUpperCase())}</span>
          <span class="user-email small muted">${esc(user.email)}</span>
          <form class="inline" method="post" action="/logout"><button class="btn btn-ghost btn-sm" title="Log out">${icon('logout', 14)}</button></form>
        </div>
      </nav>`
    : `<nav class="nav"><a class="link hide-sm" href="/#how">How it works</a><a class="link" href="/login">Log in</a><a class="btn btn-sm" href="/signup">Get started</a></nav>`;

  const flashHtml = [
    flash?.err ? `<div class="flash err">${icon('alert')}<span>${esc(flash.err)}</span><button data-dismiss aria-label="Dismiss">${icon('x', 14)}</button></div>` : '',
    flash?.msg ? `<div class="flash ok">${icon('check')}<span>${esc(flash.msg)}</span><button data-dismiss aria-label="Dismiss">${icon('x', 14)}</button></div>` : '',
  ].join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Connect your Meta Ads account and use it inside Claude, ChatGPT, Gemini and Cursor via MCP.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO.replace('aria-hidden="true"', 'xmlns="http://www.w3.org/2000/svg"'))}">
<style>${CSS}</style></head>
<body>
<header class="site-header"><div class="container"><a class="brand" href="/">${LOGO}<span>VenXR</span><span class="tag">Ads MCP</span></a>${nav}</div></header>
${flashHtml ? `<div class="container">${flashHtml}</div>` : ''}
${body}
<script>${JS}</script>
</body></html>`;
}

// ============================================================================
// Landing page
// ============================================================================
export const homePage = ({ google = false }: { google?: boolean } = {}) => `
<div class="container">
  <section class="hero">
    <div>
      <span class="eyebrow">${icon('bolt', 14)} MCP connector for ${google ? 'Meta &amp; Google Ads' : 'Meta Ads'}</span>
      <h1>Ask any AI about your <span class="grad">${google ? 'Meta &amp; Google Ads' : 'Meta Ads'}</span> campaigns</h1>
      <p class="lead">${
        google
          ? 'Connect your Facebook, Instagram and Google Ads accounts once and get a private link'
          : 'Connect your Facebook &amp; Instagram ad accounts once and get a private link'
      } that works in Claude, ChatGPT, Gemini and Cursor. Your assistant sees every campaign, status and budget, live.</p>
      <div class="cta">
        <a class="btn btn-lg" href="/signup">Get your link, free ${icon('arrow')}</a>
        <a class="btn btn-ghost btn-lg" href="#how">How it works</a>
      </div>
      <div class="trust">
        <span>${icon('shield', 14)} Read-only access</span>
        <span>${icon('lock', 14)} Tokens encrypted at rest</span>
        <span>${icon('key', 14)} Revoke anytime</span>
      </div>
    </div>

    <div class="chat" aria-label="Example conversation">
      <div class="chat-top"><span class="dots"><i></i><i></i><i></i></span> Your AI assistant</div>
      <div class="chat-body">
        <div class="bubble user">Which of my Meta campaigns are active right now, and what are their budgets?</div>
        <div class="toolcall"><span class="ok">${icon('check', 13)}</span> meta_get_campaigns · 3 ad accounts · 0.9s</div>
        <div class="bubble ai">
          You have <b>5 active campaigns</b> across 3 ad accounts. Here are the largest:
          <table class="mini">
            <tr><td>Spring Launch · Conversions</td><td style="text-align:right"><b>$250/day</b></td></tr>
            <tr><td>Retargeting · Catalog Sales</td><td style="text-align:right"><b>$120/day</b></td></tr>
            <tr><td>Brand Awareness · Reels</td><td style="text-align:right"><b>$80/day</b></td></tr>
          </table>
        </div>
      </div>
    </div>
  </section>

  <div class="clients">
    <span class="label">Works with</span>
    <span class="chip">Claude</span><span class="chip">ChatGPT</span><span class="chip">Gemini</span><span class="chip">Cursor</span><span class="chip">VS Code</span><span class="chip">Any MCP client</span>
  </div>
</div>

<section class="section" id="how">
  <div class="container">
    <div class="section-head">
      <h2>Live in under two minutes</h2>
      <p class="muted">No code, no API keys to manage. Just connect and paste.</p>
    </div>
    <div class="steps3">
      <div class="card step3"><div class="num">1</div><h3>${google ? 'Connect Meta &amp; Google Ads' : 'Connect Meta Ads'}</h3><p class="muted">${
        google
          ? 'Sign in with Facebook and/or Google. We find your Business Manager, client and MCC accounts automatically.'
          : 'Sign in with Facebook and choose the businesses and ad accounts to share, including Business Manager and client accounts.'
      }</p></div>
      <div class="card step3"><div class="num">2</div><h3>Copy your private link</h3><p class="muted">Your dashboard gives you one personal MCP link. Treat it like a password, and regenerate it whenever you want.</p></div>
      <div class="card step3"><div class="num">3</div><h3>Paste it into your AI</h3><p class="muted">Add the link as a connector in Claude, ChatGPT, Gemini or Cursor, then ask about your campaigns in plain English.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="section-head"><h2>Built for agencies and marketers</h2><p class="muted">Every ad account you can access, in one place your AI can read.</p></div>
    <div class="features">
      <div class="card feature"><div class="icon-tile">${icon('megaphone', 18)}</div><h3>All your ad accounts</h3><p class="muted small">${
        google ? 'Meta Business Manager accounts and Google Ads MCC client accounts.' : 'Personal and Business Manager accounts.'
      } Campaigns are grouped by account, with status and budget.</p></div>
      <div class="card feature"><div class="icon-tile">${icon('shield', 18)}</div><h3>Read-only by design</h3><p class="muted small">The connector can't create, edit or spend. It only reads campaign data you already have access to.</p></div>
      <div class="card feature"><div class="icon-tile">${icon('chart', 18)}</div><h3>Usage you can see</h3><p class="muted small">Every AI request is logged, so you know exactly when and how your data was accessed.</p></div>
      <div class="card feature"><div class="icon-tile">${icon('key', 18)}</div><h3>You stay in control</h3><p class="muted small">Disconnect a platform or rotate your link with one click. Old links stop working instantly.</p></div>
    </div>

    <div class="final-cta">
      <h2>Give your AI eyes on your ad accounts</h2>
      <p>Free to start. Connect ${google ? 'Meta and Google Ads' : 'Meta Ads'} in a minute.</p>
      <a class="btn btn-lg" href="/signup">Create your account ${icon('arrow')}</a>
    </div>
  </div>
</section>

<footer class="site-footer"><div class="container"><span>© ${new Date().getFullYear()} VenXR</span><span>Not affiliated with Meta Platforms, Inc.${google ? ' or Google LLC' : ''}</span></div></footer>`;

// ============================================================================
// Auth pages
// ============================================================================
export const authPage = (mode: 'login' | 'signup', email = '') => `
<div class="auth-wrap">
  <div class="card auth-card">
    ${LOGO}
    <h1>${mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
    <p class="muted small">${mode === 'login' ? 'Log in to manage your Meta connection and MCP link.' : 'Connect Meta Ads to your AI assistant in two minutes.'}</p>
    <form method="post" action="/${mode}">
      <label for="email">Email</label>
      <input class="input" id="email" name="email" type="email" required value="${esc(email)}" autocomplete="email" placeholder="you@company.com" autofocus>
      <label for="password">Password</label>
      <input class="input" id="password" name="password" type="password" required minlength="8"
        autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="${mode === 'signup' ? 'At least 8 characters' : ''}">
      <button class="btn btn-lg btn-block" type="submit" style="margin-top:22px">${mode === 'login' ? 'Log in' : 'Create account'}</button>
    </form>
    <p class="small muted" style="margin-top:18px;text-align:center">
      ${mode === 'login' ? 'New here? <a href="/signup">Create an account</a>' : 'Already have an account? <a href="/login">Log in</a>'}
    </p>
    ${
      mode === 'signup'
        ? `<div class="auth-points">
            <span>${icon('check', 14)} Read-only access to your ad accounts</span>
            <span>${icon('check', 14)} Works with Claude, ChatGPT, Gemini &amp; Cursor</span>
            <span>${icon('check', 14)} Disconnect anytime</span>
          </div>`
        : ''
    }
  </div>
</div>`;

// ============================================================================
// Dashboard
// ============================================================================
const accountStatusBadge = (s: string) => {
  const cls = ['ACTIVE', 'ENABLED'].includes(s) ? 'ok' : ['DISABLED', 'CLOSED', 'UNSETTLED', 'CANCELED', 'SUSPENDED'].includes(s) ? 'danger' : 'warn';
  return `<span class="badge ${cls}">${esc(s.replace(/_/g, ' ').toLowerCase())}</span>`;
};

interface PlatformSpec {
  platform: 'meta' | 'google';
  label: string;
  icon: string;
  title: string; // empty-state heading
  pitch: string; // empty-state description
  hint?: string; // small print under the connect button
  missingEnv: string;
  accountWord: string; // "ad account" / "account"
  emptyAccounts: string;
  expiryReconnectDays?: number; // Meta tokens last ~60 days; Google refreshes itself
}

const META_SPEC: PlatformSpec = {
  platform: 'meta',
  label: 'Meta Ads',
  icon: 'megaphone',
  title: 'Connect your Meta ad accounts',
  pitch:
    'Sign in with Facebook and pick the businesses and ad accounts your AI assistant may read, including Business Manager and agency client accounts. The connector only reads: it never edits campaigns or spends money.',
  hint: "You can sign in with Facebook or a <b>Managed Meta Account</b> (work login). If you're already logged into personal Facebook, log out first or use a private window to pick a different account.",
  missingEnv: 'META_APP_ID / META_APP_SECRET',
  accountWord: 'ad account',
  emptyAccounts: 'No ad accounts were shared with us. Click <b>Reconnect</b> and select your ad accounts in the Facebook dialog.',
  expiryReconnectDays: 60,
};

const GOOGLE_SPEC: PlatformSpec = {
  platform: 'google',
  label: 'Google Ads',
  icon: 'search',
  title: 'Connect your Google Ads accounts',
  pitch:
    'Sign in with Google and allow Google Ads access. We find every account you can reach, including client accounts under manager (MCC) accounts. The connector only reads: it never edits campaigns or spends money.',
  hint: 'Use the Google login that has access to your Google Ads accounts, and tick the <b>Google Ads</b> permission on the consent screen.',
  missingEnv: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN',
  accountWord: 'account',
  emptyAccounts:
    'No Google Ads accounts were found for this Google login. Make sure it has access in Google Ads, then click <b>Refresh accounts</b>.',
};

function platformCard(spec: PlatformSpec, conn: Connection | undefined, configured: boolean) {
  const head = (badge: string) =>
    `<div class="card-head"><h2><span class="icon-tile">${icon(spec.icon, 18)}</span>${spec.label}</h2>${badge}</div>`;

  if (!conn) {
    return `<div class="card">${head('<span class="badge">Not connected</span>')}
      <div class="connect-empty">
        <div class="icon-tile">${icon('plug', 24)}</div>
        <h3>${spec.title}</h3>
        <p class="muted">${spec.pitch}</p>
        ${
          configured
            ? `<a class="btn btn-lg" href="/connect/${spec.platform}">${icon('link')} Connect ${spec.label}</a>
               ${spec.hint ? `<p class="small faint" style="margin:16px auto 0;max-width:420px">${spec.hint}</p>` : ''}`
            : `<a class="btn btn-lg" aria-disabled="true">Connect ${spec.label}</a><p class="small" style="color:var(--danger);margin-top:12px">The server is missing ${spec.missingEnv}.</p>`
        }
      </div></div>`;
  }

  const accounts = conn.metadata?.ad_accounts ?? [];
  const daysLeft =
    spec.expiryReconnectDays && conn.token_expires_at
      ? Math.floor((new Date(conn.token_expires_at).getTime() - Date.now()) / 86400000)
      : null;
  const needsReconnect = conn.status !== 'active' || (daysLeft !== null && daysLeft < 0);
  const expiringSoon = !needsReconnect && daysLeft !== null && daysLeft <= 7;
  const badge = needsReconnect
    ? '<span class="badge danger">Needs reconnect</span>'
    : expiringSoon
      ? '<span class="badge warn">Expiring soon</span>'
      : '<span class="badge ok">Connected</span>';

  const warning = needsReconnect
    ? `<div class="note" style="background:var(--danger-soft);color:var(--danger);margin:0 0 18px">${icon('alert')}<span>${spec.label} access stopped working${conn.last_error ? `: ${esc(conn.last_error)}` : ''}. Reconnect to keep your AI connected.</span></div>`
    : expiringSoon
      ? `<div class="note" style="margin:0 0 18px">${icon('alert')}<span>${spec.label} access expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Reconnect to extend it for another ${spec.expiryReconnectDays} days.</span></div>`
      : '';

  const plural = (n: number) => `${spec.accountWord}${n === 1 ? '' : 's'}`;
  const table = accounts.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>${spec.platform === 'meta' ? 'Ad account' : 'Account'}</th><th class="hide-sm">ID</th><th>Currency</th><th>Status</th></tr></thead>
        <tbody>${accounts
          .map(
            (a) =>
              `<tr><td><b>${esc(a.name)}</b>${a.business ? `<div class="small faint">${esc(a.business)}</div>` : ''}</td><td class="mono small muted hide-sm">${esc(a.id)}</td><td>${esc(a.currency || '—')}</td><td>${accountStatusBadge(a.status)}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
    : `<div class="empty">${spec.emptyAccounts}</div>`;

  return `<div class="card">${head(badge)}
    <div class="card-body">
      ${warning}
      <div class="meta-line">
        <span>Connected as <b>${esc(conn.external_account_name ?? 'user')}</b></span>
        <span><b>${accounts.length}</b> ${plural(accounts.length)}</span>
        ${daysLeft !== null && daysLeft >= 0 ? `<span>Access valid until <b>${fmtDate(conn.token_expires_at)}</b></span>` : ''}
      </div>
      ${table}
      <div class="actions" style="margin-top:20px;padding-top:18px;border-top:1px solid var(--border)">
        <form class="inline" method="post" action="/${spec.platform}/refresh-accounts"><button class="btn btn-ghost btn-sm">${icon('refresh', 14)} Refresh accounts</button></form>
        <a class="btn btn-ghost btn-sm" href="/connect/${spec.platform}">${icon('link', 14)} Reconnect</a>
        <form class="inline" method="post" action="/disconnect/${spec.platform}" onsubmit="return confirm('Disconnect ${spec.label}? Your AI assistants will lose access to these campaigns.')">
          <button class="btn btn-danger btn-sm">Disconnect</button></form>
        <span class="small faint" style="margin-left:auto;align-self:center">Accounts synced ${timeAgo(conn.metadata?.accounts_synced_at)}</span>
      </div>
    </div></div>`;
}

function linkCard(mcpUrl: string, connected: boolean) {
  const url = esc(mcpUrl);
  const bearerBase = esc(mcpUrl.replace(/\/mcp\/.*/, '/mcp'));
  const tabs: [string, string, string][] = [
    [
      'claude',
      'Claude',
      `<ol><li>Open <b>claude.ai</b> (or Claude Desktop) → <b>Settings → Connectors</b>.</li>
        <li>Click <b>Add custom connector</b>, name it <i>Meta Ads</i>, and paste your link.</li>
        <li>In a chat, enable the connector from the tools menu and ask away.</li></ol>
        <p class="small muted" style="margin-top:12px">Claude Code:</p><pre class="secret">claude mcp add --transport http meta-ads ${url}</pre>`,
    ],
    [
      'chatgpt',
      'ChatGPT',
      `<ol><li>Go to <b>Settings → Apps &amp; Connectors → Advanced</b> and turn on <b>Developer mode</b>.</li>
        <li>Click <b>Create</b>, name it <i>Meta Ads</i>, and paste your link as the MCP server URL.</li>
        <li>Set Authentication to <b>No authentication</b>, save, then pick it in a new chat.</li></ol>`,
    ],
    [
      'gemini',
      'Gemini CLI',
      `<p>Add this to <code>~/.gemini/settings.json</code>:</p><pre class="secret">{
  "mcpServers": {
    "meta-ads": { "httpUrl": "${url}" }
  }
}</pre>`,
    ],
    [
      'cursor',
      'Cursor / VS Code',
      `<p>Add to <code>.cursor/mcp.json</code> (or your client's MCP config):</p><pre class="secret">{
  "mcpServers": {
    "meta-ads": { "url": "${url}" }
  }
}</pre>
      <p class="small muted" style="margin-top:12px">Prefer a header? <code>POST ${bearerBase}</code> with <code>Authorization: Bearer &lt;token after /mcp/&gt;</code>.</p>`,
    ],
  ];

  return `<div class="card">
    <div class="card-head"><h2><span class="icon-tile">${icon('link', 18)}</span>Your MCP link</h2>
      <form class="inline" method="post" action="/mcp-link/regenerate" onsubmit="return confirm('Create a new link? The current link will stop working in every AI assistant where you added it.')">
        <button class="btn btn-ghost btn-sm" title="Rotate link">${icon('refresh', 14)} Regenerate</button></form>
    </div>
    <div class="card-body">
      <div class="copy-field" id="mcp-field">
        <input class="secret" id="mcp-url" type="text" readonly value="${url}" aria-label="Your MCP link" onfocus="this.select()">
        <button class="btn btn-ghost btn-sm" type="button" data-reveal="#mcp-field"><span class="label">Show</span></button>
        <button class="btn btn-sm" type="button" data-copy="#mcp-url">${icon('copy', 14)}<span class="label">Copy link</span></button>
      </div>
      ${
        connected
          ? `<div class="note">${icon('lock')}<span>This link gives read access to your connected ad accounts. Keep it private, like a password.</span></div>`
          : `<div class="note">${icon('alert')}<span>Connect an ad platform above first. Until then, your AI will be told the account isn't connected.</span></div>`
      }
      <div data-tabs>
        <div class="tabs" role="tablist">
          ${tabs.map(([id, label], i) => `<button class="tab" role="tab" aria-selected="${i === 0}" aria-controls="tab-${id}">${label}</button>`).join('')}
        </div>
        ${tabs.map(([id, , html], i) => `<div class="panel" role="tabpanel" id="tab-${id}" ${i === 0 ? '' : 'hidden'}>${html}</div>`).join('')}
      </div>
    </div>
  </div>`;
}

function usageCard(u: UsageSummary) {
  const max = Math.max(1, ...u.daily.map((d) => d.calls));
  const bars = u.daily
    .map((d) => {
      const pct = Math.round((d.calls / max) * 100);
      return `<div class="${d.calls ? '' : 'zero'}" style="height:${d.calls ? Math.max(pct, 4) : 3}%" title="${esc(fmtDate(d.day))}: ${d.calls} call${d.calls === 1 ? '' : 's'}"></div>`;
    })
    .join('');

  const recent = u.recent.length
    ? `<div class="table-wrap" style="margin-top:24px"><table>
        <thead><tr><th>When</th><th>Tool</th><th>Status</th><th>Time</th><th>Client</th></tr></thead>
        <tbody>${u.recent
          .slice(0, 8)
          .map(
            (r) => `<tr>
              <td class="small" title="${esc(fmtDateTime(r.created_at))}">${timeAgo(r.created_at)}</td>
              <td><code>${esc(r.tool_name)}</code></td>
              <td>${r.status === 'success' ? '<span class="badge ok">success</span>' : `<span class="badge danger" title="${esc(r.error_message)}">error</span>`}</td>
              <td class="small muted">${r.duration_ms} ms</td>
              <td class="small muted">${esc(clientName(r.client_user_agent))}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
    : `<div class="empty" style="margin-top:16px">No requests yet. Add your link to an AI assistant and ask <i>"List my Meta campaigns"</i>.</div>`;

  return `<div class="card">
    <div class="card-head"><h2><span class="icon-tile">${icon('chart', 18)}</span>Usage</h2><span class="small faint">Last 14 days</span></div>
    <div class="card-body">
      <div class="stats">
        <div class="stat"><div class="v">${u.total.toLocaleString()}</div><div class="l">Tool calls, all time</div></div>
        <div class="stat"><div class="v">${u.last30.toLocaleString()}</div><div class="l">Last 30 days</div></div>
        <div class="stat"><div class="v">${u.last30 ? Math.round(((u.last30 - u.errors30) / u.last30) * 100) + '%' : '—'}</div><div class="l">Success rate</div></div>
      </div>
      <div class="bars" role="img" aria-label="Tool calls per day, last 14 days">${bars}</div>
      <div class="bars-axis"><span>${esc(fmtDate(u.daily[0]?.day))}</span><span>Today</span></div>
      ${recent}
    </div>
  </div>`;
}

/** Turns a user-agent into a friendly client name for the usage table. */
function clientName(ua: string | null): string {
  if (!ua) return 'Unknown';
  const l = ua.toLowerCase();
  if (l.includes('claude')) return 'Claude';
  if (l.includes('openai') || l.includes('chatgpt')) return 'ChatGPT';
  if (l.includes('gemini') || l.includes('google')) return 'Gemini';
  if (l.includes('cursor')) return 'Cursor';
  if (l.includes('vscode') || l.includes('code')) return 'VS Code';
  if (l.includes('curl')) return 'curl';
  if (l.includes('node') || l.includes('python')) return 'API client';
  return ua.slice(0, 24);
}

const META_PROMPTS = [
  'List all my active Meta campaigns',
  'Which ad accounts have paused campaigns?',
  'What are the daily budgets of my running campaigns?',
  'Summarise my campaigns by objective',
];
const GOOGLE_PROMPTS = [
  'List my enabled Google Ads campaigns',
  'Compare my Meta and Google Ads campaign budgets',
];

const TOOL_DOCS = {
  meta: {
    name: 'meta_get_campaigns',
    blurb: 'Every campaign in your Meta ad accounts, grouped by account.',
    fields: ['Name, status &amp; delivery status', 'Objective, buying type &amp; bid strategy', 'Daily / lifetime budget &amp; remaining', 'Start, stop &amp; last-updated dates'],
  },
  google: {
    name: 'google_ads_get_campaigns',
    blurb: 'Every campaign in your Google Ads accounts, including MCC client accounts.',
    fields: ['Name, status &amp; serving status', 'Channel type &amp; bidding strategy', 'Budget amount'],
  },
};

const toolDoc = (t: (typeof TOOL_DOCS)['meta']) => `
  <div>
    <p><code>${t.name}</code></p>
    <p class="small muted" style="margin:8px 0 12px">${t.blurb}</p>
    <div class="kv">${t.fields.map((f) => `<div>${icon('check', 14)}<span>${f}</span></div>`).join('')}</div>
  </div>`;

export function dashboardPage(p: {
  user: User;
  mcpUrl: string;
  usage: UsageSummary;
  meta: Connection | undefined;
  metaConfigured: boolean;
  googleEnabled: boolean;
  google: Connection | undefined;
  googleConfigured: boolean;
}) {
  const metaOk = Boolean(p.meta && p.meta.status === 'active');
  const googleOk = Boolean(p.googleEnabled && p.google && p.google.status === 'active');
  const connected = metaOk || googleOk;
  const used = p.usage.total > 0;
  const platformsLabel = p.googleEnabled ? 'Meta or Google Ads' : 'Meta Ads';
  const connectedLabel = [metaOk && 'Meta', googleOk && 'Google'].filter(Boolean).join(' + ');
  const prompts = p.googleEnabled ? [...META_PROMPTS.slice(0, 3), ...GOOGLE_PROMPTS] : META_PROMPTS;
  const tools = p.googleEnabled ? [TOOL_DOCS.meta, TOOL_DOCS.google] : [TOOL_DOCS.meta];
  const step = (n: number, title: string, sub: string, done: boolean, current: boolean) =>
    `<div class="pstep ${done ? 'done' : current ? 'current' : ''}"><span class="dot">${done ? icon('check', 14) : n}</span><div><b>${title}</b><span>${sub}</span></div></div>`;

  return `<div class="container">
    <div class="page-head">
      <div><h1>Dashboard</h1><p class="muted">Connect ${platformsLabel}, copy your link, and start asking your AI about your campaigns.</p></div>
    </div>

    <div class="progress">
      ${step(1, `Connect ${platformsLabel}`, connected ? `Connected: ${connectedLabel}` : p.googleEnabled ? 'Connect at least one platform' : 'Sign in with Facebook', connected, !connected)}
      ${step(2, 'Copy your MCP link', 'Below, keep it private', used, connected && !used)}
      ${step(3, 'Ask your AI', used ? `${p.usage.total} request${p.usage.total === 1 ? '' : 's'} so far` : 'Waiting for first request', used, false)}
    </div>

    <div class="dash">
      <div class="col">
        ${platformCard(META_SPEC, p.meta, p.metaConfigured)}
        ${p.googleEnabled ? platformCard(GOOGLE_SPEC, p.google, p.googleConfigured) : ''}
        ${linkCard(p.mcpUrl, connected)}
        ${usageCard(p.usage)}
      </div>

      <aside class="col">
        <div class="card card-pad">
          <h2 style="font-size:16px;margin-bottom:6px">Try asking</h2>
          <p class="small muted" style="margin-bottom:14px">Click to copy, then paste into your assistant.</p>
          <div class="list">
            ${prompts.map((q) => `<button class="prompt" type="button" data-copy="${esc(q)}"><span>${esc(q)}</span><span class="label small faint">${icon('copy', 14)}</span></button>`).join('')}
          </div>
        </div>

        <div class="card card-pad">
          <h2 style="font-size:16px;margin-bottom:14px">${tools.length > 1 ? 'Your tools' : 'Your tool'}</h2>
          <div style="display:grid;gap:20px">${tools.map(toolDoc).join('<hr style="border:0;border-top:1px solid var(--border);margin:0">')}</div>
        </div>

        <div class="card card-pad">
          <h2 style="font-size:16px;margin-bottom:14px">Privacy &amp; security</h2>
          <div class="kv">
            <div>${icon('shield', 14)}<span>The connector only reads data. It never edits campaigns, changes settings or spends.</span></div>
            <div>${icon('lock', 14)}<span>Your ${p.googleEnabled ? 'Meta and Google tokens are' : 'Meta token is'} encrypted at rest.</span></div>
            <div>${icon('key', 14)}<span>Regenerate your link anytime; the old one stops working instantly.</span></div>
          </div>
        </div>
      </aside>
    </div>
  </div>`;
}

// ============================================================================
// Admin
// ============================================================================
export function adminPage(d: {
  users: { email: string; created_at: Date; connections: string | null; calls: number; calls30: number; last_call: Date | null }[];
  tools: { tool_name: string; calls: number; errors: number }[];
  daily: { day: string; calls: number }[];
}) {
  const total = d.tools.reduce((n, t) => n + t.calls, 0);
  const errors = d.tools.reduce((n, t) => n + t.errors, 0);
  const connectedUsers = d.users.filter((u) => u.connections).length;
  const activeUsers = d.users.filter((u) => u.calls30 > 0).length;

  return `<div class="container" style="padding-bottom:64px">
    <div class="page-head"><div><h1>Admin</h1><p class="muted">Tool usage across all users.</p></div></div>
    <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin:24px 0">
      <div class="stat card" style="box-shadow:none"><div class="v">${d.users.length}</div><div class="l">Users</div></div>
      <div class="stat card" style="box-shadow:none"><div class="v">${connectedUsers}</div><div class="l">Users connected</div></div>
      <div class="stat card" style="box-shadow:none"><div class="v">${activeUsers}</div><div class="l">Active (30 days)</div></div>
      <div class="stat card" style="box-shadow:none"><div class="v">${total.toLocaleString()}</div><div class="l">Tool calls, all time</div></div>
      <div class="stat card" style="box-shadow:none"><div class="v">${total ? Math.round(((total - errors) / total) * 100) + '%' : '—'}</div><div class="l">Success rate</div></div>
    </div>

    <div class="dash" style="grid-template-columns:minmax(0,1fr) 340px">
      <div class="card">
        <div class="card-head"><h2>Users</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Email</th><th>Connected</th><th>Calls</th><th>30 days</th><th>Last call</th><th>Joined</th></tr></thead>
          <tbody>${
            d.users
              .map(
                (u) => `<tr><td><b>${esc(u.email)}</b></td>
                  <td>${u.connections ? `<span class="badge ok">${esc(u.connections)}</span>` : '<span class="badge">none</span>'}</td>
                  <td>${u.calls}</td><td>${u.calls30}</td>
                  <td class="small muted">${u.last_call ? timeAgo(u.last_call) : '—'}</td>
                  <td class="small muted">${fmtDate(u.created_at)}</td></tr>`,
              )
              .join('') || '<tr><td colspan="6" class="empty">No users yet</td></tr>'
          }</tbody></table></div>
      </div>

      <div class="col">
        <div class="card">
          <div class="card-head"><h2>By tool</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Tool</th><th>Calls</th><th>Errors</th></tr></thead><tbody>
          ${d.tools.map((t) => `<tr><td><code>${esc(t.tool_name)}</code></td><td>${t.calls}</td><td>${t.errors}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No calls yet</td></tr>'}
          </tbody></table></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Last 14 days</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Day</th><th>Calls</th></tr></thead><tbody>
          ${d.daily.map((r) => `<tr><td>${esc(fmtDate(r.day))}</td><td>${r.calls}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">No calls yet</td></tr>'}
          </tbody></table></div>
        </div>
      </div>
    </div>
  </div>`;
}
