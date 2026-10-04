from io import BytesIO
import unittest

from workers.scan.native_records import read_native_records


def read(xml):
    raw = xml.encode('utf-8')
    return read_native_records(BytesIO(raw), len(raw))


def job(content='', version='10.2'):
    # Wholly authored values. A record-profile fixture, not an Eagle-created job.
    return f'<JobContainer><JobXmlVersion>{version}</JobXmlVersion>{content}</JobContainer>'


class NativeRecordsTests(unittest.TestCase):
    def test_raw_values_and_record_roles_are_not_converted_to_native_semantics(self):
        report = read(job('<ModuleDataList><ModuleData><ID>m-fiction</ID><TB>unmapped-side</TB></ModuleData></ModuleDataList>'
                          '<PartDataList><PartData><ID>0007</ID><RefID>SYNTH-R99</RefID><Roi><cx>001.2500</cx><a>-090</a></Roi>'
                          '<ENABLE>invented-flag</ENABLE><UnknownProtected>keep-in-original</UnknownProtected></PartData></PartDataList>'
                          '<WindowDataList><WindowData><ID>fake-window</ID><ParentId>0007</ParentId></WindowData></WindowDataList>'
                          '<CadData><CpList><Cp><ID>fake-cad</ID><X>1e-3</X></Cp></CpList></CadData>'))
        self.assertEqual(report['status'], 'recorded')
        self.assertEqual([r['kind'] for r in report['records']], ['module-record', 'part-record', 'window-record', 'cad-record'])
        part = report['records'][1]
        self.assertEqual(part['rawFields']['ID'], ['0007'])
        self.assertEqual(part['rawFields']['Roi/cx'], ['001.2500'])
        self.assertEqual(part['rawFields']['ENABLE'], ['invented-flag'])
        self.assertNotIn('UnknownProtected', part['rawFields'])
        self.assertFalse(report['nativeSchemaQualified'])
        self.assertFalse(report['machineExportAllowed'])
        self.assertIn('unverified', report['coordinateInterpretation'])

    def test_duplicate_fields_are_kept_and_reported_not_overwritten(self):
        report = read(job('<PartDataList><PartData><ID>one</ID><ID>two</ID></PartData><PartData><ID>one</ID></PartData></PartDataList>'))
        self.assertEqual(report['records'][0]['rawFields']['ID'], ['one', 'two'])
        self.assertEqual(len(report['duplicateScalarFields']), 1)
        self.assertNotEqual(report['records'][0]['sourcePath'], report['records'][1]['sourcePath'])

    def test_unqualified_version_namespace_and_missing_version_are_unsupported(self):
        for source in (job(version='11.0'), '<JobContainer/>', '<Other/>', '<JobContainer xmlns="urn:invented"><JobXmlVersion>10.2</JobXmlVersion></JobContainer>', job('<JobXmlVersion>10.2</JobXmlVersion>')):
            with self.subTest(source=source):
                report = read(source)
                self.assertEqual(report['status'], 'unsupported')
                self.assertEqual(report['records'], [])

    def test_malformed_forbidden_nested_scalar_and_oversized_fields_block_without_values_in_error(self):
        for source in ('<Broken', '<!DOCTYPE x [<!ENTITY a "PRIVATE_MARKER">]><JobContainer/>', job('<PartDataList><PartData><ID><nested>PRIVATE_MARKER</nested></ID></PartData></PartDataList>'), job('<PartDataList><PartData><Name>' + 'Q'*2049 + '</Name></PartData></PartDataList>')):
            with self.subTest(source=source[:60]):
                report = read(source)
                self.assertEqual(report['status'], 'blocked')
                self.assertEqual(report['records'], [])
                self.assertNotIn('PRIVATE_MARKER', str(report))

    def test_absent_collection_is_zero_records_without_claiming_zero_population(self):
        report = read(job())
        self.assertEqual(report['status'], 'recorded')
        self.assertEqual(report['countsByRecordKind']['part-record'], 0)
        self.assertIn('not programmed', report['coverageInterpretation'])

    def test_record_byte_and_count_limits_block(self):
        self.assertEqual(read_native_records(BytesIO(b''), 16_000_001)['status'], 'blocked')
        report = read(job('<PartDataList>' + '<PartData/>' * 10001 + '</PartDataList>'))
        self.assertEqual(report['status'], 'blocked')

    def test_repeated_containers_cannot_invent_incorrect_source_paths(self):
        repeated = '<PartDataList><PartData><ID>synthetic</ID></PartData></PartDataList>'
        self.assertEqual(read(job(repeated + repeated))['status'], 'blocked')

    def test_escaped_output_limit_keeps_large_record_report_out_of_worker_stdout(self):
        record = '<PartData><Name>' + '\u754c'*2000 + '</Name></PartData>'
        report = read(job('<PartDataList>' + record*200 + '</PartDataList>'))
        self.assertEqual(report['status'], 'blocked')
        self.assertEqual(report['records'], [])

    def test_nested_algorithms_have_exact_window_scope_and_keep_windows(self):
        window = '<WindowData><ID>same-local-id</ID><AlgorithmDataList><AlgorithmData><ID>local-alg</ID><Type>unqualified</Type></AlgorithmData></AlgorithmDataList><ENABLE>False</ENABLE></WindowData>'
        result = read(job('<WindowDataList>' + window * 2 + '</WindowDataList>'))
        self.assertEqual(result['status'], 'recorded')
        self.assertEqual(result['countsByRecordKind']['window-record'], 2)
        self.assertEqual(result['countsByRecordKind']['algorithm-record'], 2)
        algorithms = [r for r in result['records'] if r['kind'] == 'algorithm-record']
        self.assertIn('WindowData[1]/AlgorithmDataList/AlgorithmData[1]', algorithms[0]['sourcePath'])
        self.assertIn('WindowData[2]/AlgorithmDataList/AlgorithmData[1]', algorithms[1]['sourcePath'])
        self.assertNotEqual(algorithms[0]['containerSourcePath'], algorithms[1]['containerSourcePath'])
        self.assertTrue(all(r['rawFields']['ENABLE'] == ['False'] for r in result['records'] if r['kind'] == 'window-record'))

    def test_native_pad_fields_remain_source_claims(self):
        result = read(job('<GerberList><GerberPad><ID>pad-fable</ID><PartNo>part-not-proven</PartNo><C>2.7|8.9</C><WH>0.3|0.9</WH></GerberPad></GerberList>'))
        self.assertEqual(result['countsByRecordKind']['pad-record'], 1)
        self.assertEqual(result['records'][0]['rawFields']['PartNo'], ['part-not-proven'])
        self.assertFalse(result['nativeSchemaQualified'])

    def test_repeated_algorithm_container_within_same_window_is_blocked(self):
        container = '<AlgorithmDataList><AlgorithmData><ID>t</ID></AlgorithmData></AlgorithmDataList>'
        self.assertEqual(read(job('<WindowDataList><WindowData>' + container*2 + '</WindowData></WindowDataList>'))['status'], 'blocked')
