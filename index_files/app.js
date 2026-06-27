'use strict';

/* ============================================================
   THE PERFECT FESTIVAL — Book the perfect festival line-up
   (Reskin of the 38-0-0 engine: clubs->genres, players->acts,
    formations->billings, a 38-game season->a 38-show tour.)
   ============================================================ */

const TOTAL_ROUNDS = 11;

// Formations. Each slot carries x,y (% on a vertical pitch, GK bottom / attack top),
// a display label, and a position FAMILY used for eligibility. Wing-backs (RWB/LWB)
// map to the RB/LB families; wide mids (RM/LM) map to the RW/LW families — so a player
// who can play LB can also fill an LWB slot, exactly as the user expects.
const FORMATIONS = {
  // ONE billing. Stages are tiered by SIZE, not genre — any act can play any stage. Weight drives how
  // much a stage counts toward the score (headliners matter most). Laid out as a poster, top->bottom.
  'main': { name:'The Line-up', slots:[
    {id:'HF', label:'Friday',   fam:'ANY', tier:1, weight:1.4, x:25, y:10},
    {id:'HS', label:'Saturday', fam:'ANY', tier:1, weight:1.4, x:50, y:8},
    {id:'HU', label:'Sunday',   fam:'ANY', tier:1, weight:1.4, x:75, y:10},
    {id:'M1', label:'Main',     fam:'ANY', tier:2, weight:1.0, x:33, y:32},
    {id:'M2', label:'Park',     fam:'ANY', tier:2, weight:1.0, x:67, y:32},
    {id:'M3', label:'River',    fam:'ANY', tier:2, weight:1.0, x:33, y:49},
    {id:'M4', label:'Field',    fam:'ANY', tier:2, weight:1.0, x:67, y:49},
    {id:'U1', label:'Tent',     fam:'ANY', tier:3, weight:0.7, x:33, y:68},
    {id:'U2', label:'Glade',    fam:'ANY', tier:3, weight:0.7, x:67, y:68},
    {id:'U3', label:'Sunset',   fam:'ANY', tier:3, weight:0.7, x:33, y:84},
    {id:'U4', label:'Late',     fam:'ANY', tier:3, weight:0.7, x:67, y:84},
  ]},
};

// The active formation's slots. Set in startGame(); defaults to 4-3-3 so any early
// reference is safe.
let SLOTS = FORMATIONS['main'].slots;
let currentFormationKey = 'main';
const slotById = (id) => SLOTS.find(s => s.id === id);

// FIFA position -> which family it can play (logical equivalences).
const POS_TO_FAM = {            // genre tag -> slot family (sub-genres roll up)
  POP:'POP',
  ROCK:'ROCK', INDIE:'ROCK', ALT:'ROCK', PUNK:'ROCK',
  ELEC:'ELEC', HOUSE:'ELEC', TECHNO:'ELEC', EDM:'ELEC', DNB:'ELEC',
  HIP:'HIP', RAP:'HIP', HIPHOP:'HIP',
  RNB:'RNB', SOUL:'RNB',
}

// Expert-mode sort order (GK → defence → midfield → attack) so the list isn't ranked by
// rating — otherwise, with stats hidden, the best player is always conveniently on top.
const POS_ORDER = { POP:0, ROCK:1, INDIE:1, ALT:1, PUNK:1, ELEC:2, HOUSE:2, TECHNO:2, EDM:2, DNB:2, HIP:3, RAP:3, HIPHOP:3, RNB:4, SOUL:4 };
const posRank = (p) => { const c = (p.p && p.p[0]) || 'POP'; return (c in POS_ORDER) ? POS_ORDER[c] : 0; };

const OPP_BASELINE = 78;     // a solid mid-bill act (cosmetic baseline)

// Team jersey colours: code -> [shirt, ink].
const TEAM_COLORS = {                 // source code -> [badge, ink]
  POP20:['#ff4d8d','#fff'], POP10:['#ff77a9','#26121d'],
  ROK00:['#c0392b','#fff'], ROK10:['#e2502a','#fff'],
  ELE10:['#13d4c4','#06121f'], ELE20:['#1fb6ff','#06121f'],
  HIP10:['#f1c40f','#1a1a1a'], HIP20:['#f5a623','#1a1a1a'],
  RNB10:['#9b6cff','#fff'], LEG90:['#ffd24a','#1a1a1a'],
}
const DEFAULT_COLORS = ['#7c3aed', '#FFFFFF'];
const colorsFor = (code) => TEAM_COLORS[code] || DEFAULT_COLORS;

// The "big six" come up a little more often on the spin (small extra weighting).
const BIG_SIX = new Set(['GLA', 'COA', 'LEG']);  // marquee editions come up a touch more
const BIG_SIX_WEIGHT = 1.6;

// Rewarded "watch an ad to re-spin" feature, powered by Google AdSense H5 Games Ads.
// OFF until H5 Games Ads is approved — flip to true the day ads go live.
const REWARDED_ADS_LIVE = false;
// Shows a rewarded video; calls onReward() once the player has earned the re-spin.
function showRewardedAd(onReward, onSkip){
  // Paid "Remove Ads" → the re-spin is free, no ad shown.
  if (window.IAP && IAP.hasNoAds()){ onReward(); return; }

  // Native app (iOS/Android) → Google AdMob rewarded video.
  if (window.NativeAds && NativeAds.available()){
    NativeAds.showRewarded(onReward, () => { toast('Watch the full ad to unlock your re-spin'); if (onSkip) onSkip(); });
    return;
  }

  // Web → AdSense H5 Games Ads.
  let settled = false;
  const grant = () => { if (!settled){ settled = true; onReward(); } };
  const skip  = () => { if (!settled){ settled = true; toast('Watch the full ad to unlock your re-spin'); if (onSkip) onSkip(); } };

  if (!(REWARDED_ADS_LIVE && typeof window.adBreak === 'function')){ onReward(); return; }

  // Safety net: if the ad SDK never responds (not yet approved / blocked), don't hang the game.
  const timer = setTimeout(grant, 8000);
  try {
    window.adBreak({
      type: 'reward',
      name: 'respin',
      beforeReward(showAd){ showAd(); },                 // a rewarded ad is ready — play it
      adViewed(){ clearTimeout(timer); grant(); },       // watched to completion → unlock
      adDismissed(){ clearTimeout(timer); skip(); },     // closed early → no re-spin
      adBreakDone(info){
        clearTimeout(timer);
        // 'viewed' already granted; 'dismissed' = no reward; anything else (no-fill,
        // error) shouldn't punish the player — let them re-spin.
        if (info && info.breakStatus !== 'dismissed') grant();
      },
    });
  } catch (e){ clearTimeout(timer); grant(); }
}

let DATA = null;
let state = null;
let gamesFinished = 0;  // completed XIs this session (for interstitial pacing)

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Analytics — safe no-op if PostHog is blocked/not loaded.
function track(event, props){
  try { if (window.posthog && posthog.capture) posthog.capture(event, props || {}); }
  catch (e) {}
  try { if (window.ceBeacon) window.ceBeacon(event); }           // shared stateless beacon (native.js)
  catch (e) {}
}

function ovClass(o){
  if (o >= 86) return 'ov-90';
  if (o >= 80) return 'ov-80';
  if (o >= 75) return 'ov-75';
  if (o >= 70) return 'ov-70';
  return 'ov-low';
}
function initials(name){
  const parts = name.replace(/\./g,'').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}
function toast(msg){
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1900);
}

