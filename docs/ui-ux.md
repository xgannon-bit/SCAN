# SCAN UI / UX foundation

Use the same dark manufacturing-console visual language as the companion release-control application, with independent SCAN workflow and state. The reusable token definitions are in styles/scan-tokens.css. This is a design foundation, not a rendered or accessibility-tested application.

## Visual system

Deep navy background, slate panels and borders, cyan active/primary controls, light foreground text, compact readable evidence tables and restrained motion. Desktop sidebar target: 228px; sticky context header target: 80px. Rounded panels target: 10px. Use locally available system fonts; do not fetch fonts at runtime. Prefer semantic tokens to repeated hex literals. Respect reduced-motion preferences, visible focus, contrast and keyboard operation.

## Primary workflow

Open Job -> Select Snapshot -> Analyze -> Review Findings -> Review Changes -> Export Debug Queue or supported Candidate.

The main workspace has a findings list, large board viewer and an evidence/next-action panel. Clicking a finding selects the exact side/module/reference/placement, not every component with the same name. Display source, proposed and saved candidate states distinctly. CAD, Gerber, part ROI, window and image layers have independent toggles and a persistent legend.

## Navigation

Jobs, Board Workspace, Findings, Repair Review, Debug Queue, Library Evidence, History, Settings. Build only screens that have real behavior; hide future placeholders or label unavailable controls. Preserve browser Back/Forward, selection and zoom across inspection tasks where possible.

## Status semantics

Show counts for represented, enabled, taught, verified and released separately. Keep unknown distinct from zero and disabled distinct from absent. Use text and icons in addition to color. Do not invent a job health percentage. A finding-free run does not confer release.

Every recommendation shows the evidence, coordinate frame, source revision, affected identity, proposed change and why it is allowed or blocked. Keep destructive/global actions out of the primary path. The default candidate writer state is unavailable until its adapter safety gate passes.

## First visual acceptance

Check desktop and narrow-window layouts; keyboard focus; unreadable/long IDs; pan/zoom without editing geometry; loading, empty, unsupported and blocked states; reduced motion; no network requirement; and no synthetic demonstration presented as analysis of a real file.
