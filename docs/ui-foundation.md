# A01 local UI foundation

The shell uses official shadcn Base UI components (base-nova style), Tailwind
4/PostCSS and lucide icons. It keeps SCAN semantic tokens and system fonts.
Live Open Job, Analyze and machine-job export are unavailable. The A03 ZIP
inventory worker is not connected to the frontend. Unknown coverage is not zero.

## Reproduce on Windows

Verified toolchain: Node 24.18.0, npm 11.16.0 and Python 3.14.6 via `py -3`.
Dependencies are exact-pinned in package.json and resolved by npm's lockfile.
Use an isolated local checkout outside cloud-sync or production directories.

```powershell
$env:NEXT_TELEMETRY_DISABLED = '1'
npm ci
npm run check
py -3 -m unittest discover -s workers/scan/tests -p "test_*.py" -v
py -3 -m compileall workers/scan
git diff --check
npm audit
npm audit --omit=dev
.\node_modules\.bin\playwright.cmd install chromium
npm run test:e2e
npm run start
```

The app listens at http://127.0.0.1:3210. Check port occupancy first; if another
app owns it, set `SCAN_PORT` to a free port. Do not terminate unrelated processes.
The existing launcher binds only to loopback. Stop a foreground server with
Ctrl+C. Playwright starts its own production server with `reuseExistingServer:
false`, so stop your own foreground server before browser acceptance, or select
a different free `SCAN_PORT`. Run the production build before browser tests.

`typecheck` generates Next route types before running strict TypeScript, allowing
a fresh checkout to typecheck without a previous build. No TypeScript checks were
relaxed. Browser projects cover 1440x900, 1280x800 and 390x844, keyboard focus,
capability limits, separate unknown coverage, primitive styling, reduced motion,
page/console errors, loopback-only requests and document overflow.

Set `SCAN_EVIDENCE_DIR` to a directory outside the repository for screenshots and
failure traces. Default test-results and browser report directories are ignored.
These checks establish local laptop UI acceptance, not machine compatibility,
engineering-PC acceptance, diagnostic validity or release authority.

## Dependency provenance and unresolved advisory

The selected shadcn CLI is 4.21.0. Its installed help uses preset `nova` with
`--base base --no-monorepo`; components.json records style `base-nova`. The CLI
needed a minimal Next config for existing-framework detection. Initialization
added a Google font and changed its own dependency to a range; both generated
changes were corrected to preserve system fonts and the selected exact pin.
Button, Badge, Tooltip and Separator came from the official ui.shadcn.com
registry. Their MIT notice is retained in `docs/shadcn-license.txt`.

As checked on 2026-10-03, full `npm audit` reports six high affected nodes from
one unresolved development-tool advisory: braces <=3.0.3 can exhaust the Node
stack with deeply nested patterns. No patched braces version is available.
The chain is braces -> micromatch -> fast-glob -> ts-morph/shadcn. Every affected
node is development-only; `npm audit --omit=dev` reports zero vulnerabilities.
Do not feed untrusted glob patterns to the development CLI. No automatic audit
fix, forced downgrade, fabricated override or runtime workaround was applied.

References:
- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- https://ui.shadcn.com/docs/installation/next
- https://ui.shadcn.com/docs/cli
- https://ui.shadcn.com/docs/components/base/button
- https://tailwindcss.com/docs/installation/framework-guides/nextjs
- https://base-ui.com/react/components/tooltip

The npm esbuild lifecycle-script warning remains informational: its optional
platform binary supports the passing protocol tests. No install-script security
policy was changed. No hosted CI or remote service is part of this setup.
