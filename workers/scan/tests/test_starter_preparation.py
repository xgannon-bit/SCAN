"""Synthetic stripped starters test refusal, not real Eagle compatibility."""
import unittest
from xml.etree import ElementTree as ET

from workers.scan.native_preparation import automatic_plan, apply_preparation, recipe_digest, component_accounting
from workers.scan.tests.test_paired_terminal_constructor import fixture
from workers.scan.snapshot_capture import CaptureBlocked


class StarterPreparationTests(unittest.TestCase):
    def test_no_programmed_records_does_not_invent_template_or_seed(self):
        job, master, pcb, profile = fixture()
        j, m = ET.fromstring(job), ET.fromstring(master)
        j.find('PartDataList').clear()
        m.find('PartDataList').clear()
        m.find('WindowDataList').clear()
        for tag, value in [('BoardImage', 'opaque-authored-image'), ('BoardColor', 'authored-color'), ('FiducialSetup', 'authored-fiducials')]:
            ET.SubElement(j, tag).text = value
        job, master = ET.tostring(j, short_empty_elements=False), ET.tostring(m, short_empty_elements=False)
        for profiles in ([], [profile]):
            with self.subTest(profile=bool(profiles)):
                plan = automatic_plan(job, master, pcb, profiles)
                self.assertFalse(any(i['status'] == 'ready-for-review' for i in plan['items']))
                self.assertTrue(all(r['status'] == 'held-no-supported-template' for r in component_accounting(job, plan)))
                recipe = {**plan, 'accepted': []}
                with self.assertRaises(CaptureBlocked) as refused:
                    apply_preparation(job, master, pcb, recipe, recipe_digest(recipe))
                self.assertEqual(refused.exception.code, 'PREPARATION_APPROVAL')
        plan = automatic_plan(job, master, pcb, [profile])
        held = next(i for i in plan['items'] if i['reference'] == 'N1')
        self.assertEqual(held['status'], 'held')
        self.assertIn('identity', held['reason'].lower())

    def test_self_closing_starter_collections_report_unsupported_insertion(self):
        job, master, pcb, profile = fixture()
        j, m = ET.fromstring(job), ET.fromstring(master)
        j.find('PartDataList').clear()
        m.find('PartDataList').clear()
        m.find('WindowDataList').clear()
        with self.assertRaises(CaptureBlocked) as held:
            automatic_plan(ET.tostring(j), ET.tostring(m), pcb, [profile])
        self.assertEqual(held.exception.code, 'DRAFT_CONTAINER')

    def test_partly_programmed_job_preserves_teaching_and_does_not_require_it_on_new_part(self):
        job, master, pcb, profile = fixture()
        plan = automatic_plan(job, master, pcb, [profile])
        ready = next(i for i in plan['items'] if i['reference'] == 'N1')
        recipe = {**plan, 'accepted': [ready['digest']]}
        changed = apply_preparation(job, master, pcb, recipe, recipe_digest(recipe))
        for role, before in [('job', job), ('master', master)]:
            original, output = ET.fromstring(before), ET.fromstring(changed[role])
            for container in ('PartDataList', 'WindowDataList'):
                prior = original.find(container)
                if prior is None:
                    continue
                current = output.find(container)
                for old, new in zip(prior, current):
                    self.assertEqual(ET.tostring(old), ET.tostring(new))
        added = ET.fromstring(changed['job']).findall('PartDataList/PartData')[-1]
        self.assertEqual(added.findtext('ENABLE'), 'False')
        self.assertEqual(added.findtext('WND_PAD') or '', '')
        for window in ET.fromstring(changed['master']).findall('WindowDataList/WindowData')[-3:]:
            self.assertEqual(len(window.find('AlgorithmDataList')), 0)
            self.assertEqual(window.findtext('ENABLE'), 'False')


if __name__ == '__main__':
    unittest.main()
