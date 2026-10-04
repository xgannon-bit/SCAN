import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const syntheticMembers = {
  'Fictional/Board/Board.xml': '<FictionalJob version="invented-1"><Opaque>NOT A NATIVE JOB</Opaque></FictionalJob>',
  'Fictional/Board/Board_Temp.xml': '<FictionalTemp />',
  'Fictional/Board/Board.xml.bak': '<FictionalBackup />',
  'Fictional/Master/Master.xml': '<FictionalMaster />',
  'Fictional/Master/Master_Temp.xml': '<FictionalTempMaster />',
  'README.txt': 'Wholly authored example. Not a machine job.',
};
export const syntheticSelection = { root: 'Fictional/Board', jobMember: 'Fictional/Board/Board.xml', jobRole: 'main', masterMember: 'Fictional/Master/Master.xml', masterRole: 'main' };
export function makeArchive(members = syntheticMembers) {
  const python = process.env.SCAN_PYTHON || path.join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const generated = spawnSync(python, ['-c', 'import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w",compression=zipfile.ZIP_STORED) as z:\n for name,content in json.loads(sys.stdin.read()).items(): z.writestr(zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0)),content.encode())\nsys.stdout.buffer.write(b.getvalue())'], { input: JSON.stringify(members), maxBuffer: 20_000_000 });
  if (generated.status !== 0) throw new Error('Synthetic archive generation failed');
  return generated.stdout;
}
