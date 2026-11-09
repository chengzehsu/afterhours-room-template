import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from classify import load_rules, load_works

CSV = '''Title,Date
"示範影集: 第 1 季: 第 1 集","11/1/26"
"示範影集: 第 1 季: 第 2 集","11/2/26"
"別人看的劇: 第 1 集","11/2/26"
"小朋友的卡通: 第 3 集","11/3/26"
"示範動畫電影","10/30/26"
"示範電影","10/29/26"
'''

RULES = {'exclude': ['別人看的劇'], 'kids': ['小朋友的卡通'], 'anime_movies': ['示範動畫電影'],
         'anime_series': [], 'movie_with_colon': [], 'date_format': '%m/%d/%y'}


class Classify(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        d = Path(self.dir.name)
        (d / 'h.csv').write_text(CSV, encoding='utf-8')
        (d / 'rules.json').write_text(json.dumps(RULES, ensure_ascii=False), encoding='utf-8')
        self.csv, self.rules = str(d / 'h.csv'), load_rules(d / 'rules.json')

    def tearDown(self):
        self.dir.cleanup()

    def test_exclude_and_kids_are_dropped(self):
        w = load_works(self.csv, self.rules)
        self.assertEqual(sorted(w), ['示範動畫電影', '示範影集', '示範電影'])

    def test_categories_and_days(self):
        w = load_works(self.csv, self.rules)
        self.assertEqual(w['示範影集']['category'], '影集')
        self.assertEqual(w['示範影集']['episodes'], 2)
        self.assertEqual(len(w['示範影集']['days']), 2)
        self.assertEqual(w['示範動畫電影']['category'], '動畫')
        self.assertEqual(w['示範電影']['category'], '電影')

    def test_date_format_is_configurable(self):
        d = Path(self.dir.name)
        (d / 'eu.csv').write_text('Title,Date\n"示範電影","29/10/2026"\n', encoding='utf-8')
        w = load_works(str(d / 'eu.csv'), {**self.rules, 'date_format': '%d/%m/%Y'})
        self.assertEqual(min(w['示範電影']['days']).isoformat(), '2026-10-29')

    def test_split_same_name_into_two_works(self):
        d = Path(self.dir.name)
        (d / 's.csv').write_text('Title,Date\n"同名劇: 動畫篇: 第 1 集","11/1/26"\n"同名劇: 第 1 季: 第 1 集","11/2/26"\n', encoding='utf-8')
        rules = {**self.rules, 'split': [{'title': '同名劇', 'marker': '動畫篇', 'match': '同名劇（動畫）', 'other': '同名劇（真人）'}]}
        w = load_works(str(d / 's.csv'), rules)
        self.assertEqual(sorted(w), ['同名劇（動畫）', '同名劇（真人）'])
        self.assertEqual(w['同名劇（動畫）']['category'], '動畫')
        self.assertEqual(w['同名劇（真人）']['query'], '同名劇')

    def test_example_rules_load(self):
        r = load_rules(Path(__file__).with_name('rules.example.json'))
        self.assertIn('exclude', r)
        self.assertEqual(r['date_format'], '%m/%d/%y')


if __name__ == '__main__':
    unittest.main()
