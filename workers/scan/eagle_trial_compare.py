"""Read-only comparison of explicitly selected copied Eagle trial snapshots.

No machine access, edits, qualification authority or menu assumptions. The
operator records one action per saved copy; observed deltas require review.
"""
import argparse
from collections import Counter
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET
import zipfile

from .qualification_candidate import _xml, _fail
from .snapshot_capture import CaptureBlocked


def _archive(path, selection):
    with zipfile.ZipFile(path) as z:
        infos=z.infolist()
        if len(infos)>20_000 or sum(i.file_size for i in infos)>500_000_000 or any(i.flag_bits & 1 for i in infos):
            _fail('EAGLE_TRIAL_LIMIT','Trial archive exceeds its bounds or is encrypted.')
        names=[i.filename for i in infos]
        if len(set(names))!=len(names) or any('\\' in n or ':' in n or n.startswith('/') or '..' in PurePosixPath(n).parts for n in names):
            _fail('EAGLE_TRIAL_ARCHIVE','Ambiguous or unsafe trial members.')
        hashes={}
        for info in infos:
            h=sha256()
            with z.open(info) as f:
                while chunk:=f.read(1024*1024):h.update(chunk)
            hashes[info.filename]=h.hexdigest()
        documents=[]
        for key in ('jobMember','masterMember'):
            name=selection[key]
            if name not in names or z.getinfo(name).file_size>16_000_000:
                _fail('EAGLE_TRIAL_SELECTION','Both exact main documents must be present and bounded.')
            raw=z.read(name);_xml(raw);documents.append(ET.fromstring(raw))
        return documents,hashes


def _semantic(node):
    # Ignore indentation/tails only, never unknown fields or child order.
    return [node.tag,sorted(node.attrib.items()),(node.text or '').strip(),[_semantic(n) for n in node]]


def _records(root):
    result={}
    for container in root:
        if container.tag not in {'PartDataList','WindowDataList'}:
            if (container.tag,) in result:_fail('EAGLE_TRIAL_IDENTITY','Repeated top-level native container cannot be compared safely.')
            result[(container.tag,)]=_semantic(container);continue
        for n in container:
            if n.tag=='WindowData':key=(container.tag,n.findtext('ParentId'),n.findtext('ID'))
            elif n.tag=='PartData':key=(container.tag,n.findtext('MasterKey'),n.findtext('ID'))
            else:key=(container.tag,n.tag)
            if key in result:_fail('EAGLE_TRIAL_IDENTITY','Repeated native record scope cannot be compared safely.')
            result[key]=_semantic(n)
    return result


def _fields(node, paths):
    out={}
    for path in paths:
        rows=node.findall(path)
        if len(rows)!=1 or len(rows[0]) or rows[0].attrib:
            out[path]={'state':'missing-or-repeated-or-complex','count':len(rows)}
        else:out[path]={'state':'literal','value':rows[0].text or ''}
    return out


def _same_values(a,b):
    if set(a)!=set(b):return False
    for k in a:
        if a[k]['state']!='literal' or b[k]['state']!='literal':return False
        av,bv=a[k]['value'],b[k]['value']
        if av==bv:continue
        try:
            da,db=Decimal(av),Decimal(bv)
            if not da.is_finite() or not db.is_finite() or da!=db:return False
        except InvalidOperation:return False
    return True


