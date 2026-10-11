"""Derived synthetic starter tests never establish real Eagle compatibility."""
import unittest
from xml.etree import ElementTree as ET

from workers.scan.native_preparation import automatic_plan, apply_preparation, recipe_digest, component_accounting
from workers.scan.tests.test_paired_terminal_constructor import fixture
from workers.scan.snapshot_capture import CaptureBlocked
from workers.scan.native_seed_requirements import seed_requirements


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

    def test_self_closing_starter_collections_do_not_hide_the_missing_seed(self):
        job, master, pcb, profile = fixture()
        j, m = ET.fromstring(job), ET.fromstring(master)
        j.find('PartDataList').clear()
        m.find('PartDataList').clear()
        m.find('WindowDataList').clear()
        job, master = ET.tostring(j), ET.tostring(m)
        plan = automatic_plan(job, master, pcb, [profile])
        self.assertFalse(any(i['status'] == 'ready-for-review' for i in plan['items']))
        report = seed_requirements(job, master, [profile])
        self.assertEqual(report['status'], 'held')
        self.assertEqual(report['emptyContainerInsertion'], 'supported-serialization-only')
        self.assertTrue(all(c['serialization'] == 'self-closing' and c['status'] == 'supported' for c in report['containers']))
        self.assertEqual({r['id'] for r in report['requiredContents'] if r['state'] == 'missing'},
                         {'placement-seed', 'master-seed', 'window-seeds'})
        self.assertEqual(report['profileSeeds'][0]['status'], 'held')
        self.assertEqual(report['genuineStarterQualification'], 'not-performed')

    def test_sparse_native_windows_identify_exact_missing_seed_and_never_copy_unknown_schema(self):
        job, master, pcb, profile = fixture()
        root = ET.fromstring(master)
        windows = root.find('WindowDataList')
        windows.remove(windows[1])
        sparse = ET.tostring(root)
        report = seed_requirements(job, sparse, [profile])
        self.assertEqual(report['status'], 'selected-seed-held')
        self.assertEqual(report['profileSeeds'][0]['code'], 'PACKAGE_WINDOW_SEED')
        self.assertEqual(next(i for i in automatic_plan(job, sparse, pcb, [profile])['items'] if i['reference'] == 'N1')['status'], 'held')
        root = ET.fromstring(master)
        ET.SubElement(root.find('PartDataList/PartData'), 'UnqualifiedAssetReference').text = 'synthetic-opaque-link'
        report = seed_requirements(job, ET.tostring(root), [profile])
        self.assertEqual(report['profileSeeds'][0]['code'], 'PREPARATION_SCHEMA')

    def test_synthetic_untaught_seed_is_sufficient_structure_without_any_algorithm_default(self):
        job, master, pcb, profile = fixture()
        j, m = ET.fromstring(job), ET.fromstring(master)
        j.find('PartDataList/PartData/ENABLE').text = 'False'
        for w in m.findall('WindowDataList/WindowData'):
            w.find('AlgorithmDataList').clear()
            w.find('ENABLE').text = 'False'
        job, master = ET.tostring(j), ET.tostring(m)
        report = seed_requirements(job, master, [profile])
        self.assertEqual(report['profileSeeds'][0]['status'], 'supported-structure-only')
        self.assertTrue(report['noUniversalSeed'])
        plan = automatic_plan(job, master, pcb, [profile])
        item = next(i for i in plan['items'] if i['reference'] == 'N1')
        self.assertEqual(item['status'], 'ready-for-review')
        recipe = {**plan, 'accepted': [item['digest']]}
        output = apply_preparation(job, master, pcb, recipe, recipe_digest(recipe))
        self.assertEqual(output, apply_preparation(job, master, pcb, recipe, recipe_digest(recipe)))
        self.assertFalse(ET.fromstring(output['master']).findall('.//AlgorithmData'))
        with self.assertRaises(CaptureBlocked) as held:
            apply_preparation(output['job'], output['master'], pcb, recipe, recipe_digest(recipe))
        self.assertEqual(held.exception.code, 'PREPARATION_STALE')

    def test_wrong_version_and_missing_module_stay_explicit_holds(self):
        job, master, _, profile = fixture()
        report = seed_requirements(job.replace(b'10.2', b'99.1', 1), master, [profile])
        self.assertEqual(report['status'], 'held')
        self.assertEqual(report['containers'][0]['code'], 'UNSUPPORTED_SCHEMA')
        root = ET.fromstring(job)
        root.find('ModuleDataList').clear()
        report = seed_requirements(ET.tostring(root), master, [profile])
        self.assertEqual(report['status'], 'held')
        self.assertEqual(report['requiredContents'][0]['state'], 'missing')
        self.assertEqual(report['profileSeeds'][0]['status'], 'held')

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
