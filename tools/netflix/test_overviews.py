import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from overviews import pick, looks_simplified


class Pick(unittest.TestCase):
    def test_tw_first(self):
        self.assertEqual(pick({'zh-TW': '一個關於台北的故事', 'zh-HK': '另一段'}), '一個關於台北的故事')

    def test_empty_tw_falls_to_hk(self):
        self.assertEqual(pick({'zh-TW': '', 'zh-HK': '香港版簡介'}), '香港版簡介')

    def test_simplified_is_rejected(self):
        self.assertEqual(pick({'zh-TW': '这个故事讲的是他们的时间', 'zh-HK': ''}), '')
        self.assertTrue(looks_simplified('这个故事讲的是'))

    def test_traditional_with_shared_chars_ok(self):
        self.assertFalse(looks_simplified('高樓與黑夜的台北，晚上步行后巷'))

    def test_nothing_means_empty(self):
        self.assertEqual(pick({}), '')


if __name__ == '__main__':
    unittest.main()
