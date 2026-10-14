"""Only independently authored native fixtures. Telemetry is not qualification."""
import contextlib
import io
import json
import unittest
from unittest.mock import patch
from workers.scan import qualification_candidate as writer
from workers.scan.native_preparation import automatic_plan, apply_preparation, recipe_digest
from workers.scan.tests.test_native_preparation import fixtures
from workers.scan.tests import test_reviewed_placement as authored
from workers.scan.snapshot_capture import CaptureBlocked


class ComponentProgressTests(unittest.TestCase):
    def test_actual_diagnosis_emits_started_then_checked_or_held_without_changing_report(self):
        from workers.scan.tests.test_native_placement_diagnosis import setup
        from workers.scan.native_placement_diagnosis import diagnose
        data, _, _, _ = setup()
        expected = diagnose(**data)
        stream = io.StringIO()
        with patch.dict('os.environ', {'SCAN_COMPONENT_PROGRESS': '1'}), contextlib.redirect_stderr(stream):
            actual = diagnose(**data)
        self.assertEqual(actual, expected)
        events = [json.loads(line.removeprefix('SCAN_COMPONENT_V1 ')) for line in stream.getvalue().splitlines()]
        self.assertEqual(len(events), 2 * len(actual['rows']))
        for i, row in enumerate(actual['rows']):
            start, finish = events[i*2:i*2+2]
            self.assertEqual(start['kind'], 'analysis-started')
            self.assertIn(finish['kind'], ('analysis-checked', 'analysis-held'))
            self.assertEqual(start['geometry']['identity']['id'], row['identity']['ID'])
            self.assertEqual(start['geometry']['before'], finish['geometry']['before'])

    def test_guarded_paired_edit_reports_one_exact_component_only_on_forward_checked_operation(self):
        fixture = authored.ReviewedPlacementTests(); fixture.setUp()
        try:
            request = fixture.request(xy=True); stream = io.StringIO()
            with patch.dict('os.environ', {'SCAN_COMPONENT_PROGRESS': '1'}), contextlib.redirect_stderr(stream):
                changed = writer._patch_xml(fixture.raw, request['proposals'], progress=True)
                self.assertEqual(writer._patch_xml(changed, writer.reverse_proposals(request['proposals'])), fixture.raw)
            lines = stream.getvalue().splitlines(); self.assertEqual(len(lines), 1)
            event = json.loads(lines[0].removeprefix('SCAN_COMPONENT_V1 '))
            self.assertEqual(event['geometry']['before']['x'], 12.5)
            self.assertEqual(event['geometry']['after']['x'], 13.75)
            self.assertEqual(event['geometry']['after']['y'], 7.875)
            self.assertEqual(event['geometry']['identity']['id'], 'part-fiction-17')
            stream = io.StringIO()
            with patch.dict('os.environ', {'SCAN_COMPONENT_PROGRESS': '1'}), contextlib.redirect_stderr(stream), self.assertRaises(CaptureBlocked):
                writer._patch_xml(changed, request['proposals'], progress=True)
            self.assertEqual(stream.getvalue(), '')
        finally:
            fixture.tearDown()

    def test_preparation_only_emits_accepted_component_after_closure_and_preservation(self):
        job, master, pcb = fixtures(); plan = automatic_plan(job, master, pcb)
        ready = [i for i in plan['items'] if i['status'] == 'ready-for-review']
        recipe = {**plan, 'accepted': [ready[0]['digest']]}; stream = io.StringIO()
        with patch.dict('os.environ', {'SCAN_COMPONENT_PROGRESS': '1'}), contextlib.redirect_stderr(stream):
            expected = apply_preparation(job, master, pcb, recipe, recipe_digest(recipe))
            changed = apply_preparation(job, master, pcb, recipe, recipe_digest(recipe), progress=True)
        self.assertEqual(changed, expected)
        events = [json.loads(line.removeprefix('SCAN_COMPONENT_V1 ')) for line in stream.getvalue().splitlines()]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['kind'], 'preparation-checked')
        self.assertEqual(events[0]['geometry']['identity']['ref'], ready[0]['reference'])
        self.assertIsNone(events[0]['geometry']['before'])
