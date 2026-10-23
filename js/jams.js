// Jam / assignment / join operations (all writes are single multi-path updates
// so the security rules can validate them as one unit).
import { newId, newJoinCode, asArray, clone } from './util.js';

export const P = {
  jam: id => `jams/${id}`,
  meta: id => `jams/${id}/meta`,
  order: id => `jams/${id}/frameOrder`,
  frames: id => `jams/${id}/frames`,
  frame: (id, f) => `jams/${id}/frames/${f}`,
  obj: (id, f, o) => `jams/${id}/frames/${f}/objects/${o}`,
  members: id => `jams/${id}/members`,
  touched: id => `jams/${id}/touched`,
  ownerJams: uid => `ownerJams/${uid}`,
  presence: id => `presence/${id}`,
  laser: id => `laser/${id}`,
  versions: id => `versions/${id}`,
  versionsLast: id => `versionLast/${id}`,
  assignment: a => `assignments/${a}`,
  teacherAssignments: uid => `teacherAssignments/${uid}`,
  code: c => `joinCodes/${c}`
};

export function blankFrame() { return { bg: { type: 'blank' } }; }

export async function createJam(db, { title = 'Untitled jam' } = {}) {
  const uid = db.user.uid;
  const jamId = newId('j');
  const fid = newId('f');
  const now = Date.now();
  await db.update({
    [P.meta(jamId)]: { title, ownerUid: uid, createdAt: now, updatedAt: now, locked: false, studentsCanClear: false, kind: 'jam' },
    [P.order(jamId)]: [fid],
    [P.frame(jamId, fid)]: blankFrame(),
    [P.touched(jamId)]: now,
    [`${P.ownerJams(uid)}/${jamId}`]: { title, createdAt: now }
  });
  return jamId;
}

/** Plain snapshot of a jam's content (what version history and copies store). */
export async function snapshotJam(db, jamId) {
  const jam = await db.get(P.jam(jamId));
  return jamToSnapshot(jam);
}
export function jamToSnapshot(jam) {
  return {
    title: jam?.meta?.title || 'Untitled jam',
    frameOrder: asArray(jam?.frameOrder),
    frames: clone(jam?.frames || {})
  };
}

function copyWrites(jamId, snap, meta) {
  const order = snap.frameOrder.length ? snap.frameOrder : [newId('f')];
  const frames = {};
  for (const f of order) frames[f] = snap.frames?.[f] || blankFrame();
  return {
    [P.meta(jamId)]: meta,
    [P.order(jamId)]: order,
    [P.frames(jamId)]: frames,
    [P.touched(jamId)]: Date.now()
  };
}

export async function duplicateJam(db, jamId, title) {
  const uid = db.user.uid;
  const snap = await snapshotJam(db, jamId);
  const id = newId('j');
  const now = Date.now();
  const t = title || `Copy of ${snap.title}`;
  await db.update({
    ...copyWrites(id, snap, { title: t, ownerUid: uid, createdAt: now, updatedAt: now, locked: false, studentsCanClear: false, kind: 'jam' }),
    [`${P.ownerJams(uid)}/${id}`]: { title: t, createdAt: now }
  });
  return id;
}

export async function deleteJam(db, jamId) {
  const uid = db.user.uid;
  await db.update({
    [P.jam(jamId)]: null,
    [P.versions(jamId)]: null,
    [P.versionsLast(jamId)]: null,
    [`${P.ownerJams(uid)}/${jamId}`]: null
  });
}

export async function renameJam(db, jamId, title, meta) {
  const m = { [`${P.meta(jamId)}/title`]: title, [`${P.meta(jamId)}/updatedAt`]: Date.now() };
  if (!meta?.assignmentId) m[`${P.ownerJams(db.user.uid)}/${jamId}/title`] = title;
  await db.update(m);
}

// ── assignments ───────────────────────────────────────────────
/**
 * mode: 'class' (one shared copy) | 'individual' (copy per student, made on join)
 *     | 'groups' (N copies, student picks a group)
 * The template jam is never edited by students; every assignment runs on copies.
 */
