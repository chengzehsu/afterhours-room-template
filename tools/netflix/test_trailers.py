import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from trailers import pick_trailer

def v(key, lang='en', official=True, site='YouTube', type='Trailer'):
    return {'key': key, 'iso_639_1': lang, 'official': official, 'site': site, 'type': type}

class PickTrailer(unittest.TestCase):
    def test_official_beats_language(self):
        r = pick_trailer([v('aaaaaaaaaaa', 'zh', official=False), v('bbbbbbbbbbb', 'en')])
        self.assertEqual(r, {'yt': 'bbbbbbbbbbb', 'lang': 'en'})

    def test_language_order(self):
        r = pick_trailer([v('e1', 'en'), v('z1', 'zh'), v('t1', 'ja')])
        self.assertEqual(r['yt'], 'z1')
        r = pick_trailer([v('e1', 'en'), v('z1', 'zh'), v('c1', 'zh-TW')])
        self.assertEqual(r['yt'], 'c1')
        r = pick_trailer([v('j1', 'ja'), v('e1', 'en')])
        self.assertEqual(r['yt'], 'e1')

    def test_zh_tw_from_region(self):
        r = pick_trailer([v('e1', 'en'), {**v('c1', 'zh'), 'iso_3166_1': 'TW'}, v('z1', 'zh')])
        self.assertEqual(r['yt'], 'c1')
        self.assertEqual(r['lang'], 'zh-TW')

    def test_none_when_nothing_qualifies(self):
        self.assertIsNone(pick_trailer([v('a', type='Teaser'), v('b', site='Vimeo'), v('c', type='Clip')]))
        self.assertIsNone(pick_trailer([]))
        self.assertIsNone(pick_trailer(None))

    def test_null_language_is_last_but_usable(self):
        r = pick_trailer([v('n1', None), v('j1', 'ja')])
        self.assertEqual(r['yt'], 'j1')
        self.assertEqual(pick_trailer([v('n1', None)])['yt'], 'n1')

    def test_stable_first_among_equals(self):
        self.assertEqual(pick_trailer([v('first', 'en'), v('second', 'en')])['yt'], 'first')

if __name__ == '__main__':
    unittest.main()
