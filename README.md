# SpaceJam

A collaborative classroom whiteboard modeled on Google Jamboard (retired Dec 31, 2024), styled with the CyberSpesh Design System v3. Students join with a 6-character code: no accounts, no email. Teachers sign in with Google, build jams, hand out codes, and watch every student or group work live.

- **Live:** Vercel (auto-deploys from `main`)
- **Stack:** static HTML/CSS/vanilla JS (no build step) + Firebase Realtime Database & Authentication
- **Full spec, build guide, and user manual:** [`docs/SpaceJam-Project-Plan.md`](docs/SpaceJam-Project-Plan.md)

## Features

- Frames (up to 20), sticky notes with 6 colours and 32 Google Fonts, pen / marker / highlighter / brush, eraser, shapes and arrows, text boxes, images, laser pointer
- Move, resize, rotate, multi-select, duplicate, layer order, move to another frame, undo/redo, keyboard shortcuts
- Backgrounds: blank, dots, lines, squares, graph, chalkboard, or your own image (teacher-only, locked)
- Assign as **whole class**, **individual** (a copy per student), or **groups**
- Teacher dashboard with live thumbnails of every copy, presence, lock/unlock, close joining, new code, present code full-screen
- Version history with preview and restore; auto-saves every 5 minutes
- Export to PDF (all frames) or PNG (one frame)
- Five themes: Matrix, Arctic, Crimson Ops, Tokyo, Galaxy (shared `cs_theme` key with other CyberSpesh apps)

## Try it right now (demo mode)

With `js/firebase-config.js` left empty, SpaceJam runs in **local demo mode**: everything is stored in your browser and syncs between tabs on the same computer. Open the site, click **Continue as demo teacher**, make a jam, assign it, then open a second tab and join with the code as a student.

## Going live: Firebase setup (about 15 minutes)

You only do this once. Firebase's free **Spark** plan is enough for classroom use.

1. **Create the project.** Go to <https://console.firebase.google.com> → **Create a project** → name it `spacejam-westcta` → turn **Google Analytics** off → **Create project**.

2. **Turn on sign-in.** Left menu → **Build** → **Authentication** → **Get started** → **Sign-in method** tab:
   - Click **Anonymous** → toggle **Enable** → **Save**. (Students.)
   - Click **Google** → toggle **Enable** → pick your support email → **Save**. (Teachers.)

3. **Allow your site's address.** Still in Authentication → **Settings** tab → **Authorized domains** → **Add domain**. Add your Vercel address (for example `spacejam-xxxx.vercel.app`) and, if you use it, `jam.wctacyber.org`.

4. **Create the database.** Left menu → **Build** → **Realtime Database** → **Create Database** → choose **United States (us-central1)** → **Start in locked mode** → **Enable**.

5. **Install the security rules.** In Realtime Database, open the **Rules** tab → delete what's there → paste the entire contents of [`database.rules.json`](database.rules.json) → **Publish**.

6. **Add yourself as a teacher.** Open the **Data** tab. Hover the top (root) line → click **+**:
   - **Key:** `allowlist` (leave Value empty) → click the **+** on that new row.
   - **Key:** your email in lowercase with every **dot changed to a comma**, for example `robert,speciale@gmail,com`
   - **Value:** `true` → **Add**.
   Repeat the last step for any other teacher who should be able to sign in.

7. **Connect the website to Firebase.** Click the **gear** (top left) → **Project settings** → **General** → scroll to **Your apps** → click the **`</>`** (Web) icon → nickname `SpaceJam` → leave Hosting unchecked → **Register app**. Copy these five values from the `firebaseConfig` it shows into [`js/firebase-config.js`](js/firebase-config.js):
   `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`.
   (These values are public by design. Security comes from the rules in step 5.)

8. **Deploy.** Commit and push to `main`. Vercel redeploys automatically. Open the site: the "Local demo mode" banner is gone, and **Teacher sign-in** now opens Google.

### Optional: custom domain `jam.wctacyber.org`

1. Vercel → project **spacejam** → **Settings** → **Domains** → add `jam.wctacyber.org`.
2. Cloudflare → `wctacyber.org` → **DNS** → **Add record**: Type `CNAME`, Name `jam`, Target `cname.vercel-dns.com`, Proxy status **DNS only** (grey cloud).
3. Add `jam.wctacyber.org` to Firebase **Authorized domains** (step 3).

## Limits worth knowing

| Limit | Detail |
|---|---|
| 100 simultaneous connections | Firebase's free plan caps the Realtime Database at 100 connected browsers at once. One or two full classes is fine. If several classes use SpaceJam at the same moment, upgrade the Firebase project to the pay-as-you-go **Blaze** plan. |
| Images | Shrunk in the browser to about 300 KB each, 10 per frame. Stored in the database, so no Cloud Storage (which needs the paid plan) is required. |
| Frames | 20 per jam, like the original. |

## Project layout

```
index.html        Join page + teacher sign-in
board.html        The whiteboard
dashboard.html    Teacher dashboard
css/              cyberspesh.css (design system v3) + app.css
js/               board.js, dashboard.js, join.js, db.js (Firebase / demo), jams.js, render.js,
                  textfit.js, export.js (PDF/PNG), fonts.js, model.js, ui.js, util.js, icons.js, theme.js
database.rules.json   Realtime Database security rules
vercel.json           Clean URLs + security headers (CSP)
docs/                 Project plan, build guide, user manual
```

## Development notes

- No build step: any static server works (`python3 -m http.server`).
- To develop against the Firebase Emulator Suite, set `USE_EMULATORS = true` in `js/firebase-config.js` (auth on 9099, database on 9000).
- The Firebase SDK version is pinned in `js/firebase-config.js` (`FIREBASE_SDK_VERSION`). If you change it, also allow it in `vercel.json`'s CSP if the host changes.
