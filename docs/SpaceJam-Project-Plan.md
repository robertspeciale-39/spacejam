# SpaceJam: Project Plan, Build Guide & User Manual

**Owner:** Rob Speciale, West CTA Cybersecurity
**Status:** APPROVED October 23, 2026 · v1.0 built. See [As-built notes](#as-built-notes-v10) for what changed during the build.
**Date:** October 23, 2026
**Hosting:** GitHub (source) → Vercel (team `west-cta`)

This document serves three jobs:

1. **Spec**: what SpaceJam does, written so you can approve or strike each feature.
2. **Build guide**: the architecture, data model, and phased build order Claude follows.
3. **User manual**: step-by-step teacher and student instructions (Part C). These describe the planned interface and get updated with real screenshots after the build.

---

## Contents

- [Part A: Specification](#part-a-specification)
  - [A1. What SpaceJam is](#a1-what-spacejam-is)
  - [A2. Decisions already locked](#a2-decisions-already-locked)
  - [A3. Open items needing your call](#a3-open-items-needing-your-call)
  - [A4. Feature list](#a4-feature-list)
  - [A5. Out of scope for v1](#a5-out-of-scope-for-v1)
- [Part B: Build Guide](#part-b-build-guide)
  - [B1. Architecture](#b1-architecture)
  - [B2. Repository layout](#b2-repository-layout)
  - [B3. Data model](#b3-data-model)
  - [B4. Security rules (summary)](#b4-security-rules-summary)
  - [B5. Design system application](#b5-design-system-application)
  - [B6. Build phases & acceptance criteria](#b6-build-phases--acceptance-criteria)
  - [B7. Deployment](#b7-deployment)
  - [B8. Limits, costs & risks](#b8-limits-costs--risks)
- [Part C: User Manual](#part-c-user-manual)
  - [C1. Teacher guide](#c1-teacher-guide)
  - [C2. Student guide](#c2-student-guide)
  - [C3. Keyboard shortcuts](#c3-keyboard-shortcuts)
  - [C4. Troubleshooting](#c4-troubleshooting)
- [Approval checklist](#approval-checklist)
- [As-built notes (v1.0)](#as-built-notes-v10)

---

## As-built notes (v1.0)

Everything in Part A was built. These decisions were made during the build; Part C below already reflects them.

| Area | As built | Why |
|---|---|---|
| Assignments | **Every** mode (whole class, individual, groups) runs on **copies** of your jam. "Whole class" is one shared copy. | Your original stays a clean template you can reuse next period or next year. |
| Editing others' work | Students can **move and edit** anyone's notes and shapes (needed for card sorts and grouping), but can only **delete** what they added. The eraser works on anyone's pen strokes, as in Jamboard. "Students can clear" lifts the delete limit. | Matches how Jamboard was used in class without letting one student wipe everyone's work. |
| Backgrounds | Only the teacher can change a frame's background. | Delivers the "locked background" feature. |
| Teacher locks | Teacher can **lock individual objects** in place (⋮ → Lock in place) in addition to locking the whole jam. | Lets you fix prompts and headings on a template. |
| Local demo mode | With no Firebase settings, SpaceJam runs entirely in the browser and syncs between tabs on one computer. | You can try every feature before Firebase is set up. |
| PDF export | Built-in PDF writer (no jsPDF). Pages are 16:9 landscape, one frame per page. | One less dependency to maintain. |
| Firebase SDK | Pinned to **12.19.0** from Google's CDN. | That exact version was tested end to end against the Firebase emulators. |
| Version history | Auto-save every 5 minutes while the jam changes, written by your browser if you're on the jam, otherwise by one student's browser. | Snapshots keep happening even when you're watching from the dashboard. |
| Testing | 69 automated security-rule tests pass in the Firebase emulator; both demo mode and Firebase mode were run through full teacher/student flows in a headless browser. | |

---

# Part A: Specification

## A1. What SpaceJam is

SpaceJam is a real-time collaborative whiteboard modeled on Google Jamboard (retired December 31, 2024). A teacher creates a **jam**, and students join with a short **join code**: no student accounts, no email. Everyone works on the same set of **frames** (pages) at once, adding sticky notes, drawings, shapes, text, and images. The teacher can hand out individual or group copies, watch every jam from one dashboard, roll back mistakes with version history, and export to PDF or PNG.

The look follows the CyberSpesh Design System v3 rather than Google's.

## A2. Decisions already locked

| # | Topic | Decision |
|---|---|---|
| 1 | Export formats | **PDF** (all frames) and **PNG** (current frame). Matches the original. No Word/PowerPoint. |
| 2 | Student access | **Anonymous join code** plus a display name. No student accounts. |
| 3 | Tool scope | **Full Jamboard toolbar**: pen, eraser, select, sticky note, image, shape, text box, laser, plus frames and backgrounds. |
| 4 | Teacher features | **Make a copy** (for each student or group), **view all jams** dashboard, **version history**. |
| 5 | Fonts | **Curated list of ~32 Google Fonts**, loaded on demand (list in A4.3). |
| 6 | Name & theme | **"SpaceJam"** in the **CyberSpesh Design System v3** (Inter + JetBrains Mono, five themes, Matrix default). |
| 7 | Devices | Mouse and keyboard on Chromebooks/desktops. No touch or stylus optimization. |
| 8 | Hosting | GitHub repo → Vercel, team `west-cta`. |

**Assumed from your answers (confirm in A3):** join codes and a teacher "view all jams" dashboard both need a shared live database, so v1 is **real-time multi-user** (everyone sees changes as they happen).

## A3. Open items needing your call

Each item has a recommended default. If you approve the plan without comment, the default is what gets built.

| # | Question | Recommended default |
|---|---|---|
| Q1 | **Real-time collaboration**: confirm that students on the same jam should see each other's notes appear live. | **Yes.** |
| Q2 | **Light mode.** You first asked for a light/dark toggle, then switched to CyberSpesh. All five CyberSpesh themes are dark. Add a sixth "Daylight" light theme (a deviation from the locked system), or ship the five dark themes only? | **Five themes only**, no light theme. The board itself stays light, like a real whiteboard (see B5), so content is readable either way. |
| Q3 | **Author tracking.** Original Jamboard never showed who added what. Should SpaceJam record the author name on every object (visible to you only, on hover)? | **Yes, teacher-only.** Useful for classroom management. |
| Q4 | **Teacher sign-in.** You need a login so only you can create jams and see the dashboard. Google sign-in with your personal Gmail, or with a CCSD Google account? | **Google sign-in, allow-list of teacher emails** you control. |
| Q5 | **Domain.** Default Vercel URL (`spacejam-xxxx.vercel.app`) or a subdomain like `jam.wctacyber.org`? | **`jam.wctacyber.org`** (Cloudflare CNAME, DNS-only). |
| Q6 | **Auto-cleanup.** Delete jams automatically after a period of inactivity? | **No auto-delete.** You delete manually from the dashboard; archive option provided. |
| Q7 | **Name note.** "Space Jam" is also a Warner Bros. film title. That's harmless for an in-class tool. If you ever plan to sell or publicly brand it (TpT, conference demos), consider a variant. | Keep **"SpaceJam"** for classroom use. |

## A4. Feature list

Legend: ✅ in original Jamboard  ➕ new in SpaceJam

### A4.1 Jams and frames

| Feature | Notes | |
|---|---|---|
| Create, rename, delete jams | Teacher only | ✅ |
| Up to **20 frames** per jam | Same limit as the original | ✅ |
| Frame bar: previous/next arrows, frame counter, expandable thumbnail strip | Thumbnails update live | ✅ |
| Add, duplicate, delete, drag-to-reorder frames | | ✅ |
| Fixed **16:9 frame** (1600 × 900 logical units), scaled to fit the window | | ✅ |
| Zoom in/out and fit-to-screen | | ✅ |
| Undo / redo | Per user, covers that user's own actions | ✅ |
| Clear frame | Teacher can always; students only when the teacher allows it | ✅ |

### A4.2 Toolbar (vertical, left side, Jamboard order)

| Tool | Behavior | |
|---|---|---|
| **Pen** | Four styles: pen, marker, highlighter (semi-transparent), brush. Six colors. Hold **Shift** for a straight line. | ✅ |
| **Eraser** | Erases pen strokes only, like the original. Dropdown includes **Clear frame**. | ✅ |
| **Select** | Click to select; drag to move; handles to resize; top handle to rotate; Shift+click or drag-box for multi-select. Holding **Ctrl** temporarily switches to Select from any tool. | ✅ |
| **Sticky note** | Opens a color picker and text box. Six note colors. Text auto-shrinks to fit. Font picker from the curated list. Double-click to edit. | ✅ (font picker ➕) |
| **Image** | Upload from device, drag-and-drop a file, or paste from clipboard. Images are compressed in the browser (see B8). No Google Image Search. | ✅ |
| **Shape** | Circle, square, rounded rectangle, triangle, diamond, line, arrow. Fill color, border color, border width. | ✅ |
| **Text box** | Free text with font, size, color, bold, italic, alignment. | ✅ |
| **Laser** | Glowing trail that fades after about one second. Visible to everyone on the same frame in real time. | ✅ |

**Object menu** (three-dot button on any selected object): Edit, Duplicate, Delete, Bring to front, Send to back, Move to frame… (➕), Lock in place (teacher only ➕).

### A4.3 Sticky note colors and fonts

**Note colors** (fixed across all themes so exports always look the same): Yellow, Orange, Pink, Green, Blue, Purple. Text on notes is always dark for contrast.

**Curated font list (32):**

| Group | Fonts |
|---|---|
| Clean sans | Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Nunito, Work Sans, Rubik, Source Sans 3 |
| Readability | Lexend, Atkinson Hyperlegible |
| Serif | Merriweather, Lora, Playfair Display, Roboto Slab |
| Display | Oswald, Bebas Neue, Righteous, Bangers, Lobster, Pacifico |
| Handwritten | Caveat, Patrick Hand, Indie Flower, Kalam, Shadows Into Light, Permanent Marker, Gloria Hallelujah, Amatic SC |
| Mono / retro | JetBrains Mono, Press Start 2P |

Default note font: **Patrick Hand** (closest to the original's casual feel). You can swap any of these before the build.

### A4.4 Backgrounds

| Background | |
|---|---|
| Blank (white), Dots, Lines, Squares, Graph, Chalkboard (dark green) | ✅ |
| Custom image background (upload) | ✅ |
| Backgrounds are **locked**: students cannot move or erase them, and Clear frame never removes them | ✅ |

### A4.5 Collaboration (students)

| Feature | |
|---|---|
| Join at the SpaceJam home page with a **6-character code** (letters and digits, easily confused characters like 0/O and 1/I removed) and a display name | ➕ |
| Changes appear for everyone within about half a second | ✅ |
| Presence: avatar initials in the top bar show who's on the jam | ✅ |
| "Follow the teacher" toggle: student view jumps to whatever frame the teacher is on | ➕ |
| Rejoining on the same Chromebook restores the same identity, so undo and authorship carry over | ➕ |

### A4.6 Teacher features

| Feature | Notes | |
|---|---|---|
| **Teacher dashboard** | Grid of all your jams with live thumbnails, last activity, and number of students online. Filter by assignment. | ➕ |
| **Make a copy** | Three modes, chosen when you share a jam: **Whole class** (one shared jam), **Individual** (each student who joins gets their own copy of your template, named after them), **Groups** (you set the number of groups; students pick their group when they join). | ✅ (modes ➕) |
| **View all jams** | From an assignment, see every student or group copy side by side; click one to open it live. | ➕ |
| **Version history** | Automatic snapshot every 5 minutes while a jam is being edited, plus "Name current version" on demand. Preview any version and restore it (restoring first saves the current state, so nothing is lost). Keeps the most recent 50 snapshots per jam. | ✅ |
| **Classroom controls** | Lock jam (view-only), close joining, allow/disallow student Clear frame, delete any object, see author on hover (if Q3 approved), regenerate join code. | ➕ |
| **Templates** | Any jam can be marked as a template and reused for future assignments. | ➕ |

### A4.7 Export

| Export | Behavior |
|---|---|
| **Download as PDF** | Every frame as one landscape page, rendered at high resolution. |
| **Save frame as image** | Current frame as PNG. |

Both are available to students and the teacher, drawn by SpaceJam's own renderer (not a screenshot), so fonts and colors match exactly.

### A4.8 Look and feel

- CyberSpesh Design System v3: Inter + JetBrains Mono for the interface; themes Matrix (default), Arctic, Crimson Ops, Tokyo, Galaxy; selection shared with your other CyberSpesh apps through the `cs_theme` key.
- Topbar: West CTA brand mark, **SpaceJam** title, subtitle `COLLABORATIVE WHITEBOARD · WEST CTA CYBERSECURITY`.
- Matrix rain atmosphere at 7% opacity behind the interface, never over the board.

## A5. Out of scope for v1

- Word or PowerPoint export
- Touch, stylus, handwriting or shape recognition, AutoDraw (mobile-only in the original)
- Google Drive, Docs, Slides, or Meet integration
- Google Image Search inside the app
- Comments or chat
- Offline editing
- Infinite canvas (frames stay fixed 16:9, as in the original)

---

# Part B: Build Guide

## B1. Architecture

```
 Student / Teacher browser (Chromebook)
 ┌───────────────────────────────────────────────┐
 │  Static site from Vercel (HTML/CSS/vanilla JS) │
 │   ├─ Board engine (SVG live view)              │
 │   ├─ Canvas renderer (thumbnails + export)     │
 │   ├─ Sync layer  ──────────────┐               │
 │   └─ Export (jsPDF)            │               │
 └────────────────────────────────┼───────────────┘
                                  │ WebSocket
                     ┌────────────▼─────────────┐
                     │ Firebase                  │
                     │  • Authentication         │
                     │    - Anonymous (students) │
                     │    - Google (teacher)     │
                     │  • Realtime Database      │
                     │    - jams, frames, objects│
                     │    - presence, laser      │
                     │    - versions             │
                     └───────────────────────────┘
```

**Why this stack**

| Choice | Reason |
|---|---|
| **Vanilla HTML/CSS/JS, no build step** | Matches your CyberSpesh workflow; push to GitHub and Vercel serves it. |
| **Firebase Realtime Database** (not Firestore) | Billed by data transferred rather than per read/write. A whiteboard generates many small writes, which suits RTDB better. Built-in presence and live listeners. Free Spark plan covers classroom use (see B8). |
| **Firebase Anonymous Auth** | Gives each student a private, persistent ID with no personal data, which security rules can check. |
| **SVG for the live board** | Every object is a DOM element, so selection, text editing, and accessibility are straightforward. |
| **Separate canvas renderer** | One function draws a frame from data. It's reused for thumbnails, PNG, and PDF, so exports are exact. |
| **jsPDF** (cdnjs) | Assembles PDF pages from rendered frames. |

**Deliberate deviations from the cyberspesh-app skill** (it targets single-file teaching apps):

1. Multiple JS files (ES modules) instead of one HTML file. The app is too large for one file to stay maintainable. Still no build step.
2. Two external libraries: Firebase SDK and jsPDF. Both loaded from CDN with pinned versions.
3. Sticky note colors and board backgrounds are fixed content colors defined as `--note-*` and `--board-*` tokens in `:root`, not per-theme.

## B2. Repository layout

```
spacejam/
├── index.html              # Landing: "Join a jam" + "Teacher sign-in"
├── board.html              # The board (jam editor)
├── dashboard.html          # Teacher dashboard
├── css/
│   ├── cyberspesh.css      # Design System v3 tokens + shell (from app-shell)
│   └── board.css           # Board, toolbar, frame bar, menus
├── js/
│   ├── firebase-config.js  # Public Firebase web config (safe to commit)
│   ├── auth.js             # Anonymous + Google sign-in, teacher allow-list check
│   ├── store.js            # Local state, undo/redo stacks
│   ├── sync.js             # RTDB listeners, write batching, presence, laser
│   ├── board.js            # Pointer handling, tool switching, selection
│   ├── tools/              # pen.js, eraser.js, sticky.js, shape.js, text.js, image.js, laser.js
│   ├── frames.js           # Frame bar, add/duplicate/reorder/delete
│   ├── render-svg.js       # Live SVG view
│   ├── render-canvas.js    # Thumbnails + export renderer
│   ├── export.js           # PDF + PNG
│   ├── versions.js         # Snapshots + restore
│   ├── fonts.js            # Curated list, on-demand loading, export font readiness
│   ├── theme.js            # cs_theme controller (5 themes)
│   └── dashboard.js        # Teacher dashboard
├── assets/
│   ├── brand-mark.svg|png
│   └── backgrounds/        # dots, lines, squares, graph, chalkboard (SVG patterns)
├── database.rules.json     # RTDB security rules (deployed via Firebase console or CLI)
├── vercel.json             # Clean URLs + security headers
├── README.md               # Short version of Part C + deploy steps
└── docs/
    └── SpaceJam-Project-Plan.md   # This file
```

## B3. Data model

Realtime Database tree (all keys are generated push IDs unless noted):

```
/teachers/{uid}                      { email, name, createdAt }
/allowlist/{emailKey}: true          # teacher emails allowed to sign in as teacher

/joinCodes/{CODE}                    { jamId, assignmentId?, open: true }

/assignments/{assignmentId}
    { ownerUid, title, templateJamId, mode: "class"|"individual"|"groups",
      groupCount?, joinCode, createdAt }

/jams/{jamId}/meta
    { title, ownerUid, assignmentId?, studentName?, groupNumber?,
      locked: false, studentsCanClear: false, isTemplate: false,
      frameOrder: [frameId, ...], createdAt, updatedAt }

/jams/{jamId}/members/{uid}          { name, role: "student"|"teacher", joinedAt }

/jams/{jamId}/frames/{frameId}/meta  { background: "blank"|"dots"|...|"image", bgImage? }
/jams/{jamId}/frames/{frameId}/objects/{objId}
    { type: "sticky"|"text"|"shape"|"image"|"stroke",
      x, y, w, h, rot, z,
      authorUid, authorName, updatedAt, lockedByTeacher?,
      // per type:
      sticky: { text, color, font }
      text:   { text, font, size, color, bold, italic, align }
      shape:  { kind, fill, stroke, strokeWidth }
      image:  { dataUrl }                     # compressed, see B8
      stroke: { points: "x,y x,y ...", tool, color, width } }

/presence/{jamId}/{uid}              { name, frameId, lastSeen }   # onDisconnect removes
/laser/{jamId}/{frameId}/{uid}       { points, t }                 # ephemeral, auto-cleared

/versions/{jamId}/{versionId}        { createdAt, label?, auto: true|false, snapshot: {...} }
```

**Write strategy (keeps traffic and costs low):**
- Dragging, resizing, and rotating update locally at full speed and write to the database **on release**, plus a throttled write every 150 ms during long drags so others see motion.
- Pen strokes write once when the stroke ends, with points simplified (Ramer-Douglas-Peucker) to cut size.
- Typing in a note writes 300 ms after the last keystroke.
- Laser points stream at about 20 updates per second and are deleted after 1.5 seconds.

## B4. Security rules (summary)

Full rules ship in `database.rules.json` and are tested in the Firebase emulator in Phase 6.

| Path | Read | Write |
|---|---|---|
| `/allowlist`, `/teachers` | Teacher only | Owner of record (you, via console) |
| `/joinCodes/{CODE}` | Any signed-in user can read a single code (no listing) | Teacher only |
| `/jams/{id}/members/{uid}` | Members | A user may add **themselves** only if they present an open join code that points to this jam |
| `/jams/{id}/frames/**` | Members + owning teacher | Members, only when `locked == false`; students may only edit or delete objects they authored unless `studentsCanClear` |
| `/jams/{id}/meta` | Members + teacher | Teacher only |
| `/versions/**` | Teacher only | Teacher only (plus auto-snapshot written by the teacher's client or the active member with the lowest uid) |
| `/presence`, `/laser` | Members | Own `uid` node only |

Validation rules also enforce: maximum text length (500 characters per note), maximum image size (300 KB per data URL), allowed `type` values, and the 20-frame limit.

**Cyber note for class discussion:** the Firebase web config in `firebase-config.js` is public by design; security comes entirely from these rules and from auth. That makes SpaceJam a nice real-world example of "the API key isn't the secret."

## B5. Design system application

| Area | Treatment |
|---|---|
| App chrome (topbar, toolbar, menus, dialogs, dashboard) | CyberSpesh v3 tokens only; five themes; `cs_theme` persistence; Inter + JetBrains Mono |
| **The board surface** | Stays a light whiteboard (or chalkboard background) in every theme, framed by a `--line-strong` border, so student work prints and exports cleanly |
| Sticky notes | Fixed `--note-yellow`, `--note-orange`, `--note-pink`, `--note-green`, `--note-blue`, `--note-purple` with soft shadow; dark text |
| Toolbar | Vertical pill on the left, `--surface-2` fill; active tool uses `--primary-soft` fill + `--primary` icon + `aria-pressed="true"` |
| Frame bar | Centered in the topbar: `‹  3 / 8  ›` in JetBrains Mono, expand button opens the thumbnail strip |
| Accessibility floor | 44 px targets, visible focus ring, never color alone (active tool also shows a label tooltip and pressed state), `prefers-reduced-motion` disables rain and laser fade animation |

## B6. Build phases & acceptance criteria

Each phase ends with a deploy to a Vercel preview URL you can open and test.

### Phase 0: Accounts & scaffolding (with you, ~20 min)
- Create GitHub repo `spacejam`.
- Create Firebase project `spacejam-westcta`: enable Realtime Database, Anonymous auth, Google auth; add your email to `/allowlist`.
- Create Vercel project linked to the repo (team `west-cta`).
- **Done when:** a placeholder page loads at the Vercel URL and signs in anonymously (visible in the Firebase console).

### Phase 1: Shell, theming, layout
- CyberSpesh shell, five themes, topbar, left toolbar, frame bar, empty 16:9 board scaled to window.
- **Done when:** all five themes switch cleanly with no stale colors; layout holds from 1280 px Chromebook to 1920 px projector.

### Phase 2: Board engine (single user, local only)
- Selection, move, resize, rotate, multi-select, z-order, duplicate, delete.
- Sticky notes (colors, fonts, auto-fit text), text boxes, shapes, images (upload/drop/paste with compression), pen (4 styles, Shift-line), eraser, laser (local).
- Frames (add, duplicate, delete, reorder, 20 max), backgrounds, zoom, undo/redo, keyboard shortcuts.
- **Done when:** every tool in A4.2 works with no database, and 300 objects on a frame still drag smoothly.

### Phase 3: Rendering & export
- Canvas renderer for thumbnails, PNG, and PDF; waits for fonts before drawing.
- **Done when:** a 20-frame jam with every object type exports to PDF in under 10 seconds and matches the screen.

### Phase 4: Real-time sync
- Join flow (code + name), membership, live object sync, presence avatars, follow-the-teacher, shared laser.
- **Done when:** 30 browser tabs on one jam stay in sync with under 1 second of lag, and reconnecting after Wi-Fi drops loses no work.

### Phase 5: Teacher features
- Google sign-in with allow-list, dashboard, assignments (class / individual / groups), template copies, view-all grid, classroom controls, version history with restore.
- **Done when:** an Individual assignment with 30 joiners creates 30 named copies, all visible live on the dashboard, and a restore brings back a deleted frame.

### Phase 6: Hardening & QA
- Security rules tested in the Firebase emulator (a student can't read another jam, edit a locked jam, or write oversized data).
- Accessibility pass against the CyberSpesh checklist, plus a UX review.
- **Done when:** all rule tests pass and the pre-delivery checklist is complete.

### Phase 7: Launch
- Production deploy, optional custom domain, README, and Part C updated with screenshots.
- **Done when:** you run a live trial with one class period.

## B7. Deployment

1. Push to `main` on GitHub → Vercel builds and deploys automatically (static, no build command).
2. `vercel.json` provides clean URLs (`/board`, `/dashboard`) and headers: `Content-Security-Policy` allowing only self, Google Fonts, cdnjs, gstatic (Firebase SDK), and the Firebase database domain; `X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin`.
3. In Firebase Auth → Authorized domains, add the Vercel domain (and `jam.wctacyber.org` if Q5 is approved).
4. Optional custom domain: Cloudflare CNAME `jam` → `cname.vercel-dns.com`, **DNS-only (grey cloud)**, then add the domain in Vercel.

## B8. Limits, costs & risks

| Item | Detail | Mitigation |
|---|---|---|
| **100 simultaneous connections** on the free Spark plan | Firebase caps the free Realtime Database at 100 concurrent connections, and the cap can't be raised. One class of ~35 is fine. Several full classes at once on different jams could hit it. | If you ever need more, switch the project to the pay-as-you-go Blaze plan (classroom-scale usage typically stays within the free allowance). Dashboard shows a connection count. |
| Free-plan overage | On Spark, exceeding a monthly limit shuts the app off until the next cycle instead of billing you. | Image compression, simplified strokes, batched writes (B3). Usage panel in the Firebase console. |
| **Images** | Cloud Storage for Firebase requires the pay-as-you-go Blaze plan for new projects (Firebase change announced September 2024), so v1 avoids it. | Images are resized in the browser to max 1600 px and stored as compressed JPEG/WebP (≤ 300 KB) inside the database. Limit 10 images per frame. |
| Student naming | Anonymous names can be inappropriate or impersonate classmates. | Teacher sees names in presence, can remove a member, and (if Q3 approved) sees authorship on every object. |
| District policy | Even with no student accounts and minimal data, CCSD may have rules about third-party tools. | Data stored: display names and board content only. Worth a quick check with your tech office before wide rollout. |
| Chromebook performance | Very busy frames can lag on low-end devices. | 300-object performance target in Phase 2; strokes simplified. |

---

# Part C: User Manual

*Planned interface. Screenshots added after the build.*

## C1. Teacher guide

### Sign in
1. Go to the SpaceJam home page.
2. In the **Teachers** box (right side), click **Teacher sign-in**.
3. Choose your Google account. You land on your **Dashboard**. (Your email must be on the allow-list in Firebase; see the README.)

### Create a jam
1. On the Dashboard, click **+ New jam** (top right).
2. Type a title and click **OK**. The board opens with one blank frame.
3. Build your activity: notes, prompts, a background (grid icon in the top bar), and more frames (the **›** arrow on the last frame adds one).

### Assign it to students
1. On the board, click the green **Share** button (top right). On the Dashboard you can also use a jam card's **⋮** menu → **Assign to students…**
2. Pick a mode:
   - **Whole class**: everyone works together on one shared copy.
   - **Individual**: each student gets their own copy, named after them.
   - **Groups**: set the number of groups; students choose their group when they join.
3. Click **Start & get code**. A 6-character **join code** appears.
4. Click **Present code** to show it full-screen on the projector. Students go to the SpaceJam home page and type it in.

### Watch student work live
1. Open the **Dashboard** → **Assignments** tab → click an assignment.
2. Every student or group copy appears as a live thumbnail with who's online and when it last changed.
3. Use **Show frame** (top right) to switch every thumbnail to the same frame.
4. Click a thumbnail to open that copy in a new tab. Hover any object to see who added it.

### Classroom controls
On an assignment copy, click **Share** to open the controls:
- **Lock jam**: view-only for students (they can still use the laser).
- **Students can clear frames and delete others' work**: off by default.
- **Joining open**: turn off to stop new students joining with the code.
- **Remove**: next to a student's name, takes them off the jam.
- **New code**: replaces the join code (the old one stops working).

From the assignment page on the Dashboard you can also **Lock all** / **Unlock all** copies at once, close joining, or delete the whole assignment.

To pin a single object in place, select it → **⋮** → **Lock in place**.

### Version history
1. On the board, click **⋮** (top right) → **Version history**.
2. Click a version on the left to preview every frame.
3. Click **Restore this version**. The current state is saved as a version first, so a restore can always be undone.
4. To bookmark the current state, click **Name current version…**

### Reuse a jam
Your original jams on the Dashboard's **My jams** tab are templates. Assign the same jam as many times as you like; each assignment gets fresh copies. Use **⋮ → Duplicate** to make a variation.

### Export
- **⋮ → Download as PDF**: every frame, one landscape page each.
- **⋮ → Save frame as image**: the current frame as a high-resolution PNG.

## C2. Student guide

### Join a jam
1. Go to the SpaceJam link your teacher gives you.
2. Type the **join code** from the board (capital letters or not, either works).
3. Type your name the way your teacher asks (for example, first name and last initial).
4. Click **Join**. If your teacher made groups, pick your group number and click **Join group**.

### Move between frames
- Use the **‹** and **›** arrows at the top center. On the last frame, **›** adds a new one.
- Click the frame number (for example **2 / 5**) to see every frame as a thumbnail. Drag thumbnails to reorder them.
- Turn on **Follow teacher** (top bar) to jump automatically to whatever frame your teacher is on.

### Add a sticky note
1. Click the **sticky note** icon in the left toolbar (or press **N**).
2. Type your idea, pick a colour, and choose a font if you want.
3. Click **Save**. Drag the note anywhere.
4. To change it later, **double-click** the note.

### Draw
1. Click the **pen** icon. In the bar at the top, choose **Pen**, **Marker**, **Highlighter**, or **Brush**, and a colour.
2. Draw on the board. Hold **Shift** while drawing for a straight line.
3. To erase drawings, click the **eraser** and drag over the lines. The eraser only removes pen drawings; for notes, shapes, and images, select them and press **Delete**.

### Add text, shapes, and images
- **Text box**: click the **T** icon, click on the board, and type. Click anywhere else when you're done. Change font, size, colour, bold, italic, and alignment in the top bar.
- **Shape**: click the shape icon, pick a shape in the top bar, then drag on the board. Hold **Shift** for a perfect circle or square.
- **Image**: click the image icon and choose a file, drag an image file onto the board, or paste one with **Ctrl+V**.

### Move, resize, and rotate
1. Click the **arrow** (Select) icon, or hold **Ctrl** with any tool.
2. Click an object. Drag it to move; drag a square handle to resize; drag the round handle on top to rotate (hold **Shift** to snap to 15°).
3. Drag across empty space to select several objects. Click the white **⋮** button for Duplicate, Bring to front, Send to back, Move to frame, or Delete.

### Point at something
Click the **laser** icon and drag across the board. Everyone on that frame sees the glowing line, which fades by itself.

### Save your work
Everything saves automatically. To keep a copy, click **⋮** → **Download as PDF** or **Save frame as image**.

### Change the colours of SpaceJam
Click the **palette** icon (top right) and pick Matrix, Arctic, Crimson Ops, Tokyo, or Galaxy. Your choice carries over to other CyberSpesh apps.

## C3. Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Undo / Redo | Ctrl+Z / Ctrl+Y |
| Copy / Paste / Duplicate | Ctrl+C / Ctrl+V / Ctrl+D |
| Delete selected | Delete or Backspace |
| Temporarily switch to Select | Hold Ctrl |
| Straight line with pen | Hold Shift while drawing |
| Select all on frame | Ctrl+A |
| Next / previous frame | Page Down / Page Up |
| Zoom in / out / fit | Ctrl+= / Ctrl+− / Ctrl+0 |
| New sticky note | N |
| Pen / Eraser / Select / Text / Laser / Shape / Image | P / E / V / T / L / S / I |
| Nudge selected | Arrow keys (Shift+Arrow = 10× step) |

## C4. Troubleshooting

| Problem | Fix |
|---|---|
| "Code not found" | Check for typos. Codes never contain 0, O, 1, or I. Ask your teacher whether joining is closed. |
| I can't edit anything | The teacher locked the jam. |
| My notes disappeared | Ask your teacher. They can restore from Version history. |
| Board is slow | Close other tabs. Very busy frames can lag on older Chromebooks. |
| "Connecting…" banner | Your Wi-Fi dropped. Keep working; changes sync when it reconnects. |
| "You can't open this jam" | You haven't joined it yet, or your teacher removed you. Join again with the code. |
| Teacher: sign-in says "not on the allow-list" | Add your email to `allowlist` in Firebase (README, step 6). |
| Teacher: students can't connect | You may have hit the free plan's 100-connection limit (see B8). |

---

## Approval checklist

Approved by Rob on October 23, 2026:

- [x] Q1 Real-time collaboration: **yes**
- [x] Q2 Light mode: **five dark themes only, light board surface**
- [x] Q3 Teacher-only author tracking: **yes**
- [x] Q4 Teacher sign-in: **Google + allow-list**
- [x] Q5 Domain: **jam.wctacyber.org**
- [x] Q6 Auto-cleanup: **none**
- [x] Q7 Name: **SpaceJam**
- [x] Feature list A4 approved (strike anything you don't want)
- [x] Curated font list approved
- [x] Out-of-scope list A5 approved
- [x] Architecture B1 (Firebase + vanilla JS + Vercel) approved

Build completed through Phase 6. Phase 7 (launch) needs the Firebase setup in the README.
