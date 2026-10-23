// Landing page: student join flow + teacher sign-in.
import { getDb, LIVE } from './db.js';
import { lookupCode, joinAssignment, JoinError } from './jams.js';
import { normalizeCode, qs } from './util.js';
import { demoBannerHTML } from './ui.js';

const $ = id => document.getElementById(id);
$('demoBanner').innerHTML = demoBannerHTML();

const codeIn = $('code'), nameIn = $('name'), err = $('joinErr'), btn = $('joinBtn');
codeIn.value = normalizeCode(qs('code') || '');
try { nameIn.value = localStorage.getItem('sj_name') || ''; } catch {}
codeIn.addEventListener('input', () => {
  const p = codeIn.selectionStart;
  codeIn.value = normalizeCode(codeIn.value);
  codeIn.setSelectionRange(p, p);
});
if (codeIn.value) nameIn.focus(); else codeIn.focus();

let dbP = getDb().catch(e => { console.error(e); err.textContent = 'Could not reach SpaceJam. Check your internet connection.'; throw e; });
let pending = null, chosenGroup = null;

function busy(on, label) {
  btn.disabled = on;
  btn.textContent = on ? (label || 'Joining…') : (pending ? 'Join group' : 'Join');
}

$('joinForm').addEventListener('submit', async e => {
  e.preventDefault();
  err.textContent = '';
  const db = await dbP;
  if (pending) {
    if (!chosenGroup) { err.textContent = 'Pick your group first.'; return; }
    return finish(db, chosenGroup);
  }
  const code = normalizeCode(codeIn.value);
  const name = nameIn.value.trim().replace(/\s+/g, ' ');
  if (code.length < 6) { err.textContent = 'Enter the 6-character code from the board.'; codeIn.focus(); return; }
  if (!name) { err.textContent = 'Enter your name.'; nameIn.focus(); return; }
  try { localStorage.setItem('sj_name', name); } catch {}
  busy(true);
  try {
    if (!db.user) await db.signInAnon();
    const found = await lookupCode(db, code);
    pending = { ...found, name };
    if (found.info.mode === 'groups') {
      busy(false);
      $('stepCode').hidden = true;
      $('stepGroup').hidden = false;
      $('backBtn').hidden = false;
      $('groupIntro').textContent = `“${found.info.title}” is a group activity. Which group are you in?`;
      $('groupPicks').innerHTML = Array.from({ length: found.info.groupCount }, (_, i) =>
        `<button type="button" class="group-pick" data-g="${i + 1}" aria-pressed="false">Group ${i + 1}</button>`).join('');
      $('groupPicks').querySelector('button').focus();
      btn.textContent = 'Join group';
      return;
    }
    await finish(db);
  } catch (ex) {
    if (!(ex instanceof JoinError)) console.error(ex);
    pending = null;
    busy(false);
    err.textContent = ex instanceof JoinError ? ex.message : 'Something went wrong joining. Check the code and try again.';
  }
});

$('groupPicks').addEventListener('click', e => {
  const b = e.target.closest('[data-g]'); if (!b) return;
  chosenGroup = Number(b.dataset.g);
  $('groupPicks').querySelectorAll('[data-g]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
$('backBtn').onclick = () => {
  pending = null; chosenGroup = null;
  $('stepCode').hidden = false; $('stepGroup').hidden = true; $('backBtn').hidden = true;
  busy(false); err.textContent = '';
};

async function finish(db, group) {
  busy(true);
  try {
    const jamId = await joinAssignment(db, pending, pending.name, group);
    location.href = `board.html?jam=${encodeURIComponent(jamId)}`;
  } catch (ex) {
    if (!(ex instanceof JoinError)) console.error(ex);
    busy(false);
    err.textContent = ex instanceof JoinError ? ex.message : "Couldn't join. Ask your teacher if joining is still open.";
  }
}

// ── teachers ──────────────────────────────────────────────────
(async () => {
  const db = await dbP;
  const refresh = async () => {
    const t = db.user && !db.user.isAnonymous && await db.isTeacher();
    $('teachBtn').hidden = !!t;
    $('dashBtn').hidden = !t;
    $('signOutBtn').hidden = !t;
    $('teachMsg').textContent = t
      ? `Signed in as ${db.user.displayName || db.user.email}.`
      : (LIVE ? 'Create jams, hand out join codes, and watch every student or group work live. Sign in with your Google account.'
              : 'Demo mode: continue as a demo teacher to try creating jams and assignments in this browser.');
  };
  if (!LIVE) $('teachBtn').textContent = 'Continue as demo teacher';
  await refresh();
  $('teachBtn').onclick = async () => {
    $('teachErr').textContent = '';
    try {
      await db.signInTeacher();
      location.href = 'dashboard.html';
    } catch (e) {
      console.error(e);
      $('teachErr').textContent = e.code === 'not-allowed' ? e.message
        : e.code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.'
        : e.code === 'auth/popup-closed-by-user' ? '' : 'Sign-in failed. Try again.';
    }
  };
  $('signOutBtn').onclick = async () => { await db.signOut(); refresh(); };
})();
