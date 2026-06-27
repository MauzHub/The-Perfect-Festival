'use strict';
/* Shared "How you drafted" post-game scorecard for the single-player EXPERT modes (ratings hidden
   during the draft). Reveals, per pick, the best player you could have taken for that position, plus
   the single best XI buildable from your 11 draws (each player in their optimal position, distinct
   players only). Mode-agnostic: takes the results rows ({slot,pick}) + DATA. Not used in PvP. */
(function () {
  const POS_TO_FAM = { GK:'GK',RB:'RB',RWB:'RB',LB:'LB',LWB:'LB',CB:'CB',CDM:'CM',CM:'CM',CAM:'CM',RM:'RW',RW:'RW',LM:'LW',LW:'LW',ST:'ST',CF:'ST' };
  const eligFams = (p) => { const s = new Set(); (p.p || []).forEach(x => { const f = POS_TO_FAM[x]; if (f) s.add(f); }); return s; };
  const popcount = (x) => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
  const bestFor = (squad, fam) => { let b = null; for (const p of squad) { if (eligFams(p).has(fam) && (!b || p.o > b.o)) b = p; } return b; };

  function compute(rows, DATA) {
    const n = rows.length;
    const squads = rows.map(r => DATA.squads[r.pick.team + '|' + r.pick.year] || []);
    const fams = rows.map(r => r.slot.fam);
    const teamName = (code) => (DATA.teams[code] || {}).name || code;
    const perPick = rows.map((r, i) => ({
      pos: r.slot.label, teamName: teamName(r.pick.team), year: r.pick.year,
      you: r.pick.player, best: bestFor(squads[i], fams[i]),
    }));
    // Best possible XI: assign the 11 squads to the 11 slots to maximise total rating (each player in
    // their best position), via bitmask DP, then a dedupe pass so a squad drawn twice fields two
    // different players (the second slot drops to the next-best eligible).
    const val = squads.map(sq => fams.map(f => { const b = bestFor(sq, f); return b ? b.o : -1; }));
    const full = (1 << n) - 1;
    const dp = new Float64Array(1 << n).fill(-Infinity); dp[0] = 0;
    const par = new Int32Array(1 << n).fill(-1);
    for (let mask = 0; mask <= full; mask++) {
      if (dp[mask] === -Infinity) continue;
      const slot = popcount(mask); if (slot >= n) continue;
      for (let spin = 0; spin < n; spin++) {
        if (mask & (1 << spin)) continue;
        const v = val[spin][slot]; if (v < 0) continue;
        const nm = mask | (1 << spin);
        if (dp[mask] + v > dp[nm]) { dp[nm] = dp[mask] + v; par[nm] = spin; }
      }
    }
    let bestXI = null;
    if (isFinite(dp[full])) {
      let mask = full; const assign = new Array(n);
      while (mask) { const spin = par[mask]; const slot = popcount(mask) - 1; assign[slot] = spin; mask ^= (1 << spin); }
      const used = new Set(); bestXI = [];
      for (let slot = 0; slot < n; slot++) {
        const spin = assign[slot], fam = fams[slot], sq = squads[spin];
        let bp = null;
        for (const p of sq) { if (eligFams(p).has(fam) && !used.has(p.i) && (!bp || p.o > bp.o)) bp = p; }
        if (!bp) for (const p of sq) { if (eligFams(p).has(fam) && (!bp || p.o > bp.o)) bp = p; }
        used.add(bp.i); bestXI.push({ pos: rows[slot].slot.label, player: bp, from: teamName(rows[spin].pick.team) + ' ' + rows[spin].pick.year });
      }
    }
    const yourMean = perPick.reduce((s, x) => s + x.you.o, 0) / n;
    const bestMean = bestXI ? bestXI.reduce((s, x) => s + x.player.o, 0) / n : yourMean;
    const perfect = perPick.filter(x => x.best && x.you.o === x.best.o).length;
    return { perPick, bestXI, yourMean, bestMean, perfect, n };
  }

  function injectCSS() {
    if (document.getElementById('da-css')) return;
    const st = document.createElement('style'); st.id = 'da-css';
    st.textContent = ''
      + '.draft-analysis{max-width:520px;margin:20px auto 0;text-align:left}'
      + '.da-h{font-size:18px;font-weight:900;display:flex;align-items:center;gap:9px;margin-bottom:10px;color:#e9e9f2}'
      + '.da-pill{font-size:11px;font-weight:800;padding:3px 9px;border-radius:8px;text-transform:uppercase;letter-spacing:.05em;background:rgba(255,45,120,.16);color:#ff8fb5}'
      + '.da-score{background:#12121f;border:1px solid #23233a;border-radius:16px;padding:16px;text-align:center;margin-bottom:10px}'
      + '.da-pct{font-size:46px;font-weight:900;line-height:1;color:#ffd24a}.da-pct.hi{color:#2ee06a}'
      + '.da-cap{font-size:12px;color:#8a8aa3;font-weight:700;margin-top:4px}'
      + '.da-means{display:flex;justify-content:center;gap:20px;margin-top:12px;font-size:12px;color:#8a8aa3}'
      + '.da-means b{color:#e9e9f2;font-size:16px}.da-means .da-best b{color:#ffd24a}.da-sep{width:1px;background:#23233a}'
      + '.da-tabs{display:flex;gap:8px;margin-bottom:9px}'
      + '.da-tabs button{flex:1;padding:9px;border:1px solid #23233a;border-radius:11px;background:#171728;color:#8a8aa3;font-weight:800;cursor:pointer;font-size:13px}'
      + '.da-tabs button.on{border-color:#ff2d78;color:#ff9ec0;background:rgba(255,45,120,.1)}'
      + '.da-rows{display:flex;flex-direction:column;gap:7px}.da-rows.hidden{display:none}'
      + '.da-row{display:flex;align-items:center;gap:11px;background:#12121f;border:1px solid #23233a;border-radius:12px;padding:9px 11px}'
      + '.da-row.perfect{border-color:rgba(46,224,106,.4);background:rgba(46,224,106,.06)}'
      + '.da-pos{width:36px;height:36px;flex:none;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;background:#171728;border:1px solid #23233a;color:#cfe}'
      + '.da-cmp{flex:1;min-width:0}.da-sq{font-size:11px;color:#8a8aa3;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}'
      + '.da-line{display:flex;align-items:center;gap:7px;font-size:14px;color:#e9e9f2}'
      + '.da-line .da-lbl{color:#8a8aa3;font-size:11px;font-weight:800;width:30px;flex:none}'
      + '.da-line .da-nm{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.da-line .da-r{margin-left:auto;font-weight:900}.da-line.best .da-nm,.da-line.best .da-r{color:#ffd24a}'
      + '.da-tag{flex:none;font-weight:900;font-size:12px;padding:2px 8px;border-radius:7px}'
      + '.da-tag.ok{background:rgba(46,224,106,.16);color:#2ee06a}.da-tag.miss{background:rgba(255,210,74,.14);color:#ffd24a}'
      + '.draft-analysis.hidden{display:none}';
    document.head.appendChild(st);
  }

  function render(container, rows, DATA) {
    if (!container || !rows || !rows.length || !DATA) return;
    injectCSS();
    const a = compute(rows, DATA);
    const pct = Math.round(a.yourMean / a.bestMean * 100);
    const off = (a.bestMean - a.yourMean).toFixed(1);
    const picksHTML = a.perPick.map(p => {
      const ok = p.best && p.you.o === p.best.o;
      const gap = p.best ? p.best.o - p.you.o : 0;
      return '<div class="da-row' + (ok ? ' perfect' : '') + '"><span class="da-pos">' + p.pos + '</span>'
        + '<div class="da-cmp"><div class="da-sq">' + p.teamName + ' ' + p.year + '</div>'
        + '<div class="da-line you"><span class="da-lbl">You</span><span class="da-nm">' + p.you.n + '</span><span class="da-r">' + p.you.o + '</span></div>'
        + (ok ? '' : '<div class="da-line best"><span class="da-lbl">Best</span><span class="da-nm">' + (p.best ? p.best.n : '—') + '</span><span class="da-r">' + (p.best ? p.best.o : '') + '</span></div>')
        + '</div>' + (ok ? '<span class="da-tag ok">✓</span>' : '<span class="da-tag miss">+' + gap + '</span>') + '</div>';
    }).join('');
    const bestHTML = a.bestXI ? a.bestXI.map(s =>
      '<div class="da-row"><span class="da-pos">' + s.pos + '</span><div class="da-cmp"><div class="da-sq">from ' + s.from + '</div>'
      + '<div class="da-line best"><span class="da-nm">' + s.player.n + '</span><span class="da-r">' + s.player.o + '</span></div></div></div>'
    ).join('') : '<div class="da-sq">Could not build an XI from these draws.</div>';
    container.innerHTML =
      '<div class="da-h">How you drafted <span class="da-pill">Expert</span></div>'
      + '<div class="da-score"><div class="da-pct' + (pct >= 95 ? ' hi' : '') + '">' + pct + '%</div>'
      +   '<div class="da-cap">of the best possible XI · ' + off + ' off perfect · ' + a.perfect + '/' + a.n + ' perfect picks</div>'
      +   '<div class="da-means"><div>Your XI<br><b>' + a.yourMean.toFixed(1) + '</b></div><div class="da-sep"></div><div class="da-best">Best possible<br><b>' + a.bestMean.toFixed(1) + '</b></div></div></div>'
      + '<div class="da-tabs"><button class="on" data-t="picks">Your picks</button><button data-t="best">Best possible XI</button></div>'
      + '<div class="da-rows" data-rows="picks">' + picksHTML + '</div>'
      + '<div class="da-rows hidden" data-rows="best">' + bestHTML + '</div>';
    const tabs = container.querySelectorAll('.da-tabs button');
    tabs.forEach(b => b.addEventListener('click', () => {
      tabs.forEach(x => x.classList.toggle('on', x === b));
      container.querySelectorAll('.da-rows').forEach(r => r.classList.toggle('hidden', r.getAttribute('data-rows') !== b.getAttribute('data-t')));
    }));
    container.classList.remove('hidden');
  }

  window.DraftAnalysis = { render: render };
})();
