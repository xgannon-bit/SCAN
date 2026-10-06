"""Authored window identities and graph shapes; no private native examples."""
from copy import deepcopy
import unittest
from xml.etree import ElementTree as ET

from workers.scan.native_window_subset import closed_window_subset
from workers.scan.snapshot_capture import CaptureBlocked


def window(wid, parent='0', align='', group='0'):
    node = ET.Element('WindowData')
    for key, value in {'ID': wid, 'ParentWndId': parent, 'AlignWndID': align, 'GroupID': group,
                       'ENABLE': 'True', 'ParentId': 'AuthoredMaster'}.items():
        ET.SubElement(node, key).text = value
    rectangle = ET.SubElement(node, 'RelRoi')
    for key, value in {'cx': '2.75', 'cy': '-3.5', 'w': '1.8', 'h': '0.6', 'a': '90'}.items():
        ET.SubElement(rectangle, key).text = value
    algorithms = ET.SubElement(node, 'AlgorithmDataList')
    ET.SubElement(algorithms, 'AuthoredOpaqueTeaching').text = 'preserve in original'
    return node


def ids(result):
    return [node.findtext('ID') for node in result['retained']]


class NativeWindowSubsetTests(unittest.TestCase):
    def test_complete_set_is_noop_and_retains_exact_objects_bytes_and_local_links(self):
        windows = [window('Root'), window('Child', parent='Root', group='11'),
                   window('Aligned', align='Child', group='11')]
        before = [ET.tostring(node) for node in windows]
        result = closed_window_subset(windows)
        self.assertTrue(result['complete'])
        self.assertEqual(result['omitted'], [])
        self.assertEqual(result['remaining'], [])
        self.assertEqual(ids(result), ['Root', 'Child', 'Aligned'])
        self.assertTrue(all(a is b for a, b in zip(result['retained'], windows)))
        self.assertEqual([ET.tostring(node) for node in windows], before)
        self.assertEqual(closed_window_subset(result['retained']), result)

    def test_external_parent_removes_children_and_alignment_dependents(self):
        windows = [window('Bad', parent='Absent'), window('Safe'), window('Child', parent='Bad'),
                   window('Align', align='Child'), window('Last', parent='Align')]
        result = closed_window_subset(windows)
        self.assertEqual(ids(result), ['Safe'])
        reasons = {item['windowId']: item['reasons'] for item in result['omitted']}
        self.assertIn('external-parent-window', reasons['Bad'])
        self.assertIn('omitted-parent-window', reasons['Child'])
        self.assertIn('omitted-align-window', reasons['Align'])
        self.assertIn('omitted-parent-window', reasons['Last'])
        self.assertFalse(result['complete'])
        self.assertEqual(result['remaining'], ['native-window-subset-incomplete', 'omitted-window-creation-and-teaching-required'])

    def test_external_alignment_and_both_bad_links_have_exact_reasons(self):
        result = closed_window_subset([window('Safe'), window('B', parent='MissingParent', align='MissingAlign')])
        omitted = result['omitted'][0]
        self.assertEqual(omitted['reasons'], ['external-alignment-window', 'external-parent-window'])
        self.assertEqual(omitted['relatedWindowIds'], ['MissingAlign', 'MissingParent'])
        self.assertEqual(omitted['templateWindowOrdinal'], 2)

    def test_parent_cycles_self_cycles_and_their_dependents_are_removed(self):
        windows = [window('Safe'), window('A', parent='B'), window('B', parent='C'), window('C', parent='A'),
                   window('Self', parent='Self'), window('Child', parent='A'), window('Align', align='Self')]
        result = closed_window_subset(windows)
        self.assertEqual(ids(result), ['Safe'])
        by_id = {item['windowId']: item for item in result['omitted']}
        for wid in ['A', 'B', 'C', 'Self']:
            self.assertIn('parent-window-cycle', by_id[wid]['reasons'])
        self.assertIn('omitted-parent-window', by_id['Child']['reasons'])
        self.assertIn('omitted-align-window', by_id['Align']['reasons'])

    def test_nonzero_groups_remove_atomically_and_cascade_across_groups(self):
        windows = [window('Root'), window('Bad', parent='Missing', group='17'), window('Peer', group='17'),
                   window('Cross', align='Peer', group='21'), window('CrossPeer', group='21'),
                   window('Unaffected', group='44'), window('UnaffectedPeer', parent='Unaffected', group='44')]
        result = closed_window_subset(windows)
        self.assertEqual(ids(result), ['Root', 'Unaffected', 'UnaffectedPeer'])
        by_id = {item['windowId']: item for item in result['omitted']}
        self.assertIn('affected-nonzero-window-group', by_id['Peer']['reasons'])
        self.assertIn('omitted-align-window', by_id['Cross']['reasons'])
        self.assertIn('affected-nonzero-window-group', by_id['CrossPeer']['reasons'])
        self.assertEqual({item['groupId'] for item in result['omitted']}, {'17', '21'})

    def test_zero_group_is_not_an_atomic_group(self):
        result = closed_window_subset([window('Bad', parent='Absent'), window('Unaffected')])
        self.assertEqual(ids(result), ['Unaffected'])
        self.assertEqual(len(result['omitted']), 1)

    def test_partial_subset_preserves_originals_and_is_complete_when_rechecked(self):
        windows = [window('LeadA', group='10'), window('LeadB', group='10'), window('Unsupported', parent='Missing', group='50')]
        before = [ET.tostring(node) for node in windows]
        result = closed_window_subset(windows)
        self.assertEqual(ids(result), ['LeadA', 'LeadB'])
        self.assertEqual([ET.tostring(node) for node in windows], before)
        self.assertTrue(all(node.findtext('ENABLE') == 'True' and len(node.find('AlgorithmDataList')) == 1 for node in windows))
        self.assertTrue(closed_window_subset(result['retained'])['complete'])
        self.assertEqual(result['omitted'], closed_window_subset(windows)['omitted'])
        cloned = deepcopy(result['retained'][0])
        cloned.find('ENABLE').text = 'False'
        cloned.find('AlgorithmDataList').clear()
        self.assertEqual([ET.tostring(node) for node in windows], before)

    def test_all_removed_refuses_including_cycle_or_atomic_group(self):
        for windows in [[window('Only', parent='Missing')], [window('A', parent='B'), window('B', parent='A')],
                        [window('Bad', align='Missing', group='12'), window('Peer', group='12')], []]:
            with self.subTest(count=len(windows)), self.assertRaises(CaptureBlocked) as caught:
                closed_window_subset(windows)
            self.assertEqual(caught.exception.code, 'PREPARATION_WINDOW_LINK')

    def test_ambiguous_identity_and_relationship_scalars_refuse_without_first_wins(self):
        duplicate_field = window('Different'); ET.SubElement(duplicate_field, 'ParentWndId').text = 'Hidden'
        attributed = window('Attributed'); attributed.find('AlignWndID').set('unknown', 'link')
        for windows in [[window('A'), window('A')], [window('Safe'), duplicate_field], [window('Safe'), attributed],
                        [window('Safe'), window('ZeroLeading', group='01')], [window('0')]]:
            with self.assertRaises(CaptureBlocked): closed_window_subset(windows)

    def test_bound_and_long_chain_cascade_are_deterministic(self):
        windows = [window('Anchor')]
        windows.extend(window(f'Node{i}', parent='Missing' if i == 1 else f'Node{i-1}') for i in range(1, 256))
        result = closed_window_subset(windows)
        self.assertEqual(ids(result), ['Anchor'])
        self.assertEqual(len(result['omitted']), 255)
        self.assertEqual(result['omitted'][-1]['windowId'], 'Node255')
        with self.assertRaises(CaptureBlocked): closed_window_subset(windows + [window('OverBound')])


if __name__ == '__main__':
    unittest.main()
