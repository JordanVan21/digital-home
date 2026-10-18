# Running the app

The app has three parts that talk through a shared Supabase project:

```
iPhone app (apps/ios)  --uploads scan-->  Supabase
worker (apps/worker)   --turns scans into rooms + furniture-->  Supabase
sandbox (apps/web)     --opens rooms, lets you edit them-->  Supabase
```

You scan a room on the phone, the worker builds a 3D room from it, and the room
shows up in the sandbox in your browser.

## 1. One-time setup (Mac)

1. Install **Node** 20 or newer and **pnpm** 10 (`npm install -g pnpm@10`).
2. Install the packages, from the repo root:
   ```sh
   pnpm install
   ```
3. Create the secrets file: copy `.env.example` to `.env` at the repo root and
   fill in the values (ask a teammate for them). **Never commit `.env`.**
4. For the worker only: install **Blender** (`brew install --cask blender`). The
   worker starts and stops it by itself.

## 2. Open the sandbox (browser)

```sh
pnpm dev
```

Open the address it prints (usually http://127.0.0.1:5173). The demo rooms work
right away. To see your scanned rooms, click **Sign in** in the top bar and use
the same email and password as the iPhone app.

## 3. Run the worker (turns scans into rooms)

```sh
pnpm worker
```

Leave it running. It picks up each new scan, builds the room in a few seconds
(furniture matched from the library), then improves pieces that didn't match
well in the background. New rooms appear in the sandbox by themselves.

- **Only run one worker at a time** (on any machine).
- Process waiting scans once and stop: `pnpm worker:once`
- Rebuild every scan, e.g. after adding new furniture models:
  `pnpm --filter @house/worker once -- --reprocess`

## 4. Run the iPhone app

Needs a **LiDAR iPhone** (12 Pro or newer Pro) on iOS 17+, a cable, and Xcode.

1. Open `apps/ios/HouseScanner.xcodeproj` in Xcode.
   - The project file is not in git. If it's missing, create it with
     `brew install xcodegen && cd apps/ios && xcodegen generate`, then pick your
     **Team** under Signing & Capabilities. Running `xcodegen` again later wipes
     the team setting, so only do it when the project is missing.
2. Plug in the phone, choose it as the run destination, and press **Command-R**.
3. In the app: sign in (or create an account), scan a room, and upload it. With
   the worker running, the room opens in the sandbox shortly after.

More detail: `apps/ios/SETUP.md`.

## 5. Design my space (aesthetic planner)

Run the planner API next to the sandbox (it reads the same `.env`):

```sh
pnpm --filter @house/planner-server dev
```

Then click **Design my space** in the sandbox top bar (or open
`/?planner-lab`). Pick a room and a style, then **Run design experiment**.
**Catalog demo** works offline with real models but scripted choices; **Live AI**
needs you signed in and the worker running. Your saved room is never changed.

## 6. Add furniture models to the library

New models added to `packages/contracts/src/catalog.json` (files under
`apps/web/public/`) must be uploaded to Supabase before scans can use them:

```sh
node --env-file=.env scripts/seed-assets.mjs feature/integration
```

Replace `feature/integration` with whichever branch has the new models (it reads
files from that branch; no checkout needed). Run it in your own Terminal. It is
safe to rerun: existing models are overwritten, not duplicated. If the
connection is shaky it retries, and lists anything it had to skip.

## 7. Checks before pushing

```sh
pnpm test                # sandbox unit tests
pnpm typecheck           # sandbox types
pnpm test:pipeline       # converter, asset service, render agent tests
pnpm typecheck:pipeline  # worker and pipeline types
pnpm lint
cd apps/ios && swift test
```

## Good to know

- Supabase project: `synyznfvklhsosnaivno`. Database changes live in
  `supabase/migrations/`; both migrations (including `asset_requests`, the
  planner → worker furniture queue) are applied on the hosted project.
- Only the public anon key is in the code. The service-role and AI keys live
  only in `.env`.
- Deeper docs: `agent_docs/` (architecture, data contracts, Supabase plan) and
  `docs/SESSION_NOTES.md` (sandbox dev notes).
