/* Weekly Shop: a small document store on top of Supabase.
   It offers the same calls the planner used inside Claude (doc/collection, get/set/delete,
   onSnapshot), so the planner code is unchanged. All of the household's documents are loaded
   once at sign-in (a few hundred KB) and kept live through Supabase Realtime, so both phones
   see each other's changes within a second or two. */
(function () {
  "use strict";
  const parentOf = (p) => p.split("/").slice(0, -1).join("/");
  const segs = (p) => p.split("/").length;
  const newId = () => {
    const a = new Uint8Array(10); crypto.getRandomValues(a);
    return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  };
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  function deepMerge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
      else out[k] = v;
    }
    return out;
  }
  function storeError(err) {
    const code = err && (err.code === "42501" || /row-level security|permission/i.test(err.message || "")) ? "invalid_argument" : "unavailable";
    return { code, message: (err && err.message) || "Couldn't reach the database" };
  }

  window.WS = window.WS || {};
  window.WS.createStore = function (sb, householdId) {
    const cache = new Map(); // path -> data
    const docL = new Map();  // path -> Set(fn)
    const colL = new Map();  // collection path -> Set(fn)
    let loaded = false;
    const waiters = [];

    function notify(path) {
      (docL.get(path) || []).forEach((f) => f());
      (colL.get(parentOf(path)) || []).forEach((f) => f());
    }
    function snapDoc(path) {
      const has = cache.has(path);
      const d = cache.get(path);
      return { id: path.split("/").pop(), exists: has, data: () => (has ? d : undefined), metadata: { fromCache: false, hasPendingWrites: false } };
    }
    function snapCol(c, q) {
      let docs = [];
      for (const p of cache.keys()) if (parentOf(p) === c && segs(p) === segs(c) + 1) docs.push(snapDoc(p));
      if (q.order) {
        const [f, dir] = q.order;
        docs.sort((a, b) => {
          const x = a.data()[f], y = b.data()[f];
          if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
          return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1);
        });
      } else docs.sort((a, b) => (a.id < b.id ? -1 : 1));
      if (q.limit) docs = docs.slice(0, q.limit);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    }
    const whenLoaded = () => (loaded ? Promise.resolve() : new Promise((r) => waiters.push(r)));

    async function loadAll() {
      const fresh = new Map();
      for (let from = 0; ; from += 500) {
        const { data, error } = await sb.from("docs").select("path,data").eq("household_id", householdId).order("path").range(from, from + 499);
        if (error) throw storeError(error);
        data.forEach((r) => fresh.set(r.path, r.data));
        if (data.length < 500) break;
      }
      const changed = new Set([...cache.keys(), ...fresh.keys()]);
      cache.clear(); fresh.forEach((v, k) => cache.set(k, v));
      if (loaded) changed.forEach(notify);
      loaded = true; waiters.splice(0).forEach((r) => r());
    }

    // Live updates from the other phone (and the PC agent).
    sb.channel("docs-" + householdId)
      .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "household_id=eq." + householdId }, (payload) => {
        if (payload.eventType === "DELETE") { const p = payload.old && payload.old.path; if (p && cache.has(p)) { cache.delete(p); notify(p); } }
        else if (payload.new && payload.new.path) { cache.set(payload.new.path, payload.new.data); notify(payload.new.path); }
      })
      .subscribe();
    // A phone that was asleep may have missed updates: reload when it comes back.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && loaded) loadAll().catch(() => {}); });

    function docRef(path) {
      if (segs(path) % 2 !== 0) throw new TypeError("Document paths need an even number of segments: " + path);
      return {
        id: path.split("/").pop(), path,
        get: async () => { await whenLoaded(); return snapDoc(path); },
        set: async (data) => {
          cache.set(path, clone(data)); notify(path);
          const { error } = await sb.from("docs").upsert({ household_id: householdId, path, data }, { onConflict: "household_id,path" });
          if (error) throw storeError(error);
        },
        update: async (patch) => {
          await whenLoaded();
          if (!cache.has(path)) throw { code: "invalid_argument", message: "Document does not exist" };
          const next = deepMerge(cache.get(path), patch);
          cache.set(path, next); notify(path);
          const { error } = await sb.from("docs").update({ data: next }).eq("household_id", householdId).eq("path", path);
          if (error) throw storeError(error);
        },
        delete: async () => {
          cache.delete(path); notify(path);
          const { error } = await sb.from("docs").delete().eq("household_id", householdId).eq("path", path);
          if (error) throw storeError(error);
        },
        onSnapshot: (next, onErr) => {
          const f = () => { try { next(snapDoc(path)); } catch (e) { console.error(e); } };
          if (!docL.has(path)) docL.set(path, new Set());
          docL.get(path).add(f);
          whenLoaded().then(f, (e) => onErr && onErr(e));
          return () => docL.get(path).delete(f);
        },
        collection: (sub) => colRef(path + "/" + sub),
      };
    }
    function colRef(path, q) {
      q = q || {};
      if (segs(path) % 2 !== 1) throw new TypeError("Collection paths need an odd number of segments: " + path);
      return {
        path,
        where: () => colRef(path, q),
        orderBy: (f, dir) => colRef(path, Object.assign({}, q, { order: [f, dir || "asc"] })),
        limit: (n) => colRef(path, Object.assign({}, q, { limit: n })),
        get: async () => { await whenLoaded(); return snapCol(path, q); },
        doc: (id) => docRef(path + "/" + (id || newId())),
        add: async (data) => { const r = docRef(path + "/" + newId()); await r.set(data); return r; },
        onSnapshot: (next, onErr) => {
          const f = () => { try { next(snapCol(path, q)); } catch (e) { console.error(e); } };
          if (!colL.has(path)) colL.set(path, new Set());
          colL.get(path).add(f);
          whenLoaded().then(f, (e) => onErr && onErr(e));
          return () => colL.get(path).delete(f);
        },
      };
    }

    const ready = loadAll();
    return { doc: docRef, collection: colRef, ready, reload: loadAll };
  };
})();
