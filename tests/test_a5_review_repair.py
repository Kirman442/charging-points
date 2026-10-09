from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from repair_a5_full_review import endpoint_in_chunk,correct_chunk_label

class RepairTests(unittest.TestCase):
    def test_terminal_rounding_and_internal_boundaries(self):
        self.assertTrue(endpoint_in_chunk(440469.7283998302,400000,440469.7283998298,440469.7283998298))
        self.assertFalse(endpoint_in_chunk(440469.74,400000,440469.7283998298,440469.7283998298))
        self.assertFalse(endpoint_in_chunk(50000,0,50000,440000))
        self.assertTrue(endpoint_in_chunk(50000,50000,100000,440000))
    def test_direction_label_uses_actual_cases(self):
        report={'direction':'south','directions':[{'direction':'north','sites':79},{'direction':'south','sites':0}]}
        self.assertEqual(correct_chunk_label(report)['direction'],'north')
        report={'direction':'south','directions':[{'direction':'north','sites':0},{'direction':'south','sites':63}]}
        self.assertEqual(correct_chunk_label(report)['direction'],'south')

if __name__=='__main__':unittest.main()
