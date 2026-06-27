'use strict';
/* ============================================================
   Native (iOS / Android) bridge — AdMob ads + haptics.
   100% no-op on the web build (window.Capacitor is undefined there),
   so the same app/ folder ships to Cloudflare AND inside the app.
   ============================================================ */
(function () {
  const Cap = window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const AdMob = (isNative && Cap.Plugins) ? Cap.Plugins.AdMob : null;
  const Haptics = (isNative && Cap.Plugins) ? Cap.Plugins.Haptics : null;
  const InAppReview = (isNative && Cap.Plugins) ? Cap.Plugins.InAppReview : null;
  const SocialLogin = (isNative && Cap.Plugins) ? Cap.Plugins.SocialLogin : null;

  /* ===== Ad unit IDs (per platform) ==========================================
     iOS ids are live. Android ids are placeholders — after you create the Android
     app + ad units in AdMob (Phase 2), paste them into the `android` block below.
     The Android AdMob *App ID* goes in AndroidManifest.xml, not here (see Phase 2). */
  const TEST = false;
  const platform = (Cap && Cap.getPlatform) ? Cap.getPlatform() : 'web';
  const AD_UNITS = {
    ios: {
      rewarded:     'ca-app-pub-5828601537093994/8482451249', // "Re-spin" rewarded
      interstitial: 'ca-app-pub-5828601537093994/7715174803', // "Between games" interstitial
    },
    android: {
      rewarded:     'ca-app-pub-5828601537093994/7862857341', // "Android Re-spin rewarded"
      interstitial: 'ca-app-pub-5828601537093994/4551062636', // "Android Between games" interstitial
    },
  };
  const _units = AD_UNITS[platform] || AD_UNITS.ios;
  const REWARDED_ID     = _units.rewarded;
  const INTERSTITIAL_ID = _units.interstitial;
  /* ========================================================================== */

  // Exact event strings from @capacitor-community/admob v8
  const REWARD_GRANTED   = 'onRewardedVideoAdReward';
  const REWARD_DISMISSED = 'onRewardedVideoAdDismissed';
  const REWARD_FAILSHOW  = 'onRewardedVideoAdFailedToShow';

  async function init() {
    if (!AdMob) return;
    try {
      await AdMob.initialize({ requestTrackingAuthorization: true, initializeForTesting: TEST });
      // GDPR / UMP consent (EEA & UK)
      try {
        const info = await AdMob.requestConsentInfo();
        if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') {
          await AdMob.showConsentForm();
        }
      } catch (e) {}
      // iOS App Tracking Transparency prompt
      try { await AdMob.requestTrackingAuthorization(); } catch (e) {}
      preloadRewarded();
      preloadInterstitial();
    } catch (e) { /* ads failed to init, game keeps working */ }
  }

  function preloadRewarded() {
    if (AdMob) AdMob.prepareRewardVideoAd({ adId: REWARDED_ID, isTesting: TEST }).catch(function () {});
  }
  function preloadInterstitial() {
    if (AdMob) AdMob.prepareInterstitial({ adId: INTERSTITIAL_ID, isTesting: TEST }).catch(function () {});
  }

  // Show a rewarded video; onReward() only fires when the user earns it.
  function showRewarded(onReward, onSkip) {
    if (!AdMob) { if (onReward) onReward(); return; }
    let settled = false;
    const handles = [];
    const cleanup = () => handles.forEach(h => { try { Promise.resolve(h).then(x => x && x.remove && x.remove()); } catch (e) {} });
    const grant = () => { if (!settled) { settled = true; cleanup(); preloadRewarded(); if (onReward) onReward(); } };
    const skip  = () => { if (!settled) { settled = true; cleanup(); preloadRewarded(); if (onSkip) onSkip(); } };
    const on = (ev, fn) => handles.push(AdMob.addListener(ev, fn));

    on(REWARD_GRANTED, grant);
    on(REWARD_DISMISSED, () => { if (!settled) skip(); }); // closed before earning → no re-spin
    on(REWARD_FAILSHOW, grant);                            // couldn't show → don't punish player
    AdMob.showRewardVideoAd().catch(grant);                // not preloaded → grant rather than block
    setTimeout(() => { if (!settled) grant(); }, 30000);   // safety net
  }

  // Full-screen ad between games. Shows the PRELOADED ad immediately so it can never finish loading
  // late and pop up over the next match's draft (which would eat into the live server clock). If one
  // is not ready yet, it is skipped this round and a fresh one is preloaded for next time.
  function showInterstitial() {
    if (!AdMob) return Promise.resolve();
    return AdMob.showInterstitial()
      .then(function () { preloadInterstitial(); })
      .catch(function () { preloadInterstitial(); });
  }

  // Haptic feedback — respects the user's "Vibration" setting (380_haptics='0' disables it).
  function hapticsOn() { try { return localStorage.getItem('380_haptics') !== '0'; } catch (e) { return true; } }
  function setHaptics(on) { try { localStorage.setItem('380_haptics', on ? '1' : '0'); } catch (e) {} }
  function haptic(style) {
    if (!hapticsOn()) return;
    if (Haptics) { try { Haptics.impact({ style: style || 'LIGHT' }); } catch (e) {} }
  }
  // Native-only "Vibration: On/Off" toggle, injected into the site footer beside the other links.
  function injectHapticToggle() {
    if (document.getElementById('hapticToggleWrap')) return;
    var footer = document.querySelector('.site-footer');
    if (!footer) return;
    var wrap = document.createElement('span'); wrap.id = 'hapticToggleWrap';
    var a = document.createElement('a'); a.href = '#'; a.id = 'hapticToggle';
    var relabel = function () { a.textContent = 'Vibration: ' + (hapticsOn() ? 'On' : 'Off'); };
    relabel();
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var next = !hapticsOn(); setHaptics(next); relabel();
      if (next && Haptics) { try { Haptics.impact({ style: 'LIGHT' }); } catch (e2) {} }   // confirming tap when turning back on
    });
    wrap.appendChild(document.createTextNode(' · '));
    wrap.appendChild(a);
    var disc = footer.querySelector('.footer-disclaimer');
    if (disc) footer.insertBefore(wrap, disc); else footer.appendChild(wrap);
  }

  // Apple's native StoreKit rating prompt (SKStoreReviewController). We *request* it;
  // iOS decides whether to actually show it (throttled to ~3x/year per user). No-op on web.
  function requestReview() {
    if (InAppReview && InAppReview.requestReview) {
      try { return Promise.resolve(InAppReview.requestReview()).catch(function () {}); } catch (e) {}
    }
    return Promise.resolve();
  }

  window.NativeAds = {
    isNative,
    available: () => !!AdMob,
    showRewarded,
    showInterstitial,
    haptic,
    hapticsOn,
    setHaptics,
    requestReview,
  };

  /* ---- Native sign-in bridge (Google + Apple via @capgo/capacitor-social-login) ----
     Same web/native split as the ad bridge: window.NativeAuth.available() is false on the web
     build (no plugin), so pvp.js falls back to Google Identity Services + Sign in with Apple JS.
     On device this drives the native account sheets and returns the provider ID token (JWT),
     which the go380-pvp worker verifies against the configured client IDs. */
  const AUTH = {
    googleWebClientId: '959243954013-kt2f9bnr2s8nbf083dfo2tapdh277ghg.apps.googleusercontent.com',
    googleiOSClientId: '959243954013-b0q2tac6k03ea3is6kejha0l9hjummsl.apps.googleusercontent.com',
    appleServicesId:   'com.sancarmedia.go380.web',   // Apple on Android/web; iOS native uses the app bundle id automatically
    appleRedirectUrl:  'https://38-0-0.com/apple-callback.html',   // REQUIRED by the plugin for Apple on Android. Missing it made initialize() throw, which broke Google sign-in too.
  };
  let _socialReady = false;
  async function initSocial() {
    if (!SocialLogin || _socialReady) return;
    try {
      await SocialLogin.initialize({
        google: { webClientId: AUTH.googleWebClientId, iOSClientId: AUTH.googleiOSClientId, mode: 'online' },
        apple: { clientId: AUTH.appleServicesId, redirectUrl: AUTH.appleRedirectUrl },
      });
      _socialReady = true;
    } catch (e) {
      // Don't swallow: a failed initialize is a common cause of "sign-in does nothing".
      console.error('[native] SocialLogin.initialize failed:', e);
      throw new Error('init failed: ' + ((e && (e.message || e.code)) || String(e)));
    }
  }
  async function nativeAuthSignIn(provider) {
    if (!SocialLogin) throw new Error('sign-in unavailable');
    try {
      await initSocial();
      // Google: request NO extra scopes. The basic Credential Manager sign-in already returns an
      // idToken with the user's sub/email/name (all the worker needs). Passing Google scopes triggers
      // @capgo's "cannot use scopes without modifying the main activity" error on Android.
      const options = provider === 'apple' ? { scopes: ['name', 'email'] } : {};
      const r = await SocialLogin.login({ provider: provider, options: options });
      const res = (r && r.result) || {};
      const p = res.profile || {};
      const name = provider === 'google' ? (p.name || '') : [p.givenName, p.familyName].filter(Boolean).join(' ');
      if (!res.idToken) {
        console.error('[native] ' + provider + ' login returned no idToken; raw result =', r);
        throw new Error('no idToken returned from ' + provider);
      }
      return { idToken: res.idToken, name: name };
    } catch (e) {
      // Surface the real provider error (code + message) so the UI shows exactly why it failed.
      console.error('[native] ' + provider + ' sign-in failed:', e);
      const detail = (e && e.code ? e.code + ': ' : '') + ((e && (e.message || e.errorMessage)) || String(e));
      throw new Error(detail);
    }
  }
  async function nativeAuthSignOut() {
    if (!SocialLogin) return;
    // Clear the cached Google/Apple credential so the next sign-in shows the account chooser again
    // (otherwise Credential Manager silently reuses the last-used account).
    for (const p of ['google', 'apple']) { try { await SocialLogin.logout({ provider: p }); } catch (e) {} }
  }
  window.NativeAuth = {
    available: () => !!SocialLogin,
    signIn: nativeAuthSignIn,
    signOut: nativeAuthSignOut,
  };

  /* ---- Cloudflare Analytics Engine beacon (shared by EPL + Nations Cup pages) ----
     Stateless + anonymous: sends only {event, platform}, no id, no PII, no cookies — like
     Cloudflare Web Analytics, so it works on web AND native and needs no consent gate. */
  const CE_ENDPOINT = 'https://go380-events.38-0-0.workers.dev/e';
  // Only the two events the dashboards actually use — keeps Worker request volume low at scale.
  // Everything else (spin, goat, share, etc.) still goes to PostHog via track(), just not here.
  const CE_ALLOWED = { open: 1, xi_completed: 1 };
  function ceBeacon(event) {
    if (!CE_ALLOWED[event]) return;
    try {
      const body = JSON.stringify({ event: event, platform: isNative ? 'native' : 'web' });
      if (navigator.sendBeacon) navigator.sendBeacon(CE_ENDPOINT, body);   // text/plain → no CORS preflight
      else fetch(CE_ENDPOINT, { method: 'POST', keepalive: true, mode: 'no-cors', body: body }).catch(function () {});
    } catch (e) {}
  }
  window.ceBeacon = ceBeacon;
  // One "open" (session) per tab/app session — deduped with a benign session flag.
  try {
    if (!sessionStorage.getItem('ce_open')) { sessionStorage.setItem('ce_open', '1'); ceBeacon('open'); }
  } catch (e) { ceBeacon('open'); }

  if (isNative) {
    var onReady = function () { init(); injectHapticToggle(); initSocial(); };
    if (document.readyState !== 'loading') onReady();
    else document.addEventListener('DOMContentLoaded', onReady);
  }
})();
