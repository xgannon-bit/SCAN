# Windows desktop launch and restart

The current-user **Open SCAN** shortcut uses `scripts/desktop-scan.ps1` and an
on-demand Windows task. `Install` creates the task and shortcuts; `Open` reuses
a healthy server or starts the task. Neither operation installs dependencies.

Readiness requires a verified server for this checkout on `127.0.0.1:3210`, a
successful dashboard response, and successful responses for every advertised
local Next.js JavaScript and CSS asset. Each asset must have its expected content
type and nonempty content. An HTTP 200 page containing “SCAN” alone is insufficient.
These checks establish asset availability, not browser hydration or worker health.

If a server serves old HTML whose assets are missing, save the current project
before restarting. From the checkout, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/desktop-scan.ps1 -Mode Restart
```

Add `-NoBrowser` to avoid opening a browser tab. Restart verifies the existing
task's action, working directory and current-user principal. It checks that every
Next.js process from this checkout is the expected local `start` operation on
port 3210, owned by the same user. It then stops that task and any matching server
left behind, checking process creation time again before stopping it. Merely
stopping a Windows scheduled task can leave its Node.js child alive.

Restart refuses other ports, development/build processes, different owners,
unknown port listeners or changed process identities. It does not kill a process
tree or unrelated Node.js applications, delete tasks, or change task settings.
Stop any conflicting process from its own launcher and retry. The existing
`start-demo.ps1` mutex and same-checkout process guard still apply: another port
shares `.next`, so a running server must not be left alive during a rebuild.
After the verified server stops, the existing task rebuilds and starts current
source. Allow up to three minutes for readiness. A failed build leaves SCAN stopped.

Logs stay under `%LOCALAPPDATA%\SCAN\desktop-server`:

- `launcher.log` records UTC timestamps, operation, readiness failures, task
  starts/stops and verified server process IDs. Missing asset URLs are included.
- `server-yyyyMMdd-HHmmss.log` contains the task's build/server transcript.

The launcher requests only the local dashboard and its local static assets. It
does not read project files, original manufacturing inputs, or expected-output
archives. Preserve browser work with **Save project**; server restart does not
persist the in-memory browser session automatically.

Launcher unit tests extract function definitions and mock Windows tasks,
processes and HTTP responses. They do not restart the installed application.
