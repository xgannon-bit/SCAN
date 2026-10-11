"""Authored container examples; not a machine starter-format qualification."""
import unittest
from xml.etree import ElementTree as ET

from workers.scan.native_record_insertion import collection_layout, append_records, rollback_records
from workers.scan.snapshot_capture import CaptureBlocked


PART = 'JobContainer/PartDataList'
WINDOW = 'JobContainer/WindowDataList'


def document(part=b'<PartDataList/>', window=b'<WindowDataList />'):
    return (b'\xef\xbb\xbf<?xml version="1.0" encoding="utf-8"?>\r\n<JobContainer>'
            b'<JobXmlVersion>10.2</JobXmlVersion>\r\n<!-- untouched -->' + part +
            '<Other keep="true">invented \u03bc &amp; raw</Other>'.encode() + window + b'</JobContainer>')


class RecordInsertionTests(unittest.TestCase):
    def test_self_closing_and_explicit_empty_spellings_have_identical_records_and_exact_rollback(self):
        for part in (b'<PartDataList/>', b'<PartDataList />', b'<PartDataList\r\n/>',
                     b'<PartDataList></PartDataList>', b'<PartDataList>\r\n<!-- keep --></PartDataList>'):
            with self.subTest(opening=part):
                raw = document(part)
                current, edits = append_records(raw, {PART: [b'<PartData><ID>37</ID></PartData>'],
                                                      WINDOW: [b'<WindowData><ID>54</ID></WindowData>']})
                root = ET.fromstring(current)
                self.assertEqual(root.findtext('PartDataList/PartData/ID'), '37')
                self.assertEqual(root.findtext('WindowDataList/WindowData/ID'), '54')
                self.assertEqual(rollback_records(current, edits), raw)
                self.assertEqual(current, append_records(raw, {PART: [b'<PartData><ID>37</ID></PartData>'],
                                                             WINDOW: [b'<WindowData><ID>54</ID></WindowData>']})[0])
                self.assertIn('<Other keep="true">invented \u03bc &amp; raw</Other>'.encode(), current)

    def test_sparse_unknown_existing_record_fields_remain_exact_bytes(self):
        old = b'<PartData odd="preserve"><Unqualified><![CDATA[opaque <>]]></Unqualified></PartData>'
        raw = document(b'<PartDataList>\r\n' + old + b'\r\n</PartDataList>')
        current, edits = append_records(raw, {PART: [b'<PartData><ID>37</ID></PartData>']})
        self.assertIn(old, current)
        self.assertEqual(len(ET.fromstring(current).findall('PartDataList/PartData')), 2)
        self.assertEqual(rollback_records(current, edits), raw)
        # Serialization does not validate this old record as a usable seed.
        self.assertEqual(collection_layout(raw, [PART])[PART].record_count, 1)

    def test_no_record_insertion_is_byte_exact_noop(self):
        raw = document()
        self.assertEqual(append_records(raw, {}), (raw, []))
        self.assertEqual(append_records(raw, {PART: []}), (raw, []))

    def test_tampered_insert_cannot_be_rolled_back_as_if_unchanged(self):
        current, edits = append_records(document(), {PART: [b'<PartData><ID>37</ID></PartData>']})
        with self.assertRaises(CaptureBlocked) as held:
            rollback_records(current.replace(b'<ID>37</ID>', b'<ID>38</ID>'), edits)
        self.assertEqual(held.exception.code, 'DRAFT_ROLLBACK')

    def test_missing_duplicate_attributed_unknown_or_mixed_collections_hold(self):
        for part in (b'', b'<PartDataList/><PartDataList/>', b'<PartDataList future="1"/>',
                     b'<PartDataList><Unknown/></PartDataList>', b'<PartDataList>not a record</PartDataList>'):
            with self.subTest(part=part), self.assertRaises(CaptureBlocked):
                append_records(document(part), {PART: [b'<PartData/>']})

    def test_wrong_version_namespaces_and_record_kinds_hold(self):
        for raw in (document().replace(b'10.2', b'12.0'), document().replace(b'<JobContainer>', b'<JobContainer xmlns="unknown">')):
            with self.assertRaises(CaptureBlocked):
                append_records(raw, {PART: [b'<PartData/>']})
        for record in (b'<WindowData/>', b'<PartData/><PartData/>', b'not XML', b''):
            with self.assertRaises(CaptureBlocked):
                append_records(document(), {PART: [record]})
        with self.assertRaises(CaptureBlocked):
            append_records(document(), {'JobContainer/Unknown': [b'<PartData/>']})


if __name__ == '__main__':
    unittest.main()
