(function () {
  /* ===============================
     GUARD (PREVENT DOUBLE LOAD)
  =============================== */
  if (window.NorthSkyOS?.__loaded) return;

  /* ===============================
     CONFIG
  =============================== */
  const CONFIG = {
    sessionKey: "ns_session_id",
    userKey: "ns_user_id",
    scoreKey: "ns_score",

    hotThreshold: 15,

    funnelURL: "https://goldylox752.github.io/RoofFlow-AI/",
    crmEndpoint: null,

    source: "northsky_os",
    debug: true
  };

  /* ===============================
     UTILITIES
  =============================== */
  const uuid = () => crypto.randomUUID();

  function isLocalStorageAvailable() {
    try {
      const test = "__ns_test__";
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      console.warn("[NS] localStorage unavailable");
      return false;
    }
  }

  const storageOK = isLocalStorageAvailable();

  function getStorage(key, fallback) {
    if (!storageOK) return fallback;
    const val = localStorage.getItem(key);
    return val !== null ? val : fallback;
  }

  function setStorage(key, value) {
    if (!storageOK) return;
    localStorage.setItem(key, value);
  }

  const getOrCreate = (key) => {
    let v = getStorage(key, null);
    if (!v) {
      v = uuid();
      setStorage(key, v);
    }
    return v;
  };

  const session_id = getOrCreate(CONFIG.sessionKey);
  const user_id = getOrCreate(CONFIG.userKey);

  /* ===============================
     SCORE ENGINE
  =============================== */
  const SCORE_MAP = {
    page_view: 1,
    click: 2,
    scroll: 1,
    funnel_click: 8,
    stripe_click: 15,
    lead: 20
  };

  function getScore() {
    if (!storageOK) return 0;
    return Number(getStorage(CONFIG.scoreKey, 0));
  }

  function setScore(v) {
    if (!storageOK) return v;
    setStorage(CONFIG.scoreKey, String(v));
    return v;
  }

  function addScore(eventType) {
    const delta = SCORE_MAP[eventType] || 0;
    const newScore = getScore() + delta;
    return setScore(newScore);
  }

  function getStage(score) {
    if (score >= CONFIG.hotThreshold) return "HOT";
    if (score >= 6) return "WARM";
    return "COLD";
  }

  /* ===============================
     CRM SEND (with optional keepalive)
  =============================== */
  let pendingSend = null;

  async function send(event, data = {}) {
    const score = getScore();
    const payload = {
      event,
      data,
      session_id,
      user_id,
      score,
      stage: getStage(score),
      source: CONFIG.source,
      url: location.href,
      referrer: document.referrer,
      timestamp: Date.now(),
      time_iso: new Date().toISOString()
    };

    if (CONFIG.debug) console.log("[NS EVENT]", payload);

    if (!CONFIG.crmEndpoint) return payload;

    // Use keepalive to avoid losing requests on page unload
    try {
      const fetchPromise = fetch(CONFIG.crmEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      });
      // optional: wait only if we need to ensure completion before redirect
      pendingSend = fetchPromise;
      await fetchPromise;
    } catch (e) {
      if (CONFIG.debug) console.warn("[NS] send failed", e);
    } finally {
      pendingSend = null;
    }
    return payload;
  }

  /* ===============================
     TRACKING CORE
  =============================== */
  let redirecting = false;

  async function track(event, data = {}) {
    const newScore = addScore(event);
    const stage = getStage(newScore);

    const payload = {
      event,
      data,
      session_id,
      user_id,
      score: newScore,
      stage,
      url: location.href,
      timestamp: Date.now()
    };

    if (CONFIG.debug) console.log("[TRACK]", payload);

    // Send asynchronously (don't await to avoid blocking)
    send(event, data).catch(e => console.warn);

    return payload;
  }

  /* ===============================
     ROUTER (with loop protection)
  =============================== */
  async function route(reason = "manual") {
    if (redirecting) return;
    const score = getScore();
    const isHot = score >= CONFIG.hotThreshold;

    await send("route", { reason, score, willRedirect: isHot });

    if (isHot && !redirecting) {
      redirecting = true;
      const target = CONFIG.funnelURL;
      // Prevent redirect to same page (infinite loop)
      if (target === location.href) {
        if (CONFIG.debug) console.warn("[NS] funnelURL equals current URL – redirect skipped");
        redirecting = false;
        return;
      }
      if (CONFIG.debug) console.log(`[NS] Redirecting HOT lead to ${target}`);
      window.location.href = target;
    }
  }

  // Helper to manually check and route if hot
  function routeIfHot() {
    if (getScore() >= CONFIG.hotThreshold) {
      route("auto_check");
    }
  }

  /* ===============================
     GO (external link tracker)
  =============================== */
  function go(url, label = "funnel") {
    track("funnel_click", { url, label });
    window.open(url, "_blank");
  }

  /* ===============================
     AUTO TRACKING
  =============================== */
  let pageStartTime = Date.now();
  let scrollTracked = false;

  function init() {
    track("page_view");

    // Click tracking
    document.addEventListener("click", (e) => {
      const el = e.target.closest("a, button");
      if (!el) return;
      track("click", {
        text: el.innerText?.trim().substring(0, 100) || null,
        href: el.href || null,
        tagName: el.tagName
      });
    });

    // Scroll tracking (once, when user scrolls past 50% of page)
    window.addEventListener("scroll", () => {
      if (scrollTracked) return;
      const scrollPercent = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
      if (scrollPercent >= 50) {
        track("scroll", { percent: Math.round(scrollPercent) });
        scrollTracked = true;
      }
    });

    // Time on page (send on unload)
    window.addEventListener("beforeunload", () => {
      const seconds = Math.round((Date.now() - pageStartTime) / 1000);
      send("time_on_page", { seconds }).catch(() => {});
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ===============================
     GLOBAL EXPORT
  =============================== */
  window.NorthSkyOS = {
    __loaded: true,

    track,
    send,
    go,
    route,
    routeIfHot,

    session: () => session_id,
    user: () => user_id,
    score: getScore,
    stage: () => getStage(getScore())
  };
})();