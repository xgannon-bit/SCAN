import { spawnSync } from "node:child_process";
import path from "node:path";
export function authoredPreparation() {
  const python = process.env.SCAN_PYTHON || path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(python, ['-c', 'import json\nfrom workers.scan.tests.test_native_preparation import fixtures\nj,m,p=fixtures()\nprint(json.dumps({"job":j.decode(),"master":m.decode(),"pcb":p.decode()}))'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Authored fixture generation failed');
  return JSON.parse(result.stdout);
}
