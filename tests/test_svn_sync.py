"""Real local SVN + Git repositories exercise the bridge without production access."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('svn_sync', Path(__file__).parents[1] / 'scripts/svn-sync.py')
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


def command(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.STDOUT).decode().strip()


def svnadmin_path():
    found = shutil.which('svnadmin')
    if found:
        return found
    real = shutil.which('svn.real')
    candidate = Path(real).resolve().with_name('svnadmin') if real else None
    if candidate and candidate.exists():
        return str(candidate)
    raise RuntimeError('同步集成测试需要 Git、svn 和 svnadmin（Subversion）')


class SyncTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dashboard-sync-test-')
        self.addCleanup(self.temporary.cleanup)
        directory = Path(self.temporary.name)
        self.root = directory / 'git'; self.root.mkdir()
        self.repo = directory / 'svn'
        command(svnadmin_path(), 'create', str(self.repo))
        self.url = self.repo.as_uri()
        command('git', 'init', '-q', '-b', 'main', str(self.root))
        command('git', 'config', 'user.name', 'Sync Test', cwd=self.root)
        command('git', 'config', 'user.email', 'sync-test@example.invalid', cwd=self.root)
        command('git', 'config', 'commit.gpgsign', 'false', cwd=self.root)
        remote = directory / 'remote.git'
        command('git', 'init', '--bare', '-q', str(remote))
        command('git', 'remote', 'add', 'origin', str(remote), cwd=self.root)
        config = {'url': self.url, 'uuid': command('svn', 'info', '--show-item', 'repos-uuid', self.url),
                  'gitRemote': 'origin', 'gitBranch': 'main', 'verify': [sys.executable, '-c', 'assert True'],
                  'include': ['src/', '.svn-sync.json']}
        (self.root / '.svn-sync.json').write_text(json.dumps(config))
        (self.root / 'src').mkdir()
        (self.root / 'src/a.txt').write_text(''.join(f'line {i}\n' for i in range(30)))
        (self.root / 'src/remove.txt').write_text('delete me')
        (self.root / 'src/data.bin').write_bytes(b'\0\1old')
        self.commit('initial')
        self.call('bootstrap', 0); self.call('push')
        self.wc = directory / 'colleague'
        command('svn', 'checkout', '-q', self.url, str(self.wc))

    def call(self, action, revision=None):
        with contextlib.redirect_stdout(io.StringIO()):
            bridge.sync(self.root, action, revision)

    def commit(self, message):
        command('git', 'add', '-A', cwd=self.root)
        command('git', 'commit', '-qm', message, cwd=self.root)
        command('git', 'push', '-q', 'origin', 'main', cwd=self.root)

    def svn_commit(self, message):
        command('svn', 'commit', '-qm', message, str(self.wc))
        command('svn', 'update', '-q', str(self.wc))

    def state(self):
        return json.loads((self.root / '.git/svn-sync-dbscan/state.json').read_text())

    def test_round_trip_rename_delete_conflict_and_new_incoming_commit(self):
        path = self.root / 'src/a.txt'; path.write_text(path.read_text().replace('line 0\n', 'Git first\n'))
        self.commit('Git changes')
        other = self.wc / 'src/a.txt'; other.write_text(other.read_text().replace('line 29\n', 'SVN last\n'))
        command('svn', 'move', str(self.wc / 'src/remove.txt'), str(self.wc / 'src/renamed.txt'))
        (self.wc / 'src/data.bin').write_bytes(b'\0\1new')
        self.svn_commit('SVN changes')
        self.call('pull')
        self.assertIn('Git first', path.read_text()); self.assertIn('SVN last', path.read_text())
        self.assertFalse((self.root / 'src/remove.txt').exists())
        self.assertTrue((self.root / 'src/renamed.txt').exists())
        self.assertEqual((self.root / 'src/data.bin').read_bytes(), b'\0\1new')
        self.commit('merge SVN')
        # A colleague can commit again while the first merge is being reviewed.
        other.write_text(other.read_text().replace('line 20\n', 'SVN another\n'))
        self.svn_commit('new incoming')
        with self.assertRaisesRegex(RuntimeError, '停止回写'):
            self.call('push')
        self.call('pull'); self.commit('merge newer SVN'); self.call('push')
        command('svn', 'update', '-q', str(self.wc))
        self.assertEqual(path.read_bytes(), other.read_bytes())
        self.assertNotIn('pending', self.state())
        path.write_text(path.read_text().replace('line 10\n', 'Git conflict\n')); self.commit('Git conflict')
        other.write_text(other.read_text().replace('line 10\n', 'SVN conflict\n')); self.svn_commit('SVN conflict')
        with self.assertRaisesRegex(RuntimeError, '处理 Git 冲突'):
            self.call('pull')
        self.assertIn('<<<<<<<', path.read_text())
        path.write_text(other.read_text().replace('SVN conflict', 'Resolved together'))
        self.commit('resolve conflict'); self.call('push')
        self.assertNotIn('pending', self.state())

    def test_unknown_commit_outcome_recovers_without_duplicate_commit(self):
        (self.root / 'src/a.txt').write_text('new contents'); self.commit('new')
        original = bridge.svn
        def lose_receipt(*args):
            response = original(*args)
            if args[0] == 'commit':
                raise RuntimeError('simulated lost commit receipt')
            return response
        with patch.object(bridge, 'svn', side_effect=lose_receipt):
            with self.assertRaisesRegex(RuntimeError, 'lost commit receipt'):
                self.call('push')
        rev = command('svn', 'info', '--show-item', 'revision', self.url)
        self.assertIn('publishing', self.state())
        self.call('push')
        self.assertNotIn('publishing', self.state())
        self.assertEqual(command('svn', 'info', '--show-item', 'revision', self.url), rev)
        self.assertEqual(self.state()['base']['svn'], int(rev))

    def test_dirty_tree_and_out_of_scope_files_stop_without_overwrite(self):
        path = self.root / 'src/a.txt'; before = path.read_text(); path.write_text('unfinished')
        with self.assertRaisesRegex(RuntimeError, '不干净'):
            self.call('pull')
        self.assertEqual(path.read_text(), 'unfinished')
        path.write_text(before)
        (self.wc / '.env').write_text('TEST=not-a-secret')
        command('svn', 'add', str(self.wc / '.env')); self.svn_commit('out of scope')
        with self.assertRaisesRegex(RuntimeError, '范围外文件'):
            self.call('pull')
        self.assertFalse((self.root / '.env').exists())
        self.assertNotIn('pending', self.state())

    def test_root_property_prevents_concurrent_svn_commit(self):
        (self.root / 'src/a.txt').write_text('Git to publish'); self.commit('new')
        original = bridge.svn
        def concurrent_commit(*args):
            if args[0] == 'commit':
                (self.wc / 'src/remove.txt').write_text('colleague concurrent change')
                self.svn_commit('concurrent during commit')
            return original(*args)
        with patch.object(bridge, 'svn', side_effect=concurrent_commit):
            with self.assertRaisesRegex(RuntimeError, 'out of date'):
                self.call('push')
        self.assertIn('publishing', self.state())
        self.assertEqual(command('svn', 'cat', self.url + '/src/remove.txt'), 'colleague concurrent change')
        self.call('pull'); self.commit('merge concurrent change'); self.call('push')
        self.assertNotIn('publishing', self.state())


if __name__ == '__main__':
    unittest.main()
