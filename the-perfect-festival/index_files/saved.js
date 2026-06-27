'use strict';
/* ============================================================
   Saved builds. Heart your favourite XIs (native app only).
   Self-contained: injects a header heart (opens the list), a
   "Save build" button on the results screen, and a full-screen
   "Saved builds" overlay. Stores up to 50 builds in localStorage
   (per device), shared across all four modes (same origin) so the
   list is unified. 100% no-op on the web build.

   Each mode calls SavedBuilds.init({ mode, modeLabel, capture })
   from its boot(); capture() returns a snapshot of the current
   result (difficulty, formation, verdict, summary, xi, star…) or
   null if there is nothing to save yet.
   ============================================================ */
(function () {
  const KEY = '380_saved';
  const CAP = 50;
  const NAME_MAX = 40;
  const Cap = window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

  let CFG = null;            // { mode, modeLabel, capture }
  let currentSavedId = null; // id of the build saved from the on-screen result (for the heart toggle)

  /* ---------- storage ---------- */
  function load() {
    try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function persist(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
  function uid() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------- labels ---------- */
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function dateLabel(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
  }
  function dateShort(ts) { const d = new Date(ts); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; }

  const MODE_TAG = {
    EPL: { label:'EPL',             bg:'rgba(255,45,120,.15)', fg:'#ff8fb5', bd:'rgba(255,45,120,.4)' },
    NC:  { label:'Nations Cup',     bg:'rgba(255,210,74,.15)', fg:'#ffe08a', bd:'rgba(255,210,74,.4)' },
    EL:  { label:'European League', bg:'rgba(124,58,237,.18)', fg:'#c4a7ff', bd:'rgba(124,58,237,.45)' },
    PD:  { label:'Primera División', bg:'rgba(214,0,28,.16)', fg:'#ff9f93', bd:'rgba(214,0,28,.45)' }
  };
  const verdictClass = (v) => v === 'OVERPERFORMED' ? 'over' : v === 'UNDERPERFORMED' ? 'under' : 'met';

  function haptic(style) { try { if (window.NativeAds && NativeAds.haptic) NativeAds.haptic(style || 'LIGHT'); } catch (e) {} }
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 1800);
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /* ---------- styles ---------- */
  function injectStyles() {
    if (document.getElementById('savedStyles')) return;
    const s = document.createElement('style'); s.id = 'savedStyles';
    s.textContent = `
    #savedOpenBtn{color:var(--accent,#ff2d78)}
    .results-actions{flex-wrap:wrap}
    .saveBuildBtn.is-saved{color:var(--accent,#ff2d78);border-color:var(--accent,#ff2d78)}
    #savedScreen{position:fixed;inset:0;z-index:9000;background:var(--bg,#0a0a12);display:none;flex-direction:column;overflow:hidden}
    #savedScreen.open{display:flex}
    .sv-head{display:flex;align-items:center;gap:12px;padding:16px 16px 12px;border-bottom:1px solid var(--line,#23233a)}
    .sv-back{width:38px;height:38px;border-radius:10px;border:1px solid var(--line,#23233a);background:var(--panel,#12121f);color:var(--txt,#e9e9f2);font-size:22px;line-height:1;cursor:pointer;flex:none}
    .sv-title{font-size:18px;font-weight:900;color:var(--txt,#e9e9f2);flex:1}
    .sv-count{font-size:12px;font-weight:700;color:var(--muted,#8a8aa3);background:var(--panel,#12121f);border:1px solid var(--line,#23233a);padding:5px 10px;border-radius:20px}
    .sv-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 16px calc(28px + env(safe-area-inset-bottom))}
    .sv-card{background:var(--panel,#12121f);border:1px solid var(--line,#23233a);border-radius:14px;padding:12px 13px;margin-bottom:10px;cursor:pointer}
    .sv-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
    .sv-name{font-size:15px;font-weight:800;color:var(--txt,#e9e9f2);word-break:break-word}
    .sv-pen{background:none;border:none;color:#6f6f8c;cursor:pointer;font-size:14px;margin-left:6px;padding:0}
    .sv-sub{font-size:12px;color:var(--muted,#8a8aa3);margin-top:2px}
    .sv-heart{background:none;border:none;color:var(--accent,#ff2d78);font-size:22px;cursor:pointer;line-height:1;padding:1px 0 0;flex:none}
    .sv-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}
    .sv-pill{font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;border:1px solid transparent;white-space:nowrap}
    .sv-vd{font-size:11px;font-weight:900;letter-spacing:.05em;padding:3px 8px;border-radius:7px}
    .sv-vd.over{background:rgba(46,224,106,.16);color:#7af0a0;border:1px solid rgba(46,224,106,.4)}
    .sv-vd.met{background:rgba(124,47,247,.18);color:#c4a7ff;border:1px solid rgba(124,47,247,.45)}
    .sv-vd.under{background:rgba(255,84,112,.16);color:#ff90a3;border:1px solid rgba(255,84,112,.4)}
    .sv-line{font-size:13px;color:#c9c9dd;margin-top:9px}
    .sv-xi{margin-top:11px;border-top:1px solid var(--line,#23233a);padding-top:10px;display:none}
    .sv-card.exp .sv-xi{display:block}
    .sv-xirow{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0;color:var(--txt,#e9e9f2)}
    .sv-xipos{color:var(--muted,#8a8aa3);width:46px;flex:none;font-weight:700}
    .sv-xiname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sv-ximeta{color:var(--muted,#8a8aa3);font-size:12px;flex:none}
    .sv-empty{text-align:center;color:var(--muted,#8a8aa3);padding:64px 24px;font-size:15px;line-height:1.7}
    .sv-foot{text-align:center;font-size:11px;color:#6a6a85;padding:8px 0 2px}
    .sv-edit{display:flex;gap:8px;align-items:center}
    .sv-edit input{flex:1;min-width:0;background:var(--bg,#0a0a12);border:1px solid var(--accent,#ff2d78);border-radius:8px;color:var(--txt,#e9e9f2);font:inherit;font-size:14px;font-weight:700;padding:7px 9px}
    .sv-edit button{width:34px;height:34px;border-radius:8px;border:1px solid var(--line,#23233a);background:var(--panel,#12121f);color:var(--txt,#e9e9f2);font-size:15px;cursor:pointer;flex:none}
    `;
    document.head.appendChild(s);
  }

  /* ---------- overlay ---------- */
  function buildOverlay() {
    if (document.getElementById('savedScreen')) return;
    const ov = document.createElement('section'); ov.id = 'savedScreen';
    ov.innerHTML =
      '<div class="sv-head">' +
        '<button class="sv-back" id="svBack" aria-label="Close">‹</button>' +
        '<span class="sv-title">Saved builds</span>' +
        '<span class="sv-count" id="svCount">0 / ' + CAP + '</span>' +
      '</div>' +
      '<div class="sv-list" id="svList"></div>';
    document.body.appendChild(ov);
    document.getElementById('svBack').addEventListener('click', closeOverlay);
  }

  function render() {
    const list = load();
    const cnt = document.getElementById('svCount'); if (cnt) cnt.textContent = list.length + ' / ' + CAP;
    const host = document.getElementById('svList'); if (!host) return;
    host.innerHTML = '';
    if (!list.length) {
      host.innerHTML = '<div class="sv-empty">No saved builds yet.<br>Tap the heart on any result to save your XI here.</div>';
      return;
    }
    list.forEach(b => {
      const tag = MODE_TAG[b.mode] || { label: b.modeLabel || b.mode, bg:'#18182a', fg:'#a6a6c2', bd:'#2a2a40' };
      const named = b.name && b.name.trim();
      const title = named ? escapeHTML(b.name) : dateLabel(b.savedAt);
      const sub = named
        ? (b.formation ? escapeHTML(b.formation) + ' · ' : '') + 'saved ' + dateShort(b.savedAt)
        : escapeHTML(b.formation || '');
      const xi = (b.xi || []).map(p =>
        '<div class="sv-xirow"><span class="sv-xipos">' + escapeHTML(p.pos) + '</span>' +
        '<span class="sv-xiname">' + escapeHTML(p.name) + '</span>' +
        '<span class="sv-ximeta">' + escapeHTML(p.club || '') + ' ' + escapeHTML(String(p.year || '')) + ' · ' + escapeHTML(String(p.ovr || '')) + '</span></div>'
      ).join('');
      const diffStyle = (b.difficulty === 'Expert')
        ? 'background:rgba(255,122,89,.16);color:#ffb59c;border-color:rgba(255,122,89,.4)'
        : 'background:#18182a;color:#a6a6c2;border-color:#2a2a40';
      const star = b.star ? '<div class="sv-xirow" style="margin-top:6px"><span class="sv-xipos">★</span><span class="sv-xiname">Player of the season</span><span class="sv-ximeta">' + escapeHTML(b.star) + '</span></div>' : '';
      const scorer = b.scorer ? '<div class="sv-xirow"><span class="sv-xipos">⚽</span><span class="sv-xiname">Top scorer</span><span class="sv-ximeta">' + escapeHTML(b.scorer) + '</span></div>' : '';
      const card = document.createElement('div'); card.className = 'sv-card'; card.dataset.id = b.id;
      card.innerHTML =
        '<div class="sv-top"><div style="min-width:0">' +
          '<div class="sv-name">' + title + '<button class="sv-pen" data-act="rename" aria-label="Rename build">✎</button></div>' +
          '<div class="sv-sub">' + sub + '</div>' +
        '</div>' +
        '<button class="sv-heart" data-act="remove" aria-label="Remove build">♥</button></div>' +
        '<div class="sv-tags">' +
          '<span class="sv-pill" style="background:' + tag.bg + ';color:' + tag.fg + ';border-color:' + tag.bd + '">' + escapeHTML(tag.label) + '</span>' +
          '<span class="sv-pill" style="' + diffStyle + '">' + escapeHTML(b.difficulty || 'Classic') + '</span>' +
          '<span class="sv-vd ' + verdictClass(b.verdict) + '">' + escapeHTML(b.verdict || '') + '</span>' +
        '</div>' +
        '<div class="sv-line">' + escapeHTML(b.summary || '') + '</div>' +
        '<div class="sv-xi">' + xi + star + scorer + '</div>';
      card.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        if (act) { e.stopPropagation();
          if (act.dataset.act === 'remove') removeBuild(b.id);
          else if (act.dataset.act === 'rename') startRename(card, b.id);
          return;
        }
        card.classList.toggle('exp');
      });
      host.appendChild(card);
    });
    const foot = document.createElement('div'); foot.className = 'sv-foot';
    foot.textContent = 'Saved on this device · holds up to ' + CAP;
    host.appendChild(foot);
  }

  function removeBuild(id) {
    if (!window.confirm('Remove this saved build?')) return;
    persist(load().filter(b => b.id !== id));
    if (id === currentSavedId) { currentSavedId = null; refreshSaveBtn(); }
    haptic('LIGHT'); render();
  }

  function startRename(card, id) {
    const list = load(); const b = list.find(x => x.id === id); if (!b) return;
    const nameEl = card.querySelector('.sv-name'); if (!nameEl) return;
    const current = (b.name && b.name.trim()) ? b.name : dateLabel(b.savedAt);
    const wrap = document.createElement('div'); wrap.className = 'sv-edit';
    wrap.innerHTML = '<input maxlength="' + NAME_MAX + '" value="' + escapeHTML(current) + '" aria-label="Build name">' +
      '<button data-ok aria-label="Save name">✓</button><button data-cancel aria-label="Cancel">✕</button>';
    wrap.addEventListener('click', e => e.stopPropagation());
    nameEl.replaceWith(wrap);
    const input = wrap.querySelector('input'); input.focus(); try { input.select(); } catch (e) {}
    const commit = () => { b.name = input.value.trim().slice(0, NAME_MAX); persist(list); haptic('LIGHT'); render(); };
    wrap.querySelector('[data-ok]').addEventListener('click', commit);
    wrap.querySelector('[data-cancel]').addEventListener('click', render);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') render(); });
  }

  function openOverlay() { render(); const ov = document.getElementById('savedScreen'); if (ov) { ov.classList.add('open'); document.body.style.overflow = 'hidden'; } }
  function closeOverlay() { const ov = document.getElementById('savedScreen'); if (ov) { ov.classList.remove('open'); document.body.style.overflow = ''; } }

  /* ---------- save from results ---------- */
  function refreshSaveBtn() {
    const btn = document.getElementById('saveBuildBtn'); if (!btn) return;
    if (currentSavedId) { btn.innerHTML = '♥ Saved'; btn.classList.add('is-saved'); }
    else { btn.innerHTML = '♡ Save build'; btn.classList.remove('is-saved'); }
  }
  function toggleSaveCurrent() {
    if (currentSavedId) {
      persist(load().filter(b => b.id !== currentSavedId));
      currentSavedId = null; refreshSaveBtn(); haptic('LIGHT'); toast('Removed from saved');
      return;
    }
    const list = load();
    if (list.length >= CAP) { toast('Saved list is full (' + CAP + '). Remove one first.'); return; }
    let snap = null; try { snap = (CFG && CFG.capture) ? CFG.capture() : null; } catch (e) { snap = null; }
    if (!snap) { toast('Finish a build first'); return; }
    const build = Object.assign({ id: uid(), mode: CFG.mode, modeLabel: CFG.modeLabel, savedAt: Date.now(), name: '' }, snap);
    list.unshift(build); persist(list);
    currentSavedId = build.id; refreshSaveBtn(); haptic('MEDIUM'); toast('Saved to your builds ♥');
  }

  /* ---------- injection + boot ---------- */
  function injectButtons() {
    const bar = document.querySelector('header.topbar') || document.querySelector('.topbar');
    if (bar && !document.getElementById('savedOpenBtn')) {
      const btn = document.createElement('button');
      btn.className = 'icon-btn'; btn.id = 'savedOpenBtn'; btn.title = 'Saved builds'; btn.setAttribute('aria-label', 'Saved builds');
      btn.innerHTML = '♥';
      btn.addEventListener('click', openOverlay);
      const reset = document.getElementById('resetBtn');
      if (reset && reset.parentNode === bar) bar.insertBefore(btn, reset); else bar.appendChild(btn);
    }
    const actions = document.querySelector('.results-actions');
    if (actions && !document.getElementById('saveBuildBtn')) {
      const btn = document.createElement('button');
      btn.className = 'btn-ghost saveBuildBtn'; btn.id = 'saveBuildBtn'; btn.innerHTML = '♡ Save build';
      btn.addEventListener('click', toggleSaveCurrent);
      actions.appendChild(btn);
    }
  }
  // Reset the Save button to its unsaved state whenever a fresh result screen appears.
  function watchResults() {
    const rs = document.getElementById('resultsScreen'); if (!rs) return;
    new MutationObserver(() => {
      if (!rs.classList.contains('hidden')) { currentSavedId = null; refreshSaveBtn(); }
    }).observe(rs, { attributes: true, attributeFilter: ['class'] });
  }

  function init(cfg) {
    CFG = cfg || {};
    if (!isNative) return; // native app only. The web build never shows this
    const go = () => { injectStyles(); buildOverlay(); injectButtons(); watchResults(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }

  window.SavedBuilds = { init };
})();
