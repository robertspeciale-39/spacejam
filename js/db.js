// Data layer. One small API, two backends:
//   • Firebase Realtime Database (live mode)   — when firebase-config.js has an apiKey
//   • LocalDb (demo mode)                       — localStorage + BroadcastChannel, syncs across tabs
//
// API (paths are slash-separated, no leading slash):
//   db.mode, db.user, signInAnon(), signInTeacher(), signOut(), isTeacher()
//   get(path) → Promise<value>, set(path, v), update({path: v|null, ...}), remove(path)
//   on(path, cb, errCb) → unsubscribe      (cb receives the full value at path)
//   onDisconnectRemove(path)                (presence cleanup)

import { firebaseConfig, FIREBASE_SDK_VERSION, USE_EMULATORS } from './firebase-config.js';
import { newId } from './util.js';

export const LIVE = !!(firebaseConfig && firebaseConfig.apiKey);

/** JSON-clean a value the way RTDB stores it: no undefined, no empty objects. */
export function clean(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    const a = v.map(clean).filter(x => x !== null);
    return a.length ? a : null;
  }
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) {
      const c = clean(v[k]);
      if (c !== null) o[k] = c;
    }
    return Object.keys(o).length ? o : null;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}

export function emailKey(email) {
  return String(email || '').trim().toLowerCase().replace(/\./g, ',');
}

let dbPromise = null;
export function getDb() {
  if (!dbPromise) dbPromise = LIVE ? createFirebaseDb() : Promise.resolve(createLocalDb());
  return dbPromise;
}

// ═════════════════════════════════════════════════════════════
//  FIREBASE
// ═════════════════════════════════════════════════════════════
async function createFirebaseDb() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
  const [appM, authM, dbM] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-database.js')
  ]);
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  const rtdb = dbM.getDatabase(app);
  if (USE_EMULATORS) {
    authM.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    dbM.connectDatabaseEmulator(rtdb, '127.0.0.1', 9000);
  }
  await new Promise(res => { const u = authM.onAuthStateChanged(auth, () => { u(); res(); }); });

  const userOf = u => u && {
    uid: u.uid, email: u.email || null, displayName: u.displayName || null, isAnonymous: u.isAnonymous
  };
  const r = path => dbM.ref(rtdb, path);

  const api = {
    mode: 'firebase',
    get user() { return userOf(auth.currentUser); },
    async signInAnon() {
      if (!auth.currentUser) await authM.signInAnonymously(auth);
      return api.user;
    },
    async signInTeacher() {
      const p = new authM.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      await authM.signInWithPopup(auth, p);
      const u = api.user;
      // Rules only allow this write for allow-listed, verified emails.
      try {
        await dbM.set(r('teachers/' + u.uid), { email: u.email, name: u.displayName || u.email, createdAt: Date.now() });
      } catch (e) {
        await authM.signOut(auth);
        const err = new Error('That Google account is not on the SpaceJam teacher allow-list.');
        err.code = 'not-allowed';
        throw err;
      }
      return u;
    },
    async signOut() { await authM.signOut(auth); },
    onAuth(cb) { return authM.onAuthStateChanged(auth, u => cb(userOf(u))); },
    async isTeacher() {
      const u = auth.currentUser;
      if (!u || u.isAnonymous) return false;
      try { return (await dbM.get(r('teachers/' + u.uid))).exists(); } catch { return false; }
    },
    async get(path) { return (await dbM.get(r(path))).val(); },
    set(path, v) { return dbM.set(r(path), clean(v)); },
    update(map) {
      const m = {};
      for (const k of Object.keys(map)) m[k] = clean(map[k]);
      return dbM.update(dbM.ref(rtdb), m);
    },
    remove(path) { return dbM.remove(r(path)); },
    on(path, cb, errCb) {
      return dbM.onValue(r(path), s => cb(s.val()), e => { console.warn('listen', path, e); errCb && errCb(e); });
    },
    onDisconnectRemove(path) { return dbM.onDisconnect(r(path)).remove(); },
    onConnection(cb) { return api.on('.info/connected', v => cb(!!v)); }
  };
  return api;
}

// ═════════════════════════════════════════════════════════════
//  LOCAL DEMO
// ═════════════════════════════════════════════════════════════
const LS_KEY = 'spacejam_local_db_v1';
const EPHEMERAL = ['presence', 'laser'];