def compare_trial(before, after, selection, targets, stage, eagle_build):
    if set(selection)-{'root'}!={'jobMember','masterMember'} or any(not isinstance(selection[k],str) or not selection[k] for k in ('jobMember','masterMember')):
        _fail('EAGLE_TRIAL_SELECTION','Select exact main job/Master member names; no snapshot inference.')
    if stage not in {'no-edit-control','open-save','one-binding','one-fov','one-teaching','reopen'} or not isinstance(eagle_build,str) or not eagle_build.strip() or len(eagle_build)>256:
        _fail('EAGLE_TRIAL_STAGE','Record the exact Eagle build and single controlled stage.')
    if not isinstance(targets,list) or not 1<=len(targets)<=20:
        _fail('EAGLE_TRIAL_IDENTITY','Select one to twenty exact representative identities.')
    for t in targets:
        if not isinstance(t,dict) or set(t)!={'reference','moduleId','partId','masterKey'} or any(not isinstance(v,str) or not v or len(v)>2048 for v in t.values()):
            _fail('EAGLE_TRIAL_IDENTITY','Every representative needs exact reference/module/Part/Master identity.')
    if len({t['partId'] for t in targets})!=len(targets):_fail('EAGLE_TRIAL_IDENTITY','Representative Part IDs must be unique.')
    (bj,bm),bh=_archive(before,selection);(aj,am),ah=_archive(after,selection)
    parts=[]
    for t in targets:
        snapshots=[]
        for j,m in [(bj,bm),(aj,am)]:
            p=[n for n in j.findall('PartDataList/PartData') if n.findtext('ID')==t['partId']]
            model=[n for n in m.findall('PartDataList/PartData') if n.findtext('MasterKey')==t['masterKey']]
            cad=[n for n in j.findall('CadData/CpList/Cp') if n.findtext('ModuleID')==t['moduleId'] and n.findtext('RefID')==t['reference']]
            if len(p)!=1 or len(model)!=1 or len(cad)!=1 or (p[0].findtext('RefID'),p[0].findtext('ParentId'),p[0].findtext('MasterKey'))!=(t['reference'],t['moduleId'],t['masterKey']) or model[0].findtext('RefID')!=t['reference']:
                _fail('EAGLE_TRIAL_IDENTITY','Selected identity changed, is absent or ambiguous; no positional fallback.')
            ws=[n for n in m.findall('WindowDataList/WindowData') if n.findtext('ParentId')==t['masterKey']]
            if len({n.findtext('ID') for n in ws})!=len(ws):_fail('EAGLE_TRIAL_IDENTITY','Repeated window ID in selected Master.')
            snapshots.append({'placement':_fields(p[0],['Roi/'+k for k in ('cx','cy','w','h','a')]+['CenterPosX','CenterPosY','ptSetPolarPos/X','ptSetPolarPos/Y']),
                'cad':_fields(cad[0],['X','Y','Ang']),
                'model':_fields(model[0],['Roi/'+k for k in ('cx','cy','w','h','a')]+['CadOffset/X','CadOffset/Y']),
                'windows':{n.findtext('ID'):_fields(n,['RelRoi/'+k for k in ('cx','cy','w','h','a')]+['ParentWndId','AlignWndID','GroupID']) for n in ws},
                'binding':_fields(p[0],[n.tag for n in p[0] if n.tag=='WND_PAD' or n.tag.startswith(('ListGerPadId','ListGerbPadId'))]),
                'fov':{name:[_semantic(node) for node in p[0].findall(name)] for name in ('FovList','SubFovNum','FovOPT')},
                'placementDisabled':p[0].findtext('ENABLE')=='False',
                'allWindowsDisabled':all(n.findtext('ENABLE')=='False' for n in ws),
                'algorithmCount':sum(len(n.findall('AlgorithmDataList/AlgorithmData')) for n in ws)})
        x,y=snapshots
        parts.append({**t,'before':x,'after':y,'placementNumericRetained':_same_values(x['placement'],y['placement']),
            'cadNumericRetained':_same_values(x['cad'],y['cad']),'modelNumericRetained':_same_values(x['model'],y['model']),
            'windowGeometryAndLinksRetained':set(x['windows'])==set(y['windows']) and all(_same_values(x['windows'][k],y['windows'][k]) for k in x['windows']),
            'bindingChanged':x['binding']!=y['binding'],'fovChanged':x['fov']!=y['fov'],
            'unexpectedEnablingObserved':not y['placementDisabled'] or not y['allWindowsDisabled'],
            'inspectionQualified':False})
    changes={}
    for name,x,y in [('job',bj,aj),('master',bm,am)]:
        old,new=_records(x),_records(y)
        changes[name]=[{'scope':list(k),'change':'added' if k not in old else 'removed' if k not in new else 'changed'} for k in sorted(old.keys()|new.keys(),key=str) if old.get(k)!=new.get(k)]
    assets=[{'member':n,'beforeSha256':bh.get(n),'afterSha256':ah.get(n)} for n in sorted(bh.keys()|ah.keys()) if bh.get(n)!=ah.get(n)]
    return {'artifactType':'scan.eagle-trial-comparison','schemaVersion':'1','stage':stage,'eagleBuild':eagle_build,
        'status':'evidence-requires-engineering-review','parts':parts,'nativeRecordChanges':changes,'archiveMemberChanges':assets,
        'noEditControlRequiredSeparately':stage!='no-edit-control','geometryRetainedForAllSelected':all(p['placementNumericRetained'] and p['cadNumericRetained'] and p['modelNumericRetained'] and p['windowGeometryAndLinksRetained'] for p in parts),
        'unrelatedWorkPreserved':False,'qualificationGranted':False,'bindingSemanticsQualified':False,'fovSemanticsQualified':False,
        'inspectionQualified':False,'nativeEditsApplied':False,'machineExportAllowed':False}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('before','after','selection','targets','output','stage','eagle-build'):p.add_argument('--'+name,required=True)
    args=p.parse_args()
    try:
        for name in ('selection','targets'):
            if Path(getattr(args,name)).stat().st_size>100_000:_fail('EAGLE_TRIAL_LIMIT','Selection or identity file exceeds its bound.')
        result=compare_trial(args.before,args.after,json.loads(Path(args.selection).read_text(encoding='utf-8')),json.loads(Path(args.targets).read_text(encoding='utf-8')),args.stage,args.eagle_build)
        with Path(args.output).open('x',encoding='utf-8') as f:json.dump(result,f,indent=2,allow_nan=False)
        print(json.dumps({'status':result['status'],'selectedParts':len(result['parts']),'geometryRetained':result['geometryRetainedForAllSelected'],'qualificationGranted':False}))
    except (CaptureBlocked,KeyError,ValueError,OSError,ET.ParseError,zipfile.BadZipFile) as e:
        print(json.dumps({'status':'blocked','code':e.code if isinstance(e,CaptureBlocked) else 'EAGLE_TRIAL_INPUT','privateContentsLogged':False}));raise SystemExit(1)


if __name__=='__main__':main()
