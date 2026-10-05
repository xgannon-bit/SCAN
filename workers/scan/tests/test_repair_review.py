import json
from pathlib import Path
import unittest
import zipfile

from workers.scan.archive_browser_cli import dispatch
from workers.scan.tests import test_qualification_candidate as fixture_module


class BrowserRepairTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture_module.QualificationCandidateTests()
        self.fixture.setUp()
        self.request = self.fixture.request()
        source = self.request['source']
        self.control = {'protocolVersion': '1', 'action': 'preflight', 'source': str(self.fixture.source),
                        'expectedArchiveSha256': source['archiveSha256'],
                        'selection': {'root': source['root'], 'jobMember': source['jobMember'], 'jobRole': 'main', 'masterMember': None, 'masterRole': None}}
        report = dispatch(self.control)
        self.assertEqual(report['status'], 'success', report)
        self.control['expectedPackageSha256'] = report['capture']['packageSha256']
        # Each browser request has an owned fresh directory; remove only this
        # known test capture to model the next isolated request.
        (self.fixture.root / 'result.scan-snapshot').unlink()

    def tearDown(self):
        self.fixture.tearDown()

    def test_review_export_preserves_source_and_exports_actual_accepted_set(self):
        reviewed = dispatch({**self.control, 'action': 'repair-review', 'repair': {'request': self.request}})
        self.assertEqual(reviewed['status'], 'success', reviewed)
        self.assertEqual(reviewed['request']['acceptances'][0]['decision'], 'pending')
        self.assertFalse((self.fixture.root / 'result.engineering.zip').exists())
        (self.fixture.root / 'result.scan-snapshot').unlink()
        reviewed['request']['acceptances'][0]['decision'] = 'accepted'
        result = dispatch({**self.control, 'action': 'repair-export', 'repair': {'request': reviewed['request'], 'acknowledgement': 'QUALIFICATION ONLY'}})
        self.assertEqual(result['status'], 'success', result)
        self.assertEqual(self.fixture.source.read_bytes(), self.fixture.original)
        with zipfile.ZipFile(self.fixture.root / 'result.engineering.zip') as output:
            self.assertIn('CANDIDATE.zip', output.namelist())
            self.assertIn('component_coverage.csv', output.namelist())
            self.assertEqual(json.loads(output.read('applied_changes.json')), self.request['proposals'])
            self.assertEqual(json.loads(output.read('qualification.json'))['eagleOpenSaveReopen'], 'not-performed')

    def test_missing_acknowledgement_publishes_nothing(self):
        result = dispatch({**self.control, 'action': 'repair-export', 'repair': {'request': self.request}})
        self.assertEqual(result['code'], 'ACKNOWLEDGEMENT_REQUIRED')
        self.assertFalse((self.fixture.root / 'result.engineering.zip').exists())

    def test_binding_and_stale_before_are_held(self):
        self.request['proposals'][0]['before'] = 'incorrect'
        result = dispatch({**self.control, 'action': 'repair-review', 'repair': {'request': self.request}})
        self.assertEqual(result['code'], 'STALE_BEFORE')
        (self.fixture.root / 'result.scan-snapshot').unlink()
        self.request['proposals'][0]['path'] = 'JobContainer/PartDataList/PartData[1]/WND_PAD'
        result = dispatch({**self.control, 'action': 'repair-review', 'repair': {'request': self.request}})
        self.assertEqual(result['code'], 'BINDING_HELD')