function split(path) { return String(path).split('/').filter(Boolean); }
function isEphemeral(path) { return EPHEMERAL.includes(split(path)[0]); }
function related(a, b) {
  const pa = split(a), pb = split(b);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) if (pa[i] !== pb[i]) return false;
  return true;
}
function getAt(tree, parts) {
  let cur = tree;
  for (const p of parts) { if (cur == null || typeof cur !== 'object') return null; cur = cur[p]; }
  return cur === undefined ? null : cur;
}
function setAt(tree, parts, val) {
  if (!parts.length) return;
  const stack = [];
  let cur = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
      if (val === null) return;
      cur[parts[i]] = {};
    }
    stack.push([cur, parts[i]]);
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (val === null) delete cur[last]; else cur[last] = val;
  // prune empty parents like RTDB does
  for (let i = stack.length - 1; i >= 0; i--) {
    const [obj, key] = stack[i];
    const child = obj[key];
    if (child && typeof child === 'object' && !Object.keys(child).length) delete obj[key]; else break;
  }
}

function createLocalDb() {
  let tree = load();
  const eph = {};
  const listeners = new Set();
  const disconnects = new Set();
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('spacejam_local') : null;

  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; } }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(tree)); }
    catch (e) {
      console.warn(e);
      import('./util.js').then(u => u.toast('Local demo storage is full. Remove some images or jams.', 'error'));
    }
  }
  const rootFor = path => (isEphemeral(path) ? eph : tree);
  const read = path => getAt(rootFor(path), split(path));

  function notify(changed) {
    for (const l of listeners) {
      if (!changed.some(c => related(c, l.path))) continue;
      const v = read(l.path);
      const s = JSON.stringify(v);
      if (s === l.last) continue;
      l.last = s;
      try { l.cb(v == null ? null : JSON.parse(s)); } catch (e) { console.error(e); }
    }
  }

  function apply(map, fromRemote) {
    const changed = [];
    let persist = false;
    const ephOut = {};
    for (const path of Object.keys(map)) {
      const v = clean(map[path]);
      setAt(rootFor(path), split(path), v);
      changed.push(path);
      if (isEphemeral(path)) ephOut[path] = v; else persist = true;
    }
    if (!fromRemote) {
      if (persist) save();
      if (bc && Object.keys(ephOut).length) bc.postMessage(ephOut);
    }
    notify(changed);
  }

  window.addEventListener('storage', e => {
    if (e.key !== LS_KEY) return;
    tree = load();
    notify(['']);
  });
  if (bc) bc.onmessage = e => apply(e.data, true);
  window.addEventListener('pagehide', () => {
    const m = {};
    for (const p of disconnects) m[p] = null;
    if (Object.keys(m).length) apply(m, false);
  });

  let uid = sessionStorage.getItem('sj_local_uid');
  if (!uid) { uid = 'local-' + newId(); sessionStorage.setItem('sj_local_uid', uid); }
  const authCbs = new Set();
  const currentUser = () => {
    if (!sessionStorage.getItem('sj_local_signed')) return null;
    const teacher = sessionStorage.getItem('sj_local_teacher') === '1';
    return teacher
      ? { uid, email: 'teacher@local.demo', displayName: 'Demo Teacher', isAnonymous: false }
      : { uid, email: null, displayName: null, isAnonymous: true };
  };
  const fireAuth = () => authCbs.forEach(cb => cb(currentUser()));

  const api = {
    mode: 'local',
    get user() { return currentUser(); },
    async signInAnon() {
      if (!currentUser()) { sessionStorage.setItem('sj_local_signed', '1'); fireAuth(); }
      return currentUser();
    },
    async signInTeacher() {
      sessionStorage.setItem('sj_local_signed', '1');
      sessionStorage.setItem('sj_local_teacher', '1');
      apply({ ['teachers/' + uid]: { email: 'teacher@local.demo', name: 'Demo Teacher', createdAt: Date.now() } });
      fireAuth();
      return currentUser();
    },
    async signOut() {
      sessionStorage.removeItem('sj_local_teacher');
      sessionStorage.removeItem('sj_local_signed');
      fireAuth();
    },
    onAuth(cb) { authCbs.add(cb); setTimeout(() => cb(currentUser()), 0); return () => authCbs.delete(cb); },
    async isTeacher() { return sessionStorage.getItem('sj_local_teacher') === '1'; },
    async get(path) { const v = read(path); return v == null ? null : JSON.parse(JSON.stringify(v)); },
    async set(path, v) { apply({ [path]: v }); },
    async update(map) { apply(map); },
    async remove(path) { apply({ [path]: null }); },
    on(path, cb) {
      const l = { path, cb, last: undefined };
      listeners.add(l);
      setTimeout(() => {
        if (!listeners.has(l)) return;
        const v = read(path);
        l.last = JSON.stringify(v);
        cb(v == null ? null : JSON.parse(l.last));
      }, 0);
      return () => listeners.delete(l);
    },
    async onDisconnectRemove(path) { disconnects.add(path); },
    onConnection(cb) { setTimeout(() => cb(true), 0); return () => {}; },
    resetAll() { tree = {}; save(); notify(['']); }
  };
  return api;
}
