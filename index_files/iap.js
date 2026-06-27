'use strict';
/* ============================================================
   In-App Purchase — "Remove Ads" (non-consumable).
   Uses cordova-plugin-purchase's global `CdvPurchase`. No-op on the web build.
   ============================================================ */
(function () {
  const Cap = window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

  // Must match the product id you create in App Store Connect.
  const PRODUCT_ID = 'com.sancarmedia.go380.removeads';
  const KEY = '380_noads';

  let owned = (() => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } })();
  function persist(v) {
    owned = v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {}
    if (typeof window.onNoAdsChanged === 'function') window.onNoAdsChanged();
  }

  function init() {
    if (!isNative || !window.CdvPurchase) return;
    try {
      const { store, ProductType, Platform } = CdvPurchase;
      // Use the correct billing platform for the OS, or the product won't be found on Android.
      const plat = (Cap && Cap.getPlatform && Cap.getPlatform() === 'android')
        ? Platform.GOOGLE_PLAY : Platform.APPLE_APPSTORE;
      store.register([{ id: PRODUCT_ID, type: ProductType.NON_CONSUMABLE, platform: plat }]);
      store.when()
        .approved(t => t.finish())                                   // no server validator → finish the transaction directly
        .updated(() => { if (store.owned(PRODUCT_ID)) persist(true); }); // GRANT-ONLY: re-assert ad-free whenever the store confirms ownership
      // GRANT-ONLY reconcile. CRITICAL: never wipe the entitlement on launch. store.initialize()
      // can resolve BEFORE the App Store receipt has loaded, so store.owned() is a transient
      // `false` for a real buyer at that instant. The old code did persist(reallyOwned) here, which
      // wrote '0' and brought ads back for people who had genuinely paid. We now only ever grant:
      // if the receipt is not ready yet, the delayed re-checks below (or a later .updated) grant the
      // moment it confirms — and a buyer whose flag was wiped by the old build self-heals from their
      // real receipt. A handful of legacy false-positives keeping ad-free is a tiny, acceptable cost
      // next to ever charging someone and then showing them ads.
      const grantIfOwned = () => { try { if (store.owned(PRODUCT_ID)) persist(true); } catch (e) {} };
      store.initialize([plat]).then(() => {
        grantIfOwned();
        setTimeout(grantIfOwned, 3000);     // the receipt often finishes loading/validating a moment after init
        setTimeout(grantIfOwned, 12000);
      });
    } catch (e) {}
  }

  function priceString() {
    try { const p = CdvPurchase.store.get(PRODUCT_ID); return (p && p.pricing && p.pricing.price) || '£9.99'; }
    catch (e) { return '£9.99'; }
  }

  function purchase(onDone) {
    if (!isNative || !window.CdvPurchase) { onDone && onDone(false, 'Purchases are only available in the app'); return; }
    try {
      const offer = CdvPurchase.store.get(PRODUCT_ID).getOffer();
      if (!offer) { onDone && onDone(false, 'Product not ready — try again in a moment'); return; }
      offer.order().then(err => {
        if (err) { onDone && onDone(false, err.message || 'Purchase cancelled'); return; }
        // order() can resolve even when the user CANCELS, so don't treat that as paid.
        // Only grant ad-free when the store actually confirms a completed purchase.
        const reallyOwned = !!CdvPurchase.store.owned(PRODUCT_ID);
        if (reallyOwned) persist(true);
        onDone && onDone(reallyOwned, reallyOwned ? '' : 'Purchase cancelled');
      });
    } catch (e) { onDone && onDone(false, (e && e.message) || 'Purchase failed'); }
  }

  function restore(onDone) {
    if (!isNative || !window.CdvPurchase) { onDone && onDone(false); return; }
    try {
      CdvPurchase.store.restorePurchases().then(() => {
        const o = !!CdvPurchase.store.owned(PRODUCT_ID);
        if (o) persist(true);                    // only upgrade — never wipe an existing entitlement
        onDone && onDone(o);
      });
    } catch (e) { onDone && onDone(false); }
  }

  window.IAP = {
    isNative,
    available: () => isNative && !!window.CdvPurchase,
    hasNoAds: () => owned,
    priceString, purchase, restore, init,
  };

  if (isNative) {
    document.addEventListener('deviceready', init);             // Cordova event (fired under Capacitor)
    if (document.readyState !== 'loading' && window.CdvPurchase) init();
  }
})();
