/* Weekly Shop: sign-in and the bridge the planner expects (window.claude.use("db")).
   First time on a phone: email and password (the iPhone offers to save it, then fills it with Face ID).
   After that the app stays signed in, and you can also turn on Face ID sign-in (a passkey). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const cfg = window.WS_CONFIG || {};
  const LS_PASSKEY = "ws.hasPasskey";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const webauthn = !!(window.PublicKeyCredential && navigator.credentials);

  let resolveDb;
  const dbPromise = new Promise((r) => (resolveDb = r));
  // The planner asks for its database here; it waits until sign-in is done.
  window.claude = { use: (name) => (name === "db" ? dbPromise : Promise.resolve(null)) };

  if (!cfg.supabaseUrl || /YOUR-PROJECT/.test(cfg.supabaseUrl)) {
    showAuth(); msg("This copy isn't connected to a database yet. Fill in app/config.js (see the setup guide).", true);
    $("pwForm").hidden = true; $("pkBtn").hidden = true; return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, experimental: { passkey: true } },
  });
  window.WS = window.WS || {}; window.WS.sb = sb;
  let email = "", started = false;

  function msg(t, bad) { const m = $("authMsg"); m.textContent = t || ""; m.classList.toggle("bad", !!bad); }
  function showAuth() { $("auth").hidden = false; document.body.classList.add("signed-out"); }
  function hideAuth() { $("auth").hidden = true; document.body.classList.remove("signed-out"); }
  function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (label) btn.textContent = label; }

  async function start(session) {
    if (started) return; started = true;
    msg("Loading your household…");
    const { data: claimed, error: claimErr } = await sb.rpc("claim_invites");
    if (claimErr) { started = false; msg("Couldn't check your invitation: " + claimErr.message, true); return; }
    const hh = Array.isArray(claimed) && claimed.length ? (claimed[0].claim_invites || claimed[0]) : null;
    if (!hh) {
      started = false;
      msg("You're signed in as " + (session.user.email || "this account") + ", but that email hasn't been invited to a household. Ask Owen to add it, then try again.", true);
      $("signOutAuth").hidden = false; return;
    }
    const store = window.WS.createStore(sb, hh);
    try { await store.ready; } catch (e) { started = false; msg("Couldn't load your lists: " + (e.message || e.code), true); return; }
    window.WS.user = session.user; window.WS.householdId = hh;
    hideAuth(); resolveDb(store); renderAccount();
    if (webauthn && !lsGet(LS_PASSKEY) && !lsGet("ws.passkeyAsked")) { lsSet("ws.passkeyAsked", "1"); setTimeout(() => openAccount("Use Face ID to sign in next time?"), 800); }
  }

  // ---------- sign-in screen ----------
  $("pkBtn").hidden = !webauthn || !lsGet(LS_PASSKEY); // only once Face ID sign-in has been set up on this phone
  $("pkBtn").addEventListener("click", async () => {
    const b = $("pkBtn"); busy(b, true); msg("");
    try {
      const { data, error } = await sb.auth.signInWithPasskey();
      if (error) throw error;
      lsSet(LS_PASSKEY, "1");
      if (data && data.session) start(data.session);
    } catch (e) { msg("Face ID sign-in didn't work: " + (e.message || e) + ". Use your email instead.", true); }
    busy(b, false);
  });
  $("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("email").value.trim().toLowerCase(), password = $("password").value;
    if (!email || !password) return;
    const b = $("pwGo"); busy(b, true, "Signing in…"); msg("");
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    busy(b, false, "Sign in");
    if (error) { msg(/invalid/i.test(error.message) ? "That email and password don't match." : "Couldn't sign in: " + error.message, true); return; }
    $("password").value = "";
    start(data.session);
  });
  $("signOutAuth").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  // ---------- account panel ----------
  function renderAccount() {
    const u = window.WS.user; if (!u) return;
    $("acctEmail").textContent = u.email || "";
    $("acctUser").value = u.email || "";
    $("acctPasskey").hidden = !webauthn;
  }
  function openAccount(note) { $("acctNote").textContent = note || ""; $("acct").hidden = false; }
  $("acctBtn").addEventListener("click", () => openAccount(""));
  $("acctClose").addEventListener("click", () => { $("acct").hidden = true; });
  $("acctPasskey").addEventListener("click", async () => {
    const b = $("acctPasskey"); busy(b, true, "Waiting for Face ID…");
    try {
      const { error } = await sb.auth.registerPasskey();
      if (error) throw error;
      lsSet(LS_PASSKEY, "1"); $("acctNote").textContent = "Face ID is set up. Next time you're signed out, tap Sign in with Face ID.";
    } catch (e) { $("acctNote").textContent = "Couldn't set up Face ID: " + (e.message || e); }
    busy(b, false, "Set up Face ID sign-in");
  });
  $("newPwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("newPw").value;
    if (pw.length < 10) { $("acctNote").textContent = "Use at least 10 characters."; return; }
    const b = $("newPwGo"); busy(b, true, "Saving…");
    const { error } = await sb.auth.updateUser({ password: pw });
    busy(b, false, "Save new password");
    $("newPw").value = "";
    $("acctNote").textContent = error ? "Couldn't change it: " + error.message : "Password changed. Your iPhone may offer to update the saved one.";
  });
  $("acctSignOut").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  // ---------- go ----------
  sb.auth.getSession().then(({ data }) => {
    if (data && data.session) start(data.session);
    else showAuth();
  });
  sb.auth.onAuthStateChange((evt, session) => { if (evt === "SIGNED_OUT") { started = false; showAuth(); } });
})();
