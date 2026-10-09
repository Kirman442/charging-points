import json
import sys
import tempfile
import unittest
import subprocess
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from step35_checkpoints import ensure_extraction, extraction_files, code_hashes
from step35_evidence import save, read
from step35_desktop_review import run
from step36_shared_review import comparisons


class RecoveryTests(unittest.TestCase):
    def populate(self, folder):
        for route in ('a1', 'a9'):
            (folder / route).mkdir(parents=True)
            save(folder / route / 'access-network.json', {'route': route})
            save(folder / route / 'pbf-extraction-audit.json', {'route': route})

    def test_partial_export_preserved_then_recovered_without_another_extract(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); binding = {'test': 1}; calls = []
            partial = root / 'network'; partial.mkdir(); (partial / 'partial.txt').write_text('keep')
            def extract(folder):
                calls.append(folder); self.populate(folder)
            ensure_extraction(root, binding, ['A1', 'A9'], extract, lambda s: None)
            self.assertEqual(len(calls), 1)
            self.assertEqual(next(root.glob('network.incomplete-*/partial.txt')).read_text(), 'keep')
            before = (root / 'network-completed.json').read_bytes()
            ensure_extraction(root, binding, ['A1', 'A9'], extract, lambda s: None)
            self.assertEqual(len(calls), 1)
            self.assertEqual((root / 'network-completed.json').read_bytes(), before)

    def test_crash_before_or_after_publication_recovers_without_pbf(self):
        for name in ('network.pending', 'network'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as td:
                root = Path(td); folder = root / name; binding = {'test': 1}
                self.populate(folder)
                save(folder / 'extraction-completed.json', {'binding': binding, 'files': extraction_files(folder, ['A1', 'A9'])})
                ensure_extraction(root, binding, ['A1', 'A9'], lambda f: self.fail('PBF must not be read'), lambda s: None)
                self.assertTrue((root / 'network-completed.json').exists())
                self.assertTrue((root / 'network/a1/access-network.json').exists())

    def test_corrupt_completed_export_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); folder = root / 'network'; binding = {'test': 1}; self.populate(folder)
            save(root / 'network-completed.json', {'binding': binding, 'files': extraction_files(folder, ['A1', 'A9'])})
            (folder / 'a1/access-network.json').write_text('changed')
            with self.assertRaisesRegex(ValueError, 'changed'):
                ensure_extraction(root, binding, ['A1', 'A9'], lambda f: self.fail('no replacement'), lambda s: None)
            self.assertEqual((folder / 'a1/access-network.json').read_text(), 'changed')

    def test_code_binding_detects_orchestration_evidence_and_engine_changes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); (root / 'step35_engine').mkdir()
            names = ['step35_desktop_review.py', 'step35_evidence.py', 'step35_checkpoints.py', 'step35_engine/engine.py']
            for name in names: (root / name).write_text('original')
            before = code_hashes(root)
            for name in names:
                (root / name).write_text('changed')
                self.assertNotEqual(code_hashes(root), before)
                (root / name).write_text('original')

    def test_completed_run_refused_before_validation_or_writes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); project = root / 'project'; out = root / 'output'; out.mkdir()
            save(out / '35-run-summary.json', {'completed': True})
            before = (out / '35-run-summary.json').read_bytes()
            with patch('step35_desktop_review.validate', side_effect=AssertionError('must not run')):
                with self.assertRaisesRegex(ValueError, 'Completed run'):
                    run(project, root, out)
            self.assertEqual((out / '35-run-summary.json').read_bytes(), before)

    def test_launcher_does_not_append_to_completed_log(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); save(root / '35-run-summary.json', {})
            log = root / '35-desktop-review.log'; log.write_text('historical')
            launcher = Path(__file__).resolve().parents[1] / 'scripts/step35_launch.py'
            result = subprocess.run([sys.executable, '-B', str(launcher), '--project', str(root),
                                     '--data', str(root), '--output', str(root)], capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(log.read_text(), 'historical')


class SharedComparisonTests(unittest.TestCase):
    def test_two_directions_do_not_create_extra_sites_or_force_one_to_one(self):
        records = []; queue = {}
        for row in (1, 2):
            for direction in ('north', 'south'):
                records.append({'site_row': row, 'site_id': str(row), 'direction': direction,
                    'registry_operator': 'IONITY GmbH', 'registry_address': 'same',
                    'registry_point_powers_kw': [350], 'osm_connector_powers_kw': [350],
                    'identity_assessment': 'strong_candidate_shared_review', 'same_area_ids': [9],
                    'same_layby_ids': [], 'distance_m': row * 3, 'operator_assessment': 'compatible_name',
                    'path_restrictions': [], 'rejection_reasons': [], 'mapped_route_usable_as_candidate': True})
                queue[row, direction] = {'power_kw': '1400', 'fast_points': '4', 'review_priority': '0', 'long_gap_endpoint_km': '[56.6]'}
        candidates, category = comparisons(records, queue)
        self.assertEqual(len(candidates), 2)
        self.assertEqual(category, 'multiple_same_operator_pool_possible')
        self.assertEqual(candidates[0]['other_compatible_power_sites'], ['2'])
        self.assertFalse(any(c['association_verified'] or c['entrance_verified'] for c in candidates))


if __name__ == '__main__':
    unittest.main()