// Jersey SVG markup (shirt silhouette in team colours with initials).
// Act badge: a vinyl-record / festival-pass token in the source colour with initials.
function jerseySVG(code, ini, size){
  const [bg, ink] = colorsFor(code);
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="32" cy="32" r="30" fill="${bg}" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/>
    <circle cx="32" cy="32" r="22" fill="none" stroke="${ink}" stroke-opacity=".55" stroke-width="1.3"/>
    <circle cx="32" cy="32" r="6.5" fill="${ink}" fill-opacity=".22"/>
    <circle cx="32" cy="32" r="2" fill="${ink}" fill-opacity=".5"/>
    <text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif"
      font-size="15" font-weight="900" fill="${ink}">${ini}</text>
  </svg>`;
}

/* eligibility */
function eligFamilies(p){
  const s = new Set();
  (p.p || []).forEach(pos => { const f = POS_TO_FAM[pos]; if (f) s.add(f); });
  return s;
}
function openSlots(){ return SLOTS.filter(s => !state.picks[s.id]); }
// An act can play ANY stage — stages differ by billing (size), not genre. The only rule is that the
// same artist can't be on the bill twice (deduped by name, even across different festival editions).
function isNameUsed(name){ return Object.values(state.picks).some(x => x.player.n === name); }
function slotAccepts(slot, p){ return !!slot && !isNameUsed(p.n); }
function playerOpenSlots(p){ return isNameUsed(p.n) ? [] : openSlots(); }
function isUsed(p){ return isNameUsed(p.n); }
function isActPicked(p){ return isNameUsed(p.n); }
// A spun edition is still useful if it holds an artist not already on the bill.
function comboHasEligible(c){
  if (!openSlots().length) return true;
  const squad = DATA.squads[`${c[0]}|${c[1]}`] || [];
  return squad.some(p => !isNameUsed(p.n));
}
function pickCombo(){
  const wt = (c) => BIG_SIX.has(c[0]) ? BIG_SIX_WEIGHT : 1;
  // Only spin sources that can actually fill an open stage — no dead spins / "spin again" loops.
  let pool = DATA.combos.filter(comboHasEligible);
  if (!pool.length) pool = DATA.combos;
  let total = 0;
  for (const c of pool) total += wt(c);
  let roll = Math.random() * total;
  for (const c of pool){ roll -= wt(c); if (roll <= 0) return c; }
  return pool[pool.length - 1];
}

/* ============================================================
   State
   ============================================================ */
// Pre-game setup: pick a MODE (classic/expert), then a FORMATION, then start.
let setupMode = null;
let setupFormation = null;
function showSetup(){
  setupMode = 'classic';        // always full-info mode (no Classic/Expert choice shown)
  setupFormation = 'main';      // single billing
  $('gameScreen').classList.add('hidden');
  $('resultsScreen').classList.add('hidden');
  $('setupScreen').classList.remove('hidden');
  const st = $('setupStart'); if (st) st.classList.remove('hidden');
  window.scrollTo(0, 0);
}
function maybeShowStart(){ /* no-op: setup always shows start button */ }
function startGame(mode, formationKey){
  const f = FORMATIONS[formationKey] || FORMATIONS['main'];
  SLOTS = f.slots;
  currentFormationKey = formationKey;
  spinCount = 0;
  state = { round: 1, current: null, selectedIdx: null, picks: {}, moving: null, spinning: false,
            result: null, respinUsed: false, mode, expert: mode === 'expert', formation: formationKey };
  document.body.classList.toggle('mode-expert', mode === 'expert');
  $('formationTag').textContent = f.name;
  $('setupScreen').classList.add('hidden');
  $('resultsScreen').classList.add('hidden');
  $('gameScreen').classList.remove('hidden');
  $('draftPane').classList.add('hidden');
  $('spinPane').classList.remove('hidden');
  $('spinBtn').disabled = false;
  $('spinHint').textContent = 'Spin a festival & year, then draft an act.';
  ensureMoveStyles();
  buildPitch();
  updateRoundPill();
  window.scrollTo(0, 0);   // start at the top so the SPIN button is in view (mobile)
  track('game_start', { mode, formation: formationKey });
}
function updateRoundPill(){
  const r = Math.min(countPicks() + 1, TOTAL_ROUNDS);
  $('roundPill').textContent = `Round ${r} / ${TOTAL_ROUNDS}`;
}
function countPicks(){ return Object.keys(state.picks).length; }

/* ============================================================
   Pitch
   ============================================================ */
function buildPitch(){
  const pitch = $('pitch');
  pitch.querySelectorAll('.slot').forEach(n => n.remove());
  SLOTS.forEach(slot => {
    const el = document.createElement('div');
    el.className = 'slot open';
    el.style.left = slot.x + '%';
    el.style.top = slot.y + '%';
    el.dataset.slot = slot.id;
    el.dataset.tier = slot.tier || 3;
    el.innerHTML = `<div class="slot-node">${slot.label}</div>`;
    el.addEventListener('click', () => onSlotClick(slot.id));
    pitch.appendChild(el);
  });
  refreshPitch();
}
function refreshPitch(){
  let armedSet = new Set();
  if (state.selectedIdx !== null){
    const p = state.current.players[state.selectedIdx];
    armedSet = new Set(playerOpenSlots(p).map(s => s.id));
  } else if (state.moving){
    armedSet = new Set(playerOpenSlots(state.picks[state.moving].player).map(s => s.id));
  }
  SLOTS.forEach(slot => {
    const el = document.querySelector(`.slot[data-slot="${slot.id}"]`);
    const pick = state.picks[slot.id];
    el.classList.toggle('armed', armedSet.has(slot.id));
    el.classList.toggle('moving', state.moving === slot.id);
    if (pick){
      el.classList.remove('open');
      el.classList.add('filled');
      const p = pick.player;
      el.innerHTML =
        `<div class="slot-node">${jerseySVG(pick.team, initials(p.n), 58)}` +
        `<span class="slot-ov">${p.o}</span></div>` +
        `<span class="slot-name">${p.n}</span>`;
    } else {
      el.classList.add('open');
      el.classList.remove('filled');
      el.innerHTML = `<div class="slot-node">${slot.label}</div>`;
    }
  });
}
/* ---- Move an already-placed player to another eligible, open position ---- */
function ensureMoveStyles(){
  if (document.getElementById('moveStyles')) return;
  const s = document.createElement('style'); s.id = 'moveStyles';
  s.textContent = '.slot.filled{cursor:pointer}'
    + '.slot.filled .slot-node{transition:transform .12s ease,box-shadow .12s ease}'
    + '.slot.filled:hover .slot-node{transform:translateY(-3px)}'
    + '.slot.moving .slot-node{transform:translateY(-7px) scale(1.1);box-shadow:0 0 0 5px rgba(255,45,120,.34),0 10px 22px rgba(0,0,0,.5)}';
  document.head.appendChild(s);
}
function startMove(slotId){
  const pick = state.picks[slotId]; if (!pick) return;
  const p = pick.player;
  const targets = SLOTS.filter(s => !state.picks[s.id] && s.id !== slotId && slotAccepts(s, p));
  if (!targets.length){ toast(`No other open spot for ${p.n}`); return; }
  state.moving = slotId; state.selectedIdx = null;
  if (window.NativeAds && NativeAds.haptic) NativeAds.haptic('LIGHT');
  toast(`Moving ${p.n}. Tap a highlighted spot.`);
  if (state.current) renderPlayerList($('draftSearch').value);
  refreshPitch(); updateInstruct();
}
function moveTo(slotId){
  const src = state.moving;
  if (slotId === src){ cancelMove(); return; }
  if (state.picks[slotId]){ startMove(slotId); return; }
  const pick = state.picks[src], slot = slotById(slotId);
  if (!slot || !pick || !slotAccepts(slot, pick.player)){ toast(`${pick.player.n} can't go there`); return; }
  state.picks[slotId] = Object.assign({}, pick, { slotId });
  delete state.picks[src];
  state.moving = null;
  if (window.NativeAds && NativeAds.haptic) NativeAds.haptic('MEDIUM');
  refreshPitch(); updateInstruct();
}
function cancelMove(){ state.moving = null; refreshPitch(); updateInstruct(); }

