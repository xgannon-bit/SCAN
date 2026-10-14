"""Invented FOV identities and permuted routes; no private camera geometry."""
from hashlib import sha256
import unittest

from workers.scan.native_fov import fov_assignments


def fixture(cameras, values=('0', '1')):
    parts = ''.join(f'<PartData><ID>{i+1}</ID><ParentId>m</ParentId><MasterKey>{i+9}</MasterKey><RefID>F{i+1}</RefID><FovList><Fov0>{value}</Fov0></FovList></PartData>' for i, value in enumerate(values))
    return ('<JobContainer><JobXmlVersion>10.1</JobXmlVersion><PartDataList>'+parts+'</PartDataList><FovSetInfo><Fov>'+cameras+'</Fov></FovSetInfo></JobContainer>').encode()


def report(raw):
    return fov_assignments(raw, {'selection': {'job': {'sha256': sha256(raw).hexdigest()}}})


class FovDomainTests(unittest.TestCase):
    def test_permuted_ids_and_paths_retain_different_centers_and_enb(self):
        raw = fixture('<FovInfo><Id>0</Id><PathId>1</PathId><C>17,19</C><CtnMdID>m</CtnMdID><Enb>True</Enb></FovInfo>'
                      '<FovInfo><Id>1</Id><PathId>0</PathId><C>71,91</C><CtnMdID>m</CtnMdID><Enb>False</Enb><ENABLE>legacy-literal</ENABLE></FovInfo>')
        result = report(raw)
        self.assertEqual(result['status'], 'recorded'); self.assertFalse(result['coverageQualified']); self.assertFalse(result['nativeAssignmentWritten'])
        self.assertEqual(result['counts']['coverageVerified'], 0)
        self.assertEqual(result['cameraRecords'][0]['rawFields']['Enb'], ['True'])
        self.assertEqual(result['cameraRecords'][1]['rawFields']['ENABLE'], ['legacy-literal'])
        self.assertEqual(result['domainReviewCounts']['conflicting-domain-candidates'], 2)
        first = result['assignments'][0]['cameraDomainCandidates'][0]
        self.assertEqual(first['state'], 'conflicting-domain-candidates'); self.assertIsNone(first['chosenDomain'])
        self.assertEqual(first['idMatches'][0]['centerLiterals'], ['17,19'])
        self.assertEqual(first['pathIdMatches'][0]['centerLiterals'], ['71,91'])
        self.assertEqual(first['idMatches'][0]['enableLiterals'], ['True'])
        self.assertEqual(first['pathIdMatches'][0]['enableLiterals'], ['False'])
        self.assertTrue(all(a['nativeIdMeaning'] == 'unqualified' and a['enabledExecution'] == 'unverified' for a in result['assignments']))
        self.assertEqual(result, report(raw))

    def test_unique_domain_equality_and_no_match_never_qualify_selection(self):
        raw = fixture('<FovInfo><Id>3</Id><PathId>3</PathId><C>8,9</C><Enb>1</Enb></FovInfo>'
                      '<FovInfo><Id>4</Id><PathId>5</PathId><C>10,11</C><Enb>0</Enb></FovInfo>', ('3', '4', '5', 'missing', '04'))
        result = report(raw); states = [a['cameraDomainCandidates'][0]['state'] for a in result['assignments']]
        self.assertEqual(states, ['same-record-in-both-observed-domains', 'id-literal-only-candidate', 'path-id-literal-only-candidate', 'no-literal-domain-candidate', 'no-literal-domain-candidate'])
        self.assertTrue(all(a['cameraDomainCandidates'][0]['chosenDomain'] is None for a in result['assignments']))

    def test_repeated_identity_is_observed_as_ambiguous_not_first_wins(self):
        raw = fixture('<FovInfo><Id>0</Id><Id>0</Id><PathId>8</PathId><C>17,19</C><Enb>True</Enb></FovInfo>'
                      '<FovInfo><Id>0</Id><PathId>9</PathId><C>71,91</C><Enb>False</Enb></FovInfo>', ('0',))
        result = report(raw); row = result['assignments'][0]['cameraDomainCandidates'][0]
        self.assertEqual(len(row['idMatches']), 2); self.assertEqual(row['state'], 'ambiguous-repeated-domain-literal'); self.assertIsNone(row['chosenDomain'])

    def test_unsafe_enable_or_excessive_candidates_return_no_partial_report(self):
        raw = fixture('<FovInfo><Id>0</Id><PathId>1</PathId><Enb><Nested>True</Nested></Enb></FovInfo>', ('0',))
        result = report(raw); self.assertEqual(result['status'], 'unavailable'); self.assertEqual(result['cameraRecords'], []); self.assertEqual(result['assignments'], [])
        raw = fixture(''.join(f'<FovInfo><Id>0</Id><PathId>{i}</PathId><C>{i},0</C><Enb>True</Enb></FovInfo>' for i in range(65)), ('0',))
        result = report(raw); self.assertEqual(result['status'], 'unavailable'); self.assertEqual(result['cameraRecords'], []); self.assertEqual(result['assignments'], [])


if __name__ == '__main__':
    unittest.main()
