# Fictional walkthrough and presentation controls

Visit `/demo`, or use **Explore synthetic demo** in the foundation shell.
Open a fictional session, select a placement, view its evidence, review the
before/after annotation and simulate Accept or Reject. The resulting demo debug
item retains that exact identity. Decisions can be revisited; one item per
finding shows the current simulated decision.

Every view says **SYNTHETIC DEMO — NOT REAL JOB ANALYSIS**. All fixtures were
authored for this walkthrough; no source file is opened, parsed or changed.
The static board drawing is fictional and not to scale. No coordinate fitting,
pad association, pan/zoom engine or native repair writer is implemented.

The three stable placement IDs distinguish module, side and placement. Two Top
placements named R7 belong to different modules. A Bottom U3 placement adds an
explicit side example. Selection and decisions use unique finding IDs, never
RefDes matching. Evidence, review and queue entries render the same fixture's
full identity.

Only the current browser session holds demo state. Browser Back/Forward changes
the stage and preserves in-memory selection; refreshing resets the session,
selection and decisions. **Restart demo** does the same without refreshing,
including when returning through browser history. Presenter notes can be hidden;
they follow the current stage. No local storage or database is used.

## Three-minute presentation

1. Open `/demo`. Show the synthetic label and open the fictional session.
2. Select MODULE-A / Top / R7 and view the authored evidence and its limits.
3. Review the annotation and simulate Accept. The queue shows that exact identity.
4. Use **Review next unreviewed finding**, then simulate Reject for MODULE-B's R7.
   The two R7 choices remain independent. This shortcut selects a finding; it never
   decides on the presenter's behalf.
5. Show the review counts and unknown taught/verified/released states. Download
   the review record or print the queue, then use **Restart demo** for another run.

## Review record and printing

Once at least one finding has a simulated decision, **Download review record
(.json)** creates a `scan.synthetic-review-record` version 1 file locally in the
browser. It contains all three identities, current choices (including Unreviewed),
authored evidence and proposed annotations, source and capability limits, and
the generation time. It is separate from the analyzer protocol and from any real
ProgrammingSessionRecord. The fixed DEMO-SESSION-001 identifies the fixture, not
a uniquely captured manufacturing session. Source hash and snapshot remain null.

The report is a current-state record, not a chronological audit history. Revisited
choices replace earlier simulated choices. Downloaded files survive restart and
refresh; browser state does not. The browser chooses the destination and may
prompt for it. No upload or report API is used. A failed download leaves the
review choices available for retry.

**Print review queue** invokes the browser's print dialog. The paper layout shows
the current queue, synthetic label, counts, unknown coverage and export limits;
navigation, presenter notes and action buttons are omitted. Only reviewed items
appear in the printed queue; the JSON includes unreviewed items as well. Printing
does not imply machine or release approval.

## Windows launch

From this checkout in PowerShell:

```powershell
.\scripts\start-demo.ps1 -CheckOnly
.\scripts\start-demo.ps1
```

The preflight checks Node/npm, the installed Next dependency and loopback port
availability. It neither builds nor starts a server. Normal launch performs those
checks, builds current source, and starts production SCAN at
`http://127.0.0.1:3210/demo` with telemetry disabled. Keep the terminal open and
use Ctrl+C to stop. Use `-Port 3211` if 3210 belongs to another running process;
the launcher does not terminate other processes. If SCAN already runs from this
same checkout, use that server or stop it from its own terminal first. A different
port still shares the build directory, so the launcher blocks a second run from
this checkout, including during the first launcher's build. Do not manually run
`npm run build` against a server that is still using that checkout's build output.
A failed build prevents startup.
The launcher does not install packages; use `npm ci` separately if dependencies
are missing. No execution-policy or firewall changes are required by the script.

Acceptance records a simulated choice only. It cannot verify geometry, teach an
inspection, validate a candidate or grant release. Coverage states stay separate;
the represented count is the number of fictional illustrated placements, while
enabled/taught/verified/released remain unknown. Machine-job export remains
disabled because captured sources, qualified writers and compatibility evidence
are absent. This does not complete A14–A21 or their backend prerequisites.

Validation uses `npm run check`, the existing A03 Python regression, and
`npm run test:e2e` against the freshly built production server. The added browser
tests cover all stages, duplicate-RefDes isolation, both decisions, bottom-side
identity, queue updates, refresh reset, Back/Forward, keyboard navigation,
reduced motion, visible labels, overflow and disabled export. Additional tests
cover presenter notes, next-unreviewed navigation, complete and empty queues,
actual JSON download contents, download failure, print media, and explicit reset
with browser history. Report unit tests verify evidence and identity boundaries.
No dependencies were added for the demo or its presentation controls.
