import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image

spec = importlib.util.spec_from_file_location('icons', Path(__file__).with_name('sync-icons.py'))
icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)

def image_bytes(color, format='PNG'):
    output = io.BytesIO()
    Image.new('RGBA', (256, 256), color).save(output, format=format)
    return output.getvalue()

class IconSyncTests(unittest.TestCase):
    def fixture(self, folder):
        root = Path(folder)
        (root / 'content').mkdir()
        (root / 'content/projects.json').write_text(json.dumps({'projects': [{'id': 'one', 'icon': 'old.png'}, {'id': 'two', 'icon': 'old2.png'}]}))
        (root / 'content/icon-sources.json').write_text(json.dumps({'one': {'path': 'app.ico'}, 'two': {'path': 'brand.png'}}))
        return root

    def test_largest_ico_frame_and_transparency_survive(self):
        raw = icons.png_bytes(image_bytes((10, 20, 30, 128), 'ICO'))
        with Image.open(io.BytesIO(raw)) as result:
            self.assertEqual(result.size, (256, 256))
            self.assertEqual(result.getpixel((128, 128)), (10, 20, 30, 128))

    def test_failed_download_preserves_catalog_and_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.fixture(folder)
            before = (root / 'content/projects.json').read_bytes()
            def fetch(repo, path):
                if repo == 'two':
                    raise OSError('source unavailable')
                return image_bytes('red')
            with self.assertRaises(OSError):
                icons.sync_icons(root, fetch)
            self.assertEqual((root / 'content/projects.json').read_bytes(), before)
            self.assertFalse((root / 'public').exists())

    def test_changed_art_gets_new_url_and_unchanged_art_is_stable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.fixture(folder)
            def run(color):
                icons.sync_icons(root, lambda repo, path: image_bytes(color if repo == 'one' else 'blue'))
                return json.loads((root / 'content/projects.json').read_text())['projects']
            first, repeat, changed = run('red'), run('red'), run('green')
            self.assertEqual(first, repeat)
            self.assertNotEqual(first[0]['icon'], changed[0]['icon'])
            self.assertEqual(first[1]['icon'], changed[1]['icon'])
            self.assertTrue((root / 'public' / changed[0]['icon']).is_file())

if __name__ == '__main__':
    unittest.main()