function onSlotClick(slotId){
  if (state.moving){ moveTo(slotId); return; }
  if (state.picks[slotId]){ startMove(slotId); return; }
  if (state.selectedIdx === null) return;
  const player = state.current.players[state.selectedIdx];
  const slot = slotById(slotId);
  if (!slot || !slotAccepts(slot, player)){
    toast(`${player.n} can't go there`); return;
  }
  state.picks[slotId] = { player, team: state.current.team, year: state.current.year, slotId };
  if (window.NativeAds) NativeAds.haptic('MEDIUM');
  state.selectedIdx = null;
  state.current = null;

  if (countPicks() >= TOTAL_ROUNDS){ showResults(); return; }

  $('draftPane').classList.add('hidden');
  $('spinPane').classList.remove('hidden');
  $('spinBtn').disabled = false;
  $('spinHint').textContent = `${countPicks()}/${TOTAL_ROUNDS} slots booked — spin for the next.`;
  updateRoundPill();
  refreshPitch();
  if (window.innerWidth <= 900) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   Spin
   ============================================================ */
function spin(isRespin){
  if (state.spinning) return;
  state.spinning = true;
  if (window.NativeAds) NativeAds.haptic('LIGHT');
  if (!isRespin){ spinCount++; }  // re-spin allowance is ONCE PER GAME (reset only in startGame)
  $('spinBtn').disabled = true;
  $('spinHint').textContent = 'SPINNING…';
  $('reelTeam').classList.add('spinning');
  $('reelYear').classList.add('spinning');

  const combo = pickCombo();
  const teamCodes = Object.keys(DATA.teams);
  let ticks = 0;
  const total = 22 + Math.floor(Math.random()*8);
  const iv = setInterval(() => {
    ticks++;
    $('reelTeamVal').textContent = rand(teamCodes);
    $('reelYearVal').textContent = rand(DATA.years);
    if (ticks >= total){
      clearInterval(iv);
      $('reelTeamVal').textContent = combo[0];
      $('reelYearVal').textContent = combo[1];
      $('reelTeam').classList.remove('spinning');
      $('reelYear').classList.remove('spinning');
      state.spinning = false;
      track(isRespin ? 'respin_used' : 'spin', { round: countPicks() + 1, team: combo[0], year: combo[1] });
      openDraft(combo[0], combo[1]);
    }
  }, 55);
}

/* ---------- donation popup ---------- */
let spinCount = 0;
let donationFirstShown = false;
const KOFI_URL = 'https://ko-fi.com/38_0_0game';
function showDonationModal(){ return; /* disabled */
  if (document.getElementById('donateModal')) return;
  const m = document.createElement('div');
  m.id = 'donateModal';
  m.className = 'modal-overlay';
  m.innerHTML = `
    <div class="donate-card">
      <button class="donate-x" id="donateX" aria-label="Close">×</button>
      <div class="donate-title">Help Us Go 38-0-0</div>
      <p class="donate-body">Thanks for all the love for 38-0-0. Growth is amazing — but it also
        means the costs to keep it online are piling up. If you want to help keep the game alive,
        ad-free, and independent, consider supporting the project on Ko-fi.</p>
      <div class="donate-actions">
        <a class="donate-support" id="donateSupport" href="${KOFI_URL}" target="_blank" rel="noopener">Support on Ko-fi</a>
        <button class="donate-later" id="donateLater">Maybe later</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  $('donateX').addEventListener('click', close);
  $('donateLater').addEventListener('click', close);
  $('donateSupport').addEventListener('click', () => { track('donation_clicked'); close(); }); // opens Ko-fi in new tab
}

/* ---------- socials prompt (shown once, after the first completed game) ---------- */
let socialsShown = false;
const SOCIAL_X = 'https://x.com/densancar';
const SOCIAL_IG = 'https://www.instagram.com/densancar/';
function showSocialsModal(){ return; /* disabled */
  if (document.getElementById('socialsModal')) return;
  const m = document.createElement('div');
  m.id = 'socialsModal';
  m.className = 'modal-overlay';
  m.innerHTML = `
    <div class="donate-card">
      <button class="donate-x" id="socialsClose" aria-label="Close">×</button>
      <div class="donate-title">Enjoying 38-0-0?</div>
      <p class="donate-body">Follow my socials to keep up with updates — new genres, eras and
        features are on the way.</p>
      <div class="donate-actions">
        <a class="social-btn x" href="${SOCIAL_X}" target="_blank" rel="noopener">Follow on X</a>
        <a class="social-btn ig" href="${SOCIAL_IG}" target="_blank" rel="noopener">Instagram</a>
      </div>
      <button class="donate-later social-later" id="socialsLater">Maybe later</button>
    </div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  $('socialsClose').addEventListener('click', close);
  $('socialsLater').addEventListener('click', close);
  m.querySelector('.social-btn.x').addEventListener('click', () => { track('social_clicked', { platform: 'x' }); close(); });
  m.querySelector('.social-btn.ig').addEventListener('click', () => { track('social_clicked', { platform: 'instagram' }); close(); });
}

// Re-spin is available with rewarded ads (web flag), a native AdMob build, or "Remove Ads".
function refreshRespinBtn(){
  const enabled = REWARDED_ADS_LIVE
    || !!(window.NativeAds && NativeAds.available())
    || !!(window.IAP && IAP.hasNoAds());
  $('respinBtn').classList.toggle('hidden', !enabled || state.respinUsed);
  // Always set BOTH states so the label can never get stuck on "(free)" for a non-paying user.
  $('respinBtn').textContent = (window.IAP && IAP.hasNoAds())
    ? '🔄 Re-spin the genre (free)'
    : '🎬 Re-spin the genre (watch an ad)';
}

// Plain AdSense display banner on the results screen (WEBSITE only). Off until AdSense
// approves and you create a display ad unit — then set ADSENSE_BANNER_LIVE = true and
// paste the unit's data-ad-slot into ADSENSE_SLOT.
const ADSENSE_BANNER_LIVE = false;
const ADSENSE_CLIENT = 'ca-pub-5828601537093994';
const ADSENSE_SLOT = '0000000000'; // TODO: your display ad unit slot id
let resultsBannerShown = false;
function showResultsBanner(){
  if (!ADSENSE_BANNER_LIVE) return;
  if (window.NativeAds && NativeAds.isNative) return;     // the app uses AdMob, not web AdSense
  if (window.IAP && IAP.hasNoAds()) return;
  const host = $('resultsAd');
  if (!host) return;
  host.classList.remove('hidden');
  if (resultsBannerShown) return;                          // create the slot once
  resultsBannerShown = true;
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.setAttribute('data-ad-client', ADSENSE_CLIENT);
  ins.setAttribute('data-ad-slot', ADSENSE_SLOT);
  ins.setAttribute('data-ad-format', 'auto');
  ins.setAttribute('data-full-width-responsive', 'true');
  host.appendChild(ins);
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
}

// Show/hide the "Remove ads" purchase row (native only, until purchased).
function updateIapUI(){
  const avail = !!(window.IAP && IAP.available());
  const owned = !!(window.IAP && IAP.hasNoAds());
  const row = $('iapRow');
  if (row){
    row.classList.toggle('hidden', !avail || owned);
    if (avail && !owned) $('removeAdsBtn').textContent = 'Remove ads';
  }
  // Footer "Restore purchases" link: shown only in the app when not already ad-free, so a buyer
  // whose entitlement was lost can restore it the instant they open the app, without finishing a game.
  const fr = $('footerRestoreWrap');
  if (fr) fr.classList.toggle('hidden', !avail || owned);
}

// Watch a rewarded ad to re-spin the current genre/era (once per game).
function rewardedRespin(){
  if (state.spinning || state.respinUsed) return;
  const btn = $('respinBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Loading ad…';
  const restore = () => { btn.disabled = false; btn.textContent = label; };
  showRewardedAd(
    () => {
      restore();
      state.respinUsed = true;
      state.selectedIdx = null;
      state.current = null;
      $('draftPane').classList.add('hidden');
      $('spinPane').classList.remove('hidden');
      if (window.innerWidth <= 900) window.scrollTo({ top: 0, behavior: 'smooth' });
      spin(true);
    },
    restore   // skipped the ad → re-enable the button
  );
}

/* ============================================================
   Draft
   ============================================================ */
function openDraft(teamCode, year){
  const players = (DATA.squads[`${teamCode}|${year}`] || []).slice();
  // Classic: keep the data's overall-sorted order (best first). Expert: sort by position so
  // the hidden ratings aren't given away by list order.
  if (state.expert) players.sort((a, b) => posRank(a) - posRank(b) || a.n.localeCompare(b.n));
  state.current = { team: teamCode, year, players };
  state.selectedIdx = null;

  // If nobody in this squad fits an open slot (or all already used), re-spin.
  const anyPlayable = players.some(p => !isUsed(p) && playerOpenSlots(p).length > 0);
  if (!anyPlayable){
    $('spinPane').classList.remove('hidden');
    $('draftPane').classList.add('hidden');
    $('spinBtn').disabled = false;
    $('spinHint').textContent =
      `Every act from ${DATA.teams[teamCode].name} ${year} is already booked — spin again.`;
    return;
  }

  const team = DATA.teams[teamCode];
  $('draftTeamName').textContent = team.name;
  $('draftYear').textContent = year;
  $('draftSearch').value = '';

  renderPlayerList('');
  updateInstruct();
  refreshRespinBtn();
  $('spinPane').classList.add('hidden');
  $('draftPane').classList.remove('hidden');
  refreshPitch();
  // On mobile the pitch sits on top — bring the squad list into view to pick.
  if (window.innerWidth <= 900){
    $('draftPane').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function remainingSlotsLabel(){
  const uniq = [...new Set(openSlots().map(s => s.label))];
  return `${openSlots().length} spots left (${uniq.join(', ')})`;
}
function updateInstruct(){
  if (state.moving){
    $('draftInstruct').textContent = `Moving ${state.picks[state.moving].player.n}. Tap a highlighted spot, or tap him again to cancel.`;
  } else if (state.selectedIdx !== null){
    const p = state.current.players[state.selectedIdx];
    $('draftInstruct').textContent = `${p.n} selected. Tap a highlighted stage spot.`;
  } else {
    $('draftInstruct').textContent = `Pick an act, or tap one on the poster to move it. ${remainingSlotsLabel()}.`;
  }
}
function renderPlayerList(filter){
  const list = $('playerList');
  list.innerHTML = '';
  const f = (filter || '').toLowerCase();
  const { team, players } = state.current;

  players
    .filter(p => !f || p.n.toLowerCase().includes(f))
    .forEach((p) => {
      const realIdx = players.indexOf(p);
      const used = isUsed(p);
      const eligible = !used && playerOpenSlots(p).length > 0;
      const row = document.createElement('div');
      row.className = 'prow'
        + (used ? ' ineligible' : '')
        + (!used && !eligible ? ' ineligible' : '')
        + (state.selectedIdx === realIdx ? ' selected' : '');
      const posTag = (p.p && p.p[0]) ? p.p[0] : '—';
      const usedTag = used ? ' · already on the bill' : '';
      row.innerHTML =
        `<div class="prow-face">${jerseySVG(team, initials(p.n), 40)}</div>` +
        `<div class="prow-id">
           <div class="prow-name">${p.n}</div>
           <div class="prow-meta"><span class="prow-pos">${(p.p||[]).join('/')||posTag}</span>${usedTag}</div>
         </div>
         <div class="prow-stats">
           <b data-k="PAC">${stat(p,'pac')}</b><b data-k="SHO">${stat(p,'sho')}</b><b data-k="PAS">${stat(p,'pas')}</b>
           <b data-k="DRI">${stat(p,'dri')}</b><b data-k="DEF">${stat(p,'def')}</b><b data-k="PHY">${stat(p,'phy')}</b>
         </div>
         <div class="prow-ov ${ovClass(p.o)}">${p.o}</div>`;
      if (eligible) row.addEventListener('click', () => selectPlayer(realIdx));
      list.appendChild(row);
    });

  if (!list.children.length){
    list.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">No players match.</div>`;
  }
}
function stat(p, key){ const v = p[key]; return v > 0 ? v : '–'; }

function selectPlayer(idx){
  state.selectedIdx = (state.selectedIdx === idx) ? null : idx;
  renderPlayerList($('draftSearch').value);
  updateInstruct();
  refreshPitch();
  // On mobile, bring the pitch into view so the highlighted slots are tappable.
  if (state.selectedIdx !== null && window.innerWidth <= 900){
    $('pitch').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* ============================================================
   Projected record (all picks are in-position, so eff = overall)
   ============================================================ */
// Tightened top-tier thresholds (v2.1): a perfect / unbeaten / centurion season now needs a strong
// rating AND a good season swing, not rating alone. Calibrated in scripts/calibrate_epl.py to
// ~1 in 600 (38-0-0), ~1 in 50 (Invincibles), ~1 in 14 (Centurions) for a strong draft.
const GOAT_T = 94.80, INV_T = 93.85, CENT_T = 93.05;   // sold-out tour / sell-out tour / headline-act floors
const B_CHAMP = 91.00, B_CL = 89.00, B_EUR = 87.00, B_MID = 84.00;   // headliner / main-stage / big-top / mid-bill bands
const SEASON_VAR = 3.0;   // season swing multiplier (a league is more predictable than a cup)

// Rating -> (W,D) anchors. Records interpolate between these; L = 38 - W - D.
// Tuned so badge bands (by rating) line up with believable season records.
const RECORD_ANCHORS = [
  // lineup rating -> (sold-out shows W, half-full D); flops L = 38 - W - D. Rescaled to the
  // believable draw-power scale (top acts ~95-97), GOAT_T=95.2. Same curve shape as the original.
  [67.75,   1,  3],   // cancelled-tier: a near-empty run
  [71.75,   3,  5],
  [76.00,   4,  8],
  [80.00,   8,  9],
  [84.00,  12, 11],   // mid-bill floor
  [86.00,  16, 10],
  [87.00,  18, 10],   // big-top floor
  [88.00,  20,  9],
  [89.00,  22,  9],   // main-stage floor
  [90.00,  25,  8],
  [91.00,  27,  8],   // headliners floor
  [CENT_T, 32,  4],   // headline-act floor (100 hype)
  [INV_T,  34,  4],   // sell-out-tour floor (unbeaten)
  [GOAT_T, 38,  0],   // perfect festival (38-0-0)
];
function recordFromRating(S){
  if (S >= GOAT_T) return { W:38, D:0, L:0 };
  const Sc = clamp(S, RECORD_ANCHORS[0][0], GOAT_T);
  let a = RECORD_ANCHORS[0], b = RECORD_ANCHORS[RECORD_ANCHORS.length-1];
  for (let i=0;i<RECORD_ANCHORS.length-1;i++){
    if (Sc >= RECORD_ANCHORS[i][0] && Sc <= RECORD_ANCHORS[i+1][0]){
      a = RECORD_ANCHORS[i]; b = RECORD_ANCHORS[i+1]; break;
    }
  }
  const t = (Sc - a[0]) / (b[0] - a[0]);
  let W = clamp(Math.round(a[1] + (b[1]-a[1])*t), 0, 38);
  let D = clamp(Math.round(a[2] + (b[2]-a[2])*t), 0, 38 - W);
  return { W, D, L: 38 - W - D };
}

// Top badges are earned by the actual record (GOAT = perfect, Invincibles =
// unbeaten, Centurions = 100+ pts); the rest are by rating band.
// Maps a rating to its tier key (used for the recap's expected-finish seed).
function bandTier(x){
  if (x >= GOAT_T) return 'GOAT';
  if (x >= INV_T)  return 'INVINCIBLES';
  if (x >= CENT_T) return 'CENTURIONS';
  if (x >= B_CHAMP)  return 'CHAMPIONS';
  if (x >= B_CL)  return 'CHAMPIONS LEAGUE';
  if (x >= B_EUR)  return 'EUROPA';
  if (x >= B_MID)  return 'MID-TABLE';
  return 'RELEGATION';
}
function tierFor(r){
  const { W, L, pts } = r; const x = (r.aS != null ? r.aS : r.S);   // the ACTUAL season drives band tiers
  if (r.isWoat)   return { name:'CANCELLED',        color:'linear-gradient(135deg,#c69a5b,#7a4a2a)' };
  if (W === 38)   return { name:'PERFECT FESTIVAL', color:'linear-gradient(135deg,#ffd24a,#ff2d78,#7c3aed)' };
  if (L === 0)    return { name:'SELL-OUT TOUR',    color:'linear-gradient(135deg,#ffd24a,#ff9d3d)' };
  if (pts >= 100) return { name:'HEADLINE ACT',     color:'linear-gradient(135deg,#13d4c4,#7c3aed)' };
  if (x >= B_CHAMP) return { name:'FESTIVAL HEADLINERS', color:'linear-gradient(135deg,#ffd24a,#ff9d3d)' };
  if (x >= B_CL) return { name:'MAIN STAGE',       color:'linear-gradient(135deg,#7c3aed,#ff2d78)' };
  if (x >= B_EUR) return { name:'BIG TOP',          color:'linear-gradient(135deg,#13d4c4,#7c3aed)' };
  if (x >= B_MID) return { name:'MID-BILL',         color:'linear-gradient(135deg,#5a5a72,#8a8aa3)' };
  if (pts < 11)   return { name:'EMPTY FIELD',      color:'linear-gradient(135deg,#4a2a2a,#1a1216)' };
  return { name:'OPEN-MIC NIGHT', color:'linear-gradient(135deg,#ff5470,#7a2a3a)' };
}
/* ---------- WOAT: the 0-0-38 (inverse of the GOAT) ----------
   Only awarded when EVERY pick is among the worst-rated players in the whole game for
   its position. With the weighted spin, that needs ~11 perfect (worst) spins, so it is
   statistically almost impossible — the mirror of building a flawless 38-0-0 XI. */
let _worstFam = null;
function worstByFamily(){
  if (_worstFam) return _worstFam;
  const minO = {};              // player id -> lowest overall they appear at anywhere in the game
  const fams = {};              // player id -> Set of position families they can fill
  for (const key in DATA.squads){
    for (const p of DATA.squads[key]){
      if (minO[p.i] === undefined || p.o < minO[p.i]) minO[p.i] = p.o;
      const f = eligFamilies(p);
      if (!fams[p.i]) fams[p.i] = new Set(f); else f.forEach(x => fams[p.i].add(x));
    }
  }
  const byFam = {};             // family -> [{i,o}] ascending (worst first)
  for (const id in minO){
    fams[id].forEach(f => { (byFam[f] = byFam[f] || []).push({ i: +id, o: minO[id] }); });
  }
  for (const f in byFam) byFam[f].sort((a, b) => a.o - b.o || a.i - b.i);
  _worstFam = { byFam, minO };
  return _worstFam;
}
function woatCheck(){
  if (!state || !state.picks) return false;
  const W = worstByFamily();
  // The worst XI this formation could possibly field: greedily give each slot the lowest-rated
  // still-unused player who can fill it. That sum is the theoretical floor.
  const used = new Set(); let floor = 0;
  for (const s of SLOTS){
    const list = W.byFam[s.fam] || [];
    let pick = null;
    for (const c of list){ if (!used.has(c.i)){ pick = c; break; } }
    if (!pick) return false;
    used.add(pick.i); floor += pick.o;
  }
  // Your XI, summing each picked player's lowest overall anywhere in the game. WOAT only if it
  // matches that floor — you really did draft the worst possible player for every position.
  let total = 0;
  for (const s of SLOTS){
    const pk = state.picks[s.id]; if (!pk) return false;
    const m = W.minO[pk.player.i]; if (m === undefined) return false;
    total += m;
  }
  return total <= floor;
}
function computeRecord(){
  const rows = SLOTS.map(slot => {
    const pick = state.picks[slot.id];
    return { slot, pick, eff: pick.player.o };
  });
  // STAGE-WEIGHTED rating: headliners pull the most weight, the undercard the least — so putting a
  // big act on a headliner stage matters, and a weak headliner drags the whole bill.
  const wOf = (s) => s && s.weight != null ? s.weight : 1;
  let wsum = 0, wtot = 0;
  rows.forEach(r => { const w = wOf(r.slot); wsum += w * r.eff; wtot += w; });
  const Sraw = wsum / wtot;

  // RANGE BONUS (new): a bill spanning more genres lands better; a one-note bill drags. Modest,
  // so it nudges rather than dominates. Folded into the rating so expectation stays consistent.
  const famsUsed = new Set();
  rows.forEach(r => eligFamilies(r.pick.player).forEach(f => famsUsed.add(f)));
  const RANGE_BONUS = { 1:-2.4, 2:-1.1, 3:-0.3, 4:0.2, 5:0.6 };
  const famCount = Math.min(5, famsUsed.size);
  const diversity = RANGE_BONUS[famCount] || 0;
  const S = Sraw + diversity;

  // Season variance: the squad rating is the EXPECTED level; the ACTUAL season carries a swing, so
  // the same XI no longer posts an identical record every time and can over/under-perform its paper
  // rating. A league is more predictable than a cup, so the swing is modest (calibrate_epl.py).
  const swing = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * SEASON_VAR;
  const aS = S + swing;
  let { W, D, L } = recordFromRating(aS);

  // 38-0-0 is reserved for a true GOAT season (rating ceiling + a good year); below it, never perfect.
  if (aS >= GOAT_T){ W = 38; D = 0; L = 0; }
  else if (W === 38){ W = 37; D = 1; L = 0; }   // a hair below GOAT stays unbeaten 37-1-0

  // The WOAT (0-0-38): the worst-player-per-position XI loses every game, no matter the variance.
  const isWoat = woatCheck();
  if (isWoat){ W = 0; D = 0; L = 38; }

  // Verdict: compare the ACTUAL finish to the finish the squad's rating EXPECTED, on the fine finish
  // rank (league position, then elite tiers). Driven by the same finish shown on screen, so the
  // badge/headline/verdict can never contradict, while the position granularity keeps over/under
  // common (2nd when rated 1st is a small under; 5th when rated 7th a small over).
  const pts = W * 3 + D;
  const actRank = rankOf(W, D, L, pts, aS);
  // Expectation caps at winning the title (rank 79): no squad is ever "expected" to go Centurions /
  // Invincible / 38-0-0, so those elite seasons always read as overachievements, never as a title
  // win being branded an underachievement.
  const expRank = Math.min(79, finishRank(S));
  const verdict = actRank > expRank ? 'OVERPERFORMED' : actRank < expRank ? 'UNDERPERFORMED' : 'MET EXPECTATIONS';

  return { W, D, L, pts, S: +S.toFixed(1), aS, verdict, expRank, actRank, rows, isWoat, famCount, diversity };
}

/* ============================================================
   Full-season breakdown ("Show more")
   ============================================================ */
const ATT_FAMS = new Set(['POP','HIP','RNB']);   // the crowd-pulling families
function strHash(s){ let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function ordinal(n){ const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// Final league position from a rating + points. Aligned to the badge bands so the two never
// contradict (a Champions-tier side always finishes 1st), with points breaking ties inside a band.
function positionFor(x, p){
  if (x >= B_CHAMP) return 1;                                   // title: GOAT / Invincibles / Centurions / Champions
  if (x >= B_CL) return p >= 80 ? 2 : (p >= 74 ? 3 : 4);     // Champions League places
  if (x >= B_EUR) return p >= 66 ? 5 : (p >= 60 ? 6 : 7);     // Europa places
  if (x >= B_MID) return p >= 54 ? 8 : (p >= 48 ? 11 : 14);   // mid-table
  return p >= 40 ? 15 : (p >= 34 ? 18 : 20);                  // relegation battle
}
function leaguePosition(r){ return positionFor((r.aS != null ? r.aS : r.S), r.pts); }
// One ordered finish rank so the verdict has fine granularity: league position 20th..1st maps to
// 60..79, then the elite tiers sit above 1st. The actual and expected finish compare on this scale.
function rankOf(W, D, L, pts, x){
  if (W === 38)   return 100;   // GOAT
  if (L === 0)    return 99;    // Invincibles
  if (pts >= 100) return 98;    // Centurions
  return 80 - positionFor(x, pts);
}
function finishRank(x){
  let { W, D, L } = recordFromRating(x);
  if (x >= GOAT_T){ W = 38; D = 0; L = 0; } else if (W === 38){ W = 37; D = 1; L = 0; }
  return rankOf(W, D, L, W * 3 + D, x);
}
// Plain-English finish, used by the recap so the verdict always reads consistently with the badge.
function finishDesc(rank){
  if (rank >= 100) return 'a perfect sold-out tour';
  if (rank >= 99)  return 'a sell-out tour';
  if (rank >= 98)  return 'a headline run';
  const pos = 80 - rank;
  return pos === 1 ? 'top billing' : `${ordinal(pos)} on the bill`;
}
// Player of the season = highest rated in the XI.
function topPlayer(rows){
  return rows.reduce((best, x) => x.pick.player.o > best.pick.player.o ? x : best, rows[0]);
}
// Top scorer = best attacker by shooting; goals scale with shooting and team success.
function topScorer(rows, r){
  const atts = rows.filter(x => (x.pick.player.p || []).some(p => ATT_FAMS.has(p)));
  const pool = atts.length ? atts : rows;
  const best = pool.reduce((b, x) =>
    ((x.pick.player.sho || x.pick.player.o) > (b.pick.player.sho || b.pick.player.o)) ? x : b, pool[0]);
  const pl = best.pick.player;
  const sho = pl.sho || pl.o;
  const jit = (strHash(pl.n) % 5) - 2;                                  // small +/- 2 flavour
  const goals = Math.max(4, Math.min(40, Math.round(r.W * 0.8 * (sho / 85)) + jit));
  return { row: best, goals };
}
// Cups are knockouts, so chance scales with squad strength and aligns with the badge bands:
// the two DOMESTIC cups are easy (a Europa-level side has a decent shot, a title side usually
// wins, a 38-0-0 side almost always does). The EUROPEAN cup is the elite gatekeeper, gated to
// Invincibles-level squads (S>=85), which keeps the QUADRUPLE extremely rare (~1 in 2,700
// without a re-spin) even though the domestic cups are common.
function cupResults(S){
  const chance = (lo, hi, cap) => clamp((S - lo) / (hi - lo), 0, cap);
  // Domestic cups are moderate (balanced calibration): a 38-0-0 side wins each ~60-65%, a
  // Champions side ~50-60%, a Europa side ~10-17%. This keeps the TREBLE (any 3 of 4) rare
  // (~1 in 20) while a strong team still usually lifts something. Double (any 2 of 4) ~1 in 5.
  const league   = Math.random() < chance(79.8, 91.8, 0.72);
  const national = Math.random() < chance(80.8, 92.8, 0.66);
  // European Cup: winnable from the Champions floor (now 84.05 after the full pool shift) but
  // rare, climbing for elite sides. The gate that keeps the QUADRUPLE the hardest achievement
  // (~1 in 730 without a re-spin) even with the 254-squad pool.
  const european = S >= B_CHAMP && Math.random() < chance(B_CHAMP, B_CHAMP+40, 0.35);
  return [
    { name:'Set of the Weekend', ico:'🎤', won: league },
    { name:'Surprise of the Fest', ico:'✨', won: national },
    { name:'Critics\' Choice',     ico:'⭐', won: european },
  ];
}
function populateBreakdown(r){
  const pos = leaguePosition(r);
  $('bdPosition').textContent = ordinal(pos);

  const tp = topPlayer(r.rows).pick;
  $('bdTopPlayer').textContent = tp.player.n;
  $('bdTopPlayerSub').textContent = `${DATA.teams[tp.team].name} ${tp.year} · ${tp.player.o} OVR`;

  const ts = topScorer(r.rows, r);
  $('bdTopScorer').textContent = ts.row.pick.player.n;
  $('bdTopScorerSub').textContent = `${ts.goals}k crowd`;

  const cups = cupResults(r.aS != null ? r.aS : r.S);
  const wrap = $('bdCups'); wrap.innerHTML = '';
  cups.forEach(c => {
    const el = document.createElement('div');
    el.className = 'bd-cup ' + (c.won ? 'won' : 'lost');
    el.innerHTML = `<span class="bd-cup-ico">${c.won ? c.ico : '✕'}</span>${c.name}`;
    wrap.appendChild(el);
  });
  // store for later (share / analytics / celebration)
  const won = cups.filter(c => c.won);
  r.position = pos;
  r.cups = cups;                       // full set (name + won) for the share card
  r.cupsWon = won.map(c => c.name);
  // Double / treble / quad = winning ANY 2 / 3 / 4 of the four competitions
  // (league title + the three cups). The league title counts as one of the four.
  const trophies = (pos === 1 ? 1 : 0) + won.length;
  r.trophies = trophies;
  r.isDouble = trophies === 2;
  r.isTreble = trophies === 3;
  r.isQuad   = trophies === 4;
}
// Headline honour word, or null.
function honourLabel(r){
  if (r.isQuad)   return 'THE GRAND SLAM';
  if (r.isTreble) return 'THE HAT-TRICK';
  if (r.isDouble) return 'THE DOUBLE';
  return null;
}

// Correspondent-style season summary. Every part draws from a pool, so two identical records still
// read differently. No em dashes. Needs r.position (set by populateBreakdown) before it is called.
function recapText(r){
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const key = r.isWoat ? 'WOAT' : r.W === 38 ? 'GOAT' : r.L === 0 ? 'INVINCIBLES' : r.pts >= 100 ? 'CENTURIONS'
            : r.pts < 11 ? 'DERBY' : bandTier(r.aS);
  const head = {
    WOAT: ["The tour nobody came to. Thirty-eight dates, thirty-eight empty fields: a flawless 0-for-38.",
           "Cancelled, basically. The lowest-drawing act available in every single slot, and not one ticket sold.",
           "0-for-38. A masterclass in how not to book a festival, and somehow weirdly iconic."],
    GOAT: ["Perfection. Thirty-eight shows, thirty-eight sell-outs, and a place in festival folklore.",
           "The impossible bill. Every date sold out and the tour went a flawless 38-0-0.",
           "Flawless from the first soundcheck to the last encore. A perfect, sold-out, all-conquering run."],
    INVINCIBLES: ["Not a single empty night all tour. The full 38 dates without a flop.",
                  "A sell-out tour. Nobody could half-fill a room across the whole run.",
                  "An unbeatable run: a couple of slow nights, but never a flop."],
    CENTURIONS: ["A headline act in every sense. Relentless, record-breaking, almost untouchable.",
                 "They smashed through the hype ceiling and ran away with the summer.",
                 "Triple-figure hype. A ruthless, festival-topping juggernaut."],
    CHAMPIONS: ["Headliners. They closed the main stage to a packed field.",
                "Top of the bill, and they earned it with room to spare.",
                "The headline slot was theirs after a commanding run."],
    'CHAMPIONS LEAGUE': ["A main-stage finish and a slot every promoter would fight for.",
                         "They booked the main stage with comfort.",
                         "Comfortably onto the main stage after a strong run."],
    EUROPA: ["A big-top finish. Solid, respectable, the right side of the bill.",
             "Second-stage billing, and a decent weekend's work.",
             "They sneaked onto the big top after a steady run."],
    'MID-TABLE': ["Mid-bill and meandering. On the poster, but in the small print.",
                  "A forgettable run in the middle of the line-up, neither up nor down.",
                  "Mid-bill filler. Comfortable, if utterly unremarkable."],
    RELEGATION: ["An open-mic scrap, with just getting on stage the only goal.",
                 "They spent the whole tour staring at half-empty rooms.",
                 "A grim, grinding fight to fill the smallest tent."],
    DERBY: ["Historically empty. A hype total to forget and a tour best buried.",
            "An empty field. A run of pure, record-setting tumbleweed.",
            "An all-time low. Out of their depth from the very first soundcheck."]
  }[key];
  const expD = finishDesc(r.expRank), actD = finishDesc(r.actRank);
  const verdict = pick({
    OVERPERFORMED: [`On paper this bill was rated only for ${expD}, so ${actD} is a genuine overachievement.`,
                    `Few would have backed them for more than ${expD}; ${actD} blew that forecast away.`,
                    `Tipped merely for ${expD}, they soared to ${actD}.`],
    UNDERPERFORMED: [`A line-up rated for ${expD} that could only manage ${actD}. An underachievement, plain and simple.`,
                     `They had the names for ${expD}, which makes ${actD} a chastening return.`,
                     `Rated for ${expD}, they fell away to ${actD}, and it will sting.`],
    'MET EXPECTATIONS': [`Rated for ${expD}, and that is precisely what they delivered. No fluke, no collapse.`,
                         `Tipped for ${expD}, and they saw it through, no more and no less.`,
                         `Par for this bill: ${expD}, and they delivered exactly that.`]
  }[r.verdict]);
  const ts = topScorer(r.rows, r), star = topPlayer(r.rows).pick.player;
  const numbers = pick([
    `Final tally: ${r.W} sell-outs, ${r.D} half-full, ${r.L} flops for ${r.pts} hype.`,
    `${r.pts} hype from a ${r.W}-${r.D}-${r.L} tour when the dust settled.`,
    `A ${r.W}-${r.D}-${r.L} tour and ${r.pts} hype all told.`
  ]);
  const rng = r.famCount >= 5 ? ' Five genres deep, the bill had real range.'
            : r.famCount <= 2 ? ' A one-note bill, and it showed.' : '';
  const stars = pick([
    `${star.n} (${star.o}) was the heartbeat of the bill, with ${ts.row.pick.player.n} pulling ${ts.goals}k to their set.`,
    `${star.n} (${star.o}) led the way, and ${ts.row.pick.player.n} drew the biggest crowd at ${ts.goals}k.`,
    `Act of the festival was ${star.n} (${star.o}); ${ts.row.pick.player.n} pulled the biggest crowd, ${ts.goals}k.`
  ]);
  return `${pick(head)} ${verdict} ${numbers}${rng} ${stars}`;
}

/* ============================================================
   Results
   ============================================================ */
// Build the end-of-game LINE-UP POSTER (the hero of the results screen).
function renderResultPoster(r){
  const byTier = {};
  r.rows.forEach(row => { (byTier[row.slot.tier] = byTier[row.slot.tier] || []).push(row); });
  const tier = tierFor(r);
  const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const hl = (byTier[1] || []).map(row =>
    `<div class="ph"><span class="ph-day">${esc(row.slot.label)}</span>` +
    `<span class="ph-act">${esc(row.pick.player.n)}</span></div>`).join('');
  const rowHtml = (t, cls) => {
    const acts = (byTier[t] || []).map(row => esc(row.pick.player.n));
    return acts.length ? `<div class="pr ${cls}">${acts.join('<span class="dot">/</span>')}</div>` : '';
  };
  const billing = (FORMATIONS[state.formation] || {}).name || '';
  return `
    <div class="poster-kicker">THE PERFECT FESTIVAL · EST. 2026</div>
    <div class="poster-sub-top">${esc(billing)} · 3 DAYS · 11 STAGES</div>
    <div class="poster-headliners">${hl}</div>
    <div class="poster-body">${rowHtml(2,'pr-a')}${rowHtml(3,'pr-b')}${rowHtml(4,'pr-c')}${rowHtml(5,'pr-d')}</div>
    <div class="poster-foot">
      <span class="poster-tier" style="background:${tier.color}">${tier.name}</span>
      <span class="poster-score">${r.S}<small>festival score</small></span>
      <span class="poster-sold">${r.W} / 38 sold out</span>
    </div>`;
}

function showResults(){
  const r = computeRecord();
  state.result = r;
  { const pm = $('resultPoster'); if (pm) pm.innerHTML = renderResultPoster(r); }
  $('recW').textContent = r.W;
  $('recD').textContent = r.D;
  $('recL').textContent = r.L;
  $('recPts').textContent = r.pts;

  const tier = tierFor(r);
  const tb = $('tierBadge');
  tb.textContent = tier.name;
  tb.style.background = tier.color;
  $('resultsQ').textContent = r.isWoat ? 'CANCELLED'
    : r.W === 38 ? 'THE PERFECT FESTIVAL'
    : 'YOUR LINE-UP';

  const xi = $('xiList');
  xi.innerHTML = '';
  r.rows.forEach(({ slot, pick }) => {
    const p = pick.player;
    const row = document.createElement('div');
    row.className = 'xirow';
    row.innerHTML =
      `<div class="xirow-pos">${slot.label}</div>` +
      `<div class="xirow-face">${jerseySVG(pick.team, initials(p.n), 34)}</div>` +
      `<div class="xirow-id">
         <div class="xirow-name">${p.n}</div>
         <div class="xirow-meta">${DATA.teams[pick.team].name} · ${pick.year} · ${(p.p||[]).join('/')}</div>
       </div>
       <div class="xirow-ov ${ovClass(p.o)}">${p.o}</div>`;
    xi.appendChild(row);
  });

  // Full-season breakdown (revealed by the "Show more" button)
  populateBreakdown(r);

  // Season recap: verdict (over / met / under) + correspondent summary + star player & top scorer.
  const rv = $('recapVerdict');
  rv.className = 'recap-verdict ' + (r.verdict === 'OVERPERFORMED' ? 'over' : r.verdict === 'UNDERPERFORMED' ? 'under' : 'met');
  rv.textContent = r.verdict;
  $('recapText').textContent = recapText(r);
  const star = topPlayer(r.rows).pick, ts = topScorer(r.rows, r);
  $('recapStar').textContent = `${star.player.n} · ${star.player.o}`;
  $('recapScorer').textContent = `${ts.row.pick.player.n} · ${ts.goals}k crowd`;

  // Expert-only post-game scorecard: how your blind picks compared to the best available, plus the
  // best XI buildable from your draws. Hidden in Classic and if the module failed to load.
  const da = $('draftAnalysis');
  if (da) { if (state.expert && window.DraftAnalysis) DraftAnalysis.render(da, r.rows, DATA); else da.classList.add('hidden'); }

  $('breakdown').classList.add('hidden');
  $('showMoreBtn').classList.remove('hidden');
  $('showMoreBtn').textContent = 'Show full tour breakdown ▾';

  // The quadruple is the rarest result — celebrate it up top, not hidden behind "Show more".
  $('quadBanner').classList.toggle('hidden', !r.isQuad);

  $('gameScreen').classList.add('hidden');
  $('resultsScreen').classList.remove('hidden');
  window.scrollTo(0, 0);
  updateIapUI();
  showResultsBanner();

  track('xi_completed', {
    rating: r.S, wins: r.W, draws: r.D, losses: r.L, points: r.pts, badge: tier.name,
  });
  gamesFinished++;
  if (r.W === 38){ track('goat', { rating: r.S }); launchConfetti(); if (window.NativeAds) NativeAds.haptic('HEAVY'); }
  if (r.isWoat){ track('woat', { rating: r.S }); if (window.NativeAds) NativeAds.haptic('LIGHT'); }
  if (r.isQuad){ track('quadruple', { rating: r.S }); if (r.W !== 38) launchConfetti(); if (window.NativeAds) NativeAds.haptic('HEAVY'); }
  else if (r.isTreble){ track('treble', { rating: r.S }); }
  maybeAskForReview();
}

// After the player's FIRST completed game, ask iOS to show the native App Store rating
// prompt. Fires once ever (localStorage guard); app-only; iOS still decides whether to show.
function maybeAskForReview(){
  if (!(window.NativeAds && NativeAds.isNative)) return;   // native app only — no-op on web
  try { if (localStorage.getItem('rated_prompted')) return; } catch (e) {}
  try { localStorage.setItem('rated_prompted', '1'); } catch (e) {}
  track('review_prompted', {});
  // Small delay so the prompt appears after the results screen has settled.
  setTimeout(function(){ try { NativeAds.requestReview(); } catch (e) {} }, 1500);
}

/* ---------- confetti (GOAT only) ---------- */
function launchConfetti(){
  const c = document.createElement('canvas');
  c.className = 'confetti-canvas';
  c.width = window.innerWidth; c.height = window.innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const colors = ['#ffd24a','#ff2d78','#7c3aed','#2ee06a','#4f9dff','#ffffff'];
  const N = 220;
  const parts = Array.from({length:N}, () => ({
    x: Math.random()*c.width,
    y: -20 - Math.random()*c.height*0.5,
    w: 6 + Math.random()*8, h: 8 + Math.random()*10,
    vx: -2 + Math.random()*4, vy: 2 + Math.random()*4,
    rot: Math.random()*Math.PI, vr: -0.2 + Math.random()*0.4,
    col: colors[Math.floor(Math.random()*colors.length)],
  }));
  const start = performance.now();
  (function frame(now){
    const t = now - start;
    ctx.clearRect(0,0,c.width,c.height);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = t > 3500 ? Math.max(0, 1 - (t-3500)/1500) : 1;
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    if (t < 5000) requestAnimationFrame(frame);
    else c.remove();
  })(start);
}

/* ============================================================
   Share card (canvas) + Web Share
   ============================================================ */
// Lay out coloured text segments left-to-right, centred on cx. segs: [{t,c}].
function drawSegments(ctx, segs, cx, cy, font){
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let total = 0;
  segs.forEach(s => { s.w = ctx.measureText(s.t).width; total += s.w; });
  let x = cx - total/2;
  segs.forEach(s => { ctx.fillStyle = s.c; ctx.fillText(s.t, x, cy); x += s.w; });
}
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y,   x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x,   y+h, r);
  ctx.arcTo(x,   y+h, x,   y,   r);
  ctx.arcTo(x,   y,   x+w, y,   r);
  ctx.closePath();
}
function drawJerseyCanvas(ctx, cx, cy, w, code, ini, ov, name){
  const [bg, ink] = colorsFor(code);
  ctx.save();
  // vinyl / festival-pass badge
  ctx.beginPath(); ctx.arc(cx, cy, w/2, 0, Math.PI*2);
  ctx.fillStyle = bg; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, w*0.34, 0, Math.PI*2);
  ctx.lineWidth = 1.6; ctx.strokeStyle = ink; ctx.globalAlpha = .55; ctx.stroke(); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(cx, cy, w*0.10, 0, Math.PI*2);
  ctx.fillStyle = ink; ctx.globalAlpha = .25; ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = ink; ctx.font = '900 ' + Math.round(w*0.26) + 'px Inter, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ini, cx, cy + 1);
  ctx.restore();
  // OVR badge
  ctx.beginPath();
  ctx.arc(cx + w*0.34, cy - w*0.34, w*0.18, 0, Math.PI*2);
  ctx.fillStyle = '#ffd24a'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#0a0a12'; ctx.stroke();
  ctx.fillStyle = '#1a1a1a'; ctx.font = `900 ${Math.round(w*0.2)}px Inter, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ov, cx + w*0.34, cy - w*0.33);
  // name
  ctx.fillStyle = '#fff'; ctx.font = '700 20px Inter, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 4;
  ctx.fillText(name.length > 16 ? name.slice(0,15)+'…' : name, cx, cy + w*0.55);
  ctx.shadowBlur = 0;
}
// Draw a stylised trophy (not an exact replica) on the canvas. kind: 'league' | 'fa' | 'ucl'.
// won → solid gold; not won → hollow outline only.
function drawTrophy(ctx, cx, cy, h, won, kind){
  const w = h * 0.60;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2.5, h * 0.045);
  const g = ctx.createLinearGradient(cx, cy - h/2, cx, cy + h/2);
  g.addColorStop(0, '#ffe9a8'); g.addColorStop(.45, '#ffd24a'); g.addColorStop(1, '#d99a1c');
  ctx.fillStyle  = won ? g : 'rgba(255,255,255,0.015)';
  ctx.strokeStyle = won ? '#8a5d12' : 'rgba(150,156,184,.65)';

  const topY = cy - h * 0.5;
  const bowlTop = topY + (kind === 'fa' ? h * 0.30 : h * 0.18);
  const bowlBot = cy + h * 0.06;
  const bowlHalf = w * 0.42;

  // handles
  if (kind === 'ucl'){                       // big ears
    ctx.lineWidth = Math.max(3.5, h * 0.07);
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(cx + s * bowlHalf * 0.9, bowlTop + (bowlBot - bowlTop) * 0.05);
      ctx.bezierCurveTo(cx + s * (bowlHalf + w * 0.5), bowlTop - (bowlBot - bowlTop) * 0.2,
                        cx + s * (bowlHalf + w * 0.5), bowlBot + (bowlBot - bowlTop) * 0.1,
                        cx + s * bowlHalf * 0.78, bowlBot - (bowlBot - bowlTop) * 0.12);
      ctx.stroke();
    });
    ctx.lineWidth = Math.max(2.5, h * 0.045);
  } else {                                   // small loop handles
    const eh = (bowlBot - bowlTop) * 0.62;
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(cx + s * bowlHalf * 0.96, bowlTop + eh * 0.12);
      ctx.bezierCurveTo(cx + s * (bowlHalf + w * 0.26), bowlTop,
                        cx + s * (bowlHalf + w * 0.26), bowlTop + eh,
                        cx + s * bowlHalf * 0.9, bowlTop + eh);
      ctx.stroke();
    });
  }

  // bowl
  ctx.beginPath();
  ctx.moveTo(cx - bowlHalf, bowlTop);
  ctx.lineTo(cx + bowlHalf, bowlTop);
  ctx.lineTo(cx + bowlHalf * 0.60, bowlBot);
  ctx.quadraticCurveTo(cx, bowlBot + h * 0.07, cx - bowlHalf * 0.60, bowlBot);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // lid + finial (FA cup only)
  if (kind === 'fa'){
    ctx.beginPath();
    ctx.moveTo(cx - bowlHalf * 0.72, bowlTop);
    ctx.quadraticCurveTo(cx, topY + h * 0.02, cx + bowlHalf * 0.72, bowlTop);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, topY + h * 0.04, h * 0.045, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // stem
  const stemTop = bowlBot + h * 0.03, stemBot = cy + h * 0.32;
  ctx.beginPath();
  ctx.rect(cx - w * 0.07, stemTop, w * 0.14, stemBot - stemTop);
  ctx.fill(); ctx.stroke();

  // base
  ctx.beginPath(); roundRect(ctx, cx - w * 0.30, stemBot, w * 0.60, h * 0.13, 4);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function buildShareCanvas(){
  const r = state.result;
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // background
  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,'#140a22'); g.addColorStop(.5,'#0a0a12'); g.addColorStop(1,'#0a1322');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // title  "THE PERFECT FESTIVAL"
  const tg = ctx.createLinearGradient(W/2-260,0,W/2+260,0);
  tg.addColorStop(0,'#ff2d78'); tg.addColorStop(1,'#13d4c4');
  drawSegments(ctx, [
    { t:'THE PERFECT ', c:tg },
    { t:'FESTIVAL', c:'#ffd24a' },
  ], W/2, 88, '900 58px Inter, sans-serif');

  // record  "35 - 2 - 1"
  const y0 = 250;
  drawSegments(ctx, [
    { t:String(r.W), c:'#2ee06a' },
    { t:'  -  ', c:'#3a3a55' },
    { t:String(r.D), c:'#8a8aa3' },
    { t:'  -  ', c:'#3a3a55' },
    { t:String(r.L), c:'#ff5470' },
  ], W/2, y0, '900 120px Inter, sans-serif');

  ctx.textAlign='center'; ctx.fillStyle='#8a8aa3'; ctx.font='700 26px Inter, sans-serif';
  ctx.textBaseline='middle';
  ctx.fillText(`sold out · half-full · flopped  ·  38-show tour · ${r.pts} hype`, W/2, y0+92);

  // tier badge
  const tier = tierFor(r);
  ctx.font='900 30px Inter, sans-serif';
  const tw = ctx.measureText(tier.name).width + 56;
  const bx = W/2 - tw/2, by = y0+135;
  const bg2 = ctx.createLinearGradient(bx,0,bx+tw,0);
  bg2.addColorStop(0,'#ffd24a'); bg2.addColorStop(1,'#ff9d3d');
  ctx.fillStyle = bg2; roundRect(ctx,bx,by,tw,54,27); ctx.fill();
  ctx.fillStyle='#1a1200'; ctx.textBaseline='middle';
  ctx.fillText(tier.name, W/2, by+28);

  // honours banner (double / treble / quadruple), shown only when earned
  const honour = honourLabel(r);
  if (honour){
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font='900 40px Inter, sans-serif';
    const hg = ctx.createLinearGradient(W/2-160,0,W/2+160,0);
    hg.addColorStop(0,'#ffd24a'); hg.addColorStop(1,'#ff9d3d');
    ctx.fillStyle = hg;
    ctx.fillText('🏆 ' + honour + ' 🏆', W/2, by+90);
  }
  // cups record — three trophy boxes side by side (solid trophy if won, hollow if not)
  const cups = r.cups || cupResults(r.S);
  const kinds = ['league','fa','ucl'];
  const boxW = 290, boxH = 150, gap = 24;
  const totalW = boxW*3 + gap*2;
  const boxTop = by + (honour ? 116 : 74);
  let bxx = W/2 - totalW/2;
  cups.forEach((c, i) => {
    ctx.fillStyle   = c.won ? 'rgba(255,210,74,.10)' : 'rgba(255,255,255,.025)';
    ctx.strokeStyle = c.won ? 'rgba(255,210,74,.55)' : 'rgba(120,126,160,.32)';
    ctx.lineWidth = 2;
    ctx.beginPath(); roundRect(ctx, bxx, boxTop, boxW, boxH, 18); ctx.fill(); ctx.stroke();
    drawTrophy(ctx, bxx + boxW/2, boxTop + boxH*0.42, boxH*0.58, c.won, kinds[i]);
    ctx.fillStyle = c.won ? '#ffd24a' : '#8a8aa3';
    ctx.font = '800 22px Inter, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(c.name, bxx + boxW/2, boxTop + boxH - 24);
    bxx += boxW + gap;
  });

  // line-up poster panel (replaces the football pitch)
  const px=170, py=boxTop + boxH + 26, pw=740, ph=H - (boxTop + boxH + 26) - 70;
  const pg = ctx.createLinearGradient(px, py, px, py+ph);
  pg.addColorStop(0,'#1a1030'); pg.addColorStop(.5,'#0c0c18'); pg.addColorStop(1,'#0a0a12');
  ctx.fillStyle = pg; roundRect(ctx,px,py,pw,ph,22); ctx.fill();
  // stage-light beams
  ctx.save(); roundRect(ctx,px,py,pw,ph,22); ctx.clip();
  const beam = ctx.createLinearGradient(px+pw*0.5, py, px, py+ph*0.7);
  beam.addColorStop(0,'rgba(255,45,120,.20)'); beam.addColorStop(1,'transparent');
  ctx.fillStyle=beam; ctx.beginPath(); ctx.moveTo(px+pw*0.5,py); ctx.lineTo(px+pw*0.02,py+ph*0.8); ctx.lineTo(px+pw*0.30,py+ph*0.8); ctx.closePath(); ctx.fill();
  const beam2 = ctx.createLinearGradient(px+pw*0.5, py, px+pw, py+ph*0.7);
  beam2.addColorStop(0,'rgba(19,212,196,.18)'); beam2.addColorStop(1,'transparent');
  ctx.fillStyle=beam2; ctx.beginPath(); ctx.moveTo(px+pw*0.5,py); ctx.lineTo(px+pw*0.98,py+ph*0.8); ctx.lineTo(px+pw*0.70,py+ph*0.8); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle='rgba(255,255,255,.14)'; ctx.lineWidth=2;
  roundRect(ctx,px+1,py+1,pw-2,ph-2,21); ctx.stroke();
  ctx.textAlign='center';
  ctx.fillStyle='rgba(255,255,255,.4)'; ctx.font='400 26px "Bebas Neue", Inter, sans-serif';
  ctx.textBaseline='top'; ctx.fillText('L I N E · U P', px+pw/2, py+18);

  // group rows by stage tier and draw a real text poster (headliners big, undercard descending)
  const byTier = {};
  r.rows.forEach(row => { (byTier[row.slot.tier] = byTier[row.slot.tier] || []).push(row); });
  const cx = px + pw/2;
  let y = py + 64;
  (byTier[1] || []).forEach(row => {
    ctx.fillStyle = '#13d4c4'; ctx.font = '400 20px "Bebas Neue", Inter, sans-serif';
    ctx.fillText(row.slot.label.toUpperCase(), cx, y); y += 26;
    ctx.fillStyle = '#ffffff'; ctx.font = '400 58px "Bebas Neue", Inter, sans-serif';
    ctx.fillText(row.pick.player.n, cx, y); y += 64;
  });
  y += 6;
  const drawRow = (t, size, col) => {
    const acts = (byTier[t] || []).map(rw => rw.pick.player.n);
    if (!acts.length) return;
    ctx.fillStyle = col; ctx.font = `400 ${size}px "Bebas Neue", Inter, sans-serif`;
    ctx.fillText(acts.join('   /   '), cx, y); y += size + 14;
  };
  drawRow(2, 34, '#f3f0fb'); drawRow(3, 29, '#d9d4ea'); drawRow(4, 25, '#c2bcd6'); drawRow(5, 22, '#a59fbd');

  // footer
  ctx.fillStyle='#8a8aa3'; ctx.font='800 30px Inter, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
  ctx.fillText('book yours · THE PERFECT FESTIVAL', W/2, H-34);
  return c;
}

// Headline blurb (no URL), leading with the rarest thing the player achieved.
function resultBlurb(){
  const r = state.result;
  const tier = tierFor(r).name;
  if (r.isWoat)   return `My festival got CANCELLED: a 0-for-38 tour with the lowest-drawing act in every slot. 🎪 Can you out-flop me?`;
  if (r.isQuad)   return `THE GRAND SLAM: top billing plus all three extras (about 1 in 1,000). 🏆 Beat that line-up.`;
  if (r.W === 38) return `I booked THE PERFECT FESTIVAL: every one of 38 shows sold out, a flawless tour. 🎤 Bet you can't match the bill.`;
  if (r.isTreble) return `THE HAT-TRICK: top billing plus two extras. 🏆 Think your line-up can?`;
  if (r.isDouble) return `THE DOUBLE: top billing plus an extra. Think you can beat my line-up?`;
  return `I booked a ${tier} festival line-up — ${r.W}/38 shows sold out (score ${r.S}). Think you can beat it?`;
}
function shareText(){
  // Shares FROM THE APP point friends to the App Store (drive installs); shares from the
  // website keep the website link. (Native = running inside Capacitor.)
  const link = 'https://theperfectfestival.example';   // TODO: your live URL
  return `${resultBlurb()} 👉 ${link} #PerfectFestival`;
}

async function shareResult(){
  const r = state.result;
  track('share_clicked', r ? { badge: tierFor(r).name, wins: r.W, draws: r.D, losses: r.L, rating: r.S } : {});
  const canvas = buildShareCanvas();
  const text = shareText();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  const file = new File([blob], 'perfect-festival.png', { type: 'image/png' });

  // Title = the player's ACTUAL record (e.g. "35-2-1"), not the literal "38-0-0" brand,
  // so the share headline reflects what they really got.
  const recordTitle = `${r.W}-${r.D}-${r.L}`;
  // Native share sheet (X, IG, iMessage, WhatsApp…) — mobile + supported desktops.
  if (navigator.canShare && navigator.canShare({ files: [file] })){
    try {
      await navigator.share({ files: [file], text, title: recordTitle });
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  // Fallback: download the image, copy text, open share menu.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'perfect-festival.png';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
  try { await navigator.clipboard.writeText(text); } catch(e){}
  openShareMenu(text);
  toast('Image downloaded · caption copied');
}

function openShareMenu(text){
  const enc = encodeURIComponent(text);
  const existing = document.getElementById('shareMenu');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'shareMenu';
  menu.className = 'share-menu';
  menu.innerHTML = `
    <div class="share-menu-inner">
      <div class="share-menu-title">Share your line-up</div>
      <p class="share-menu-note">Your poster image was downloaded — attach it on any platform. Caption is copied to your clipboard.</p>
      <div class="share-menu-links">
        <a target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${enc}">Post on X</a>
        <a target="_blank" rel="noopener" href="https://wa.me/?text=${enc}">WhatsApp</a>
        <a target="_blank" rel="noopener" href="https://t.me/share/url?url=${enc}">Telegram</a>
        <a href="sms:&body=${enc}">iMessage / SMS</a>
        <a target="_blank" rel="noopener" href="https://www.instagram.com/">Instagram</a>
      </div>
      <button class="share-menu-close" id="shareMenuClose">Close</button>
    </div>`;
  document.body.appendChild(menu);
  menu.addEventListener('click', (e)=>{ if (e.target === menu) menu.remove(); });
  $('shareMenuClose').addEventListener('click', ()=>menu.remove());
}

/* ============================================================
   Consent — Google's certified CMP (Privacy & messaging, TCF v2) is the single consent
   layer. It governs ad personalisation automatically. Here we only mirror it to PostHog:
   opt analytics in outside the EEA/UK, or inside once the user grants storage consent.
   If the CMP isn't present or consent isn't given, PostHog stays opt-out-by-default (off).
   ============================================================ */
function initConsent(){
  function setPH(on){
    try { if (window.posthog && posthog.opt_in_capturing){ on ? posthog.opt_in_capturing() : posthog.opt_out_capturing(); } } catch (e) {}
  }
  if (window.__tcfapi){
    window.__tcfapi('addEventListener', 2, function(d, ok){
      if (!ok || !d) return;
      if (d.gdprApplies === false){ setPH(true); return; }       // outside EEA/UK: no consent needed
      if (d.eventStatus === 'tcloaded' || d.eventStatus === 'useractioncomplete'){
        const p = d.purpose && d.purpose.consents;
        setPH(!!(p && p[1]));                                     // Purpose 1 = store/access on device
      }
    });
  }
}

/* ============================================================
   Boot
   ============================================================ */
async function boot(){
  try{
    DATA = await fetch('data.json?v=16').then(r => r.json());
  }catch(e){
    document.body.innerHTML = '<p style="padding:40px;color:#fff">Could not load data.json — serve this folder over HTTP (e.g. <code>python3 -m http.server</code>).</p>';
    return;
  }
  $('spinBtn').addEventListener('click', () => spin(false));
  $('respinBtn').addEventListener('click', rewardedRespin);
  $('resetBtn').addEventListener('click', () => { if (confirm('Start a new XI?')) showSetup(); });

  // Setup screen: a single Start button (mode = classic, one billing — no extra choices).
  $('setupStart').addEventListener('click', () => startGame('classic', 'main'));

  // After the first completed game, prompt a socials follow (once).
  $('againBtn').addEventListener('click', () => {
    track('build_another');
    showSetup();
    // Interstitial on replay for non-paying users: native uses AdMob, web uses H5 Games Ads.
    const paid = window.IAP && IAP.hasNoAds();
    if (!paid){
      if (window.NativeAds && NativeAds.available() && gamesFinished % 2 === 0){
        NativeAds.showInterstitial();                              // app: AdMob interstitial
      } else if (typeof window.adBreak === 'function'){
        window.adBreak({ type: 'next', name: 'build-another' });   // web: H5 interstitial (web-only; Google handles fill + frequency)
      }
    }
  });
  $('shareBtn').addEventListener('click', shareResult);
  $('showMoreBtn').addEventListener('click', () => {
    const open = !$('breakdown').classList.toggle('hidden');
    $('showMoreBtn').textContent = open ? 'Hide breakdown ▴' : 'Show full tour breakdown ▾';
    if (open){
      track('breakdown_opened', { rating: state.result && state.result.S });
      $('breakdown').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  $('draftSearch').addEventListener('input', (e) => renderPlayerList(e.target.value));

  // In-app purchase: Remove Ads
  $('removeAdsBtn').addEventListener('click', () => {
    const btn = $('removeAdsBtn'); btn.disabled = true; btn.textContent = 'Processing…';
    IAP.purchase((ok, msg) => {
      btn.disabled = false;
      if (ok){ track('iap_purchase', { product: 'remove_ads' }); toast('Ads removed — enjoy! 🎉'); }
      else { toast(msg || 'Purchase cancelled'); }
      updateIapUI();
    });
  });
  $('restoreBtn').addEventListener('click', () => {
    IAP.restore(ok => { toast(ok ? 'Purchase restored ✓' : 'No purchase found to restore'); updateIapUI(); });
  });
  const footerRestore = $('footerRestore');
  if (footerRestore) footerRestore.addEventListener('click', (e) => {
    e.preventDefault();
    toast('Restoring…');
    IAP.restore(ok => { toast(ok ? 'Purchase restored ✓ — ads removed' : 'No purchase found to restore'); updateIapUI(); });
  });
  window.onNoAdsChanged = () => { updateIapUI(); if (state && state.current) refreshRespinBtn(); };

  // Saved builds (native app only) — capture the finished Premier League XI.
  SavedBuilds.init({
    mode: 'FEST', modeLabel: 'Festival',
    capture: function () {
      if (!state || !state.result) return null;
      const r = state.result;
      const fin = finishDesc(r.actRank);   // 'the title', '3rd place', 'an unbeaten season', 'a perfect 38-0-0'
      const rec = r.W + 'W ' + r.D + 'D ' + r.L + 'L';
      let summary;
      if (fin === 'a perfect sold-out tour') summary = 'Perfect 38-0-0 festival';
      else if (fin === 'a sell-out tour') summary = 'Sell-out tour · ' + rec;
      else if (fin === 'a headline run') summary = 'Headline act · ' + rec;
      else if (fin === 'top billing') summary = 'Top billing · ' + rec;
      else summary = 'Finished ' + fin + ' · ' + rec;
      try { const h = (typeof honourLabel === 'function') ? honourLabel(r) : null; if (h) summary += ' · ' + h.toLowerCase(); } catch (e) {}
      let star = '', scorer = '';
      try { const tp = topPlayer(r.rows).pick; star = tp.player.n + ' · ' + tp.player.o; } catch (e) {}
      try { const ts = topScorer(r.rows, r); scorer = ts.row.pick.player.n + ' · ' + ts.goals + ' goals'; } catch (e) {}
      return {
        difficulty: state.expert ? 'Expert' : 'Classic',
        formation: state.formation || ($('formationTag') ? $('formationTag').textContent : '') || '',
        verdict: r.verdict,
        summary: summary,
        star: star,
        scorer: scorer,
        xi: r.rows.map(function (row) { const p = row.pick.player; return { pos: row.slot.label, name: p.n, ovr: p.o, club: (DATA.teams[row.pick.team] || {}).name || row.pick.team, year: row.pick.year }; })
      };
    }
  });

  updateIapUI();                 // evaluate the footer Restore link (and results IAP row) on load
  initConsent();
  showSetup();
}
boot();