export async function createAssignment(db, templateJamId, { title, mode, groupCount = 4 }) {
  const uid = db.user.uid;
  const snap = await snapshotJam(db, templateJamId);
  const aid = newId('a');
  const code = await uniqueCode(db);
  const now = Date.now();
  const info = { ownerUid: uid, title: title || snap.title, mode, groupCount: mode === 'groups' ? groupCount : 0, code, createdAt: now, templateJamId };
  const writes = {
    [`${P.assignment(aid)}/info`]: info,
    [`${P.assignment(aid)}/template`]: snap,
    [`${P.teacherAssignments(uid)}/${aid}`]: { title: info.title, createdAt: now },
    [P.code(code)]: { assignmentId: aid, ownerUid: uid, open: true }
  };
  const baseMeta = { ownerUid: uid, assignmentId: aid, createdAt: now, updatedAt: now, locked: false, studentsCanClear: false, kind: 'copy' };
  if (mode === 'class') {
    const jid = newId('j');
    Object.assign(writes, copyWrites(jid, snap, { ...baseMeta, title: info.title, label: 'Whole class' }));
    writes[`${P.assignment(aid)}/classJam`] = jid;
    writes[`${P.assignment(aid)}/copies/${jid}`] = { label: 'Whole class', createdAt: now };
  } else if (mode === 'groups') {
    for (let g = 1; g <= groupCount; g++) {
      const jid = newId('j');
      Object.assign(writes, copyWrites(jid, snap, { ...baseMeta, title: `${info.title} · Group ${g}`, label: `Group ${g}`, groupNumber: g }));
      writes[`${P.assignment(aid)}/groupJams/${g}`] = jid;
      writes[`${P.assignment(aid)}/copies/${jid}`] = { label: `Group ${g}`, group: g, createdAt: now };
    }
  }
  await db.update(writes);
  return { aid, code };
}

async function uniqueCode(db) {
  for (let i = 0; i < 8; i++) {
    const c = newJoinCode();
    if (!(await db.get(P.code(c)))) return c;
  }
  return newJoinCode(7);
}

export async function setJoinOpen(db, aid, code, open) {
  await db.set(`${P.code(code)}/open`, !!open);
}

export async function regenerateCode(db, aid, oldCode) {
  const code = await uniqueCode(db);
  await db.update({
    [P.code(oldCode)]: null,
    [P.code(code)]: { assignmentId: aid, ownerUid: db.user.uid, open: true },
    [`${P.assignment(aid)}/info/code`]: code
  });
  return code;
}

export async function deleteAssignment(db, aid) {
  const a = await db.get(P.assignment(aid));
  if (!a) return;
  const w = {
    [P.assignment(aid)]: null,
    [`${P.teacherAssignments(db.user.uid)}/${aid}`]: null
  };
  if (a.info?.code) w[P.code(a.info.code)] = null;
  for (const jid of Object.keys(a.copies || {})) {
    w[P.jam(jid)] = null; w[P.versions(jid)] = null; w[P.versionsLast(jid)] = null;
  }
  await db.update(w);
}

// ── joining ───────────────────────────────────────────────────
export class JoinError extends Error {}

/** Step 1: look up a code. Returns { code, aid, info } or throws JoinError. */
export async function lookupCode(db, code) {
  let entry;
  try { entry = await db.get(P.code(code)); } catch { entry = null; }
  if (!entry) throw new JoinError('Code not found. Check for typos and try again.');
  if (!entry.open) throw new JoinError('This jam is closed to new students. Ask your teacher.');
  const info = await db.get(`${P.assignment(entry.assignmentId)}/info`);
  if (!info) throw new JoinError('This assignment no longer exists.');
  return { code, aid: entry.assignmentId, info };
}

/** Step 2: join. Returns the jamId to open. */
export async function joinAssignment(db, { code, aid, info }, name, group) {
  const uid = db.user.uid;
  const now = Date.now();
  const member = { name, role: 'student', joinedAt: now, code };
  let jamId;
  if (info.mode === 'class') {
    jamId = await db.get(`${P.assignment(aid)}/classJam`);
  } else if (info.mode === 'groups') {
    jamId = await db.get(`${P.assignment(aid)}/groupJams/${group}`);
  } else {
    jamId = await db.get(`${P.assignment(aid)}/byUid/${uid}`);
    if (!jamId) {
      const snap = await db.get(`${P.assignment(aid)}/template`);
      jamId = newId('j');
      const title = `${info.title} · ${name}`;
      await db.update({
        ...copyWrites(jamId, { title, frameOrder: asArray(snap?.frameOrder), frames: snap?.frames || {} }, {
          title, ownerUid: info.ownerUid, assignmentId: aid, studentUid: uid, studentName: name, label: name,
          createdAt: now, updatedAt: now, locked: false, studentsCanClear: false, kind: 'copy', joinCode: code
        }),
        [`${P.members(jamId)}/${uid}`]: member,
        [`${P.assignment(aid)}/byUid/${uid}`]: jamId,
        [`${P.assignment(aid)}/copies/${jamId}`]: { label: name, studentUid: uid, createdAt: now }
      });
      return jamId;
    }
  }
  if (!jamId) throw new JoinError('Could not find that jam. Ask your teacher.');
  await db.set(`${P.members(jamId)}/${uid}`, member);
  return jamId;
}
