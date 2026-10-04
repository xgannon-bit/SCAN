# A01-DEMO-01: fictional walkthrough

Visit `/demo`, or use **Explore synthetic demo** in the foundation shell.
Open a fictional session, select a placement, view its evidence, review the
before/after annotation and simulate Accept or Reject. The resulting demo debug
item retains that exact identity. Decisions can be revisited; one item per
finding shows the current simulated decision.

Every view says **SYNTHETIC DEMO — NOT REAL JOB ANALYSIS**. All fixtures were
authored for this walkthrough; no file is opened, parsed, changed or exported.
The static board drawing is fictional and not to scale. No coordinate fitting,
pad association, pan/zoom engine or native repair writer is implemented.

The three stable placement IDs distinguish module, side and placement. Two Top
placements named R7 belong to different modules. A Bottom U3 placement adds an
explicit side example. Selection and decisions use unique finding IDs, never
RefDes matching. Evidence, review and queue entries render the same fixture's
full identity.

Only the current browser session holds demo state. Browser Back/Forward changes
the stage and preserves in-memory selection; refreshing resets the session,
selection and decisions. No local storage, database or download is used.

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
reduced motion, visible labels, overflow and disabled export. No dependencies
were added for the demo.
