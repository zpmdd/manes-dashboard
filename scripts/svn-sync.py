#!/usr/bin/env python3
"""One Git integration point for the SVN mirror; never overwrite a developer checkout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET


def run(*args, cwd=None, env=None, input=None):
    result = subprocess.run(args, cwd=cwd, env=env, input=input, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace').strip() or result.stdout.decode(errors='replace').strip())
    return result.stdout


def git(*args, **kwargs):
    return run('git', *args, **kwargs)


def svn(*args):
    return run('svn', *map(str, args), '--non-interactive')


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def allowed(name, config):
    parts = Path(name).parts
    if not parts or name.startswith('/') or any(part in ('.', '..', '.git', '.svn', 'node_modules', 'dist', 'releases', '__pycache__') or part.startswith('.env') for part in parts):
        return False
    return any(name.startswith(item) if item.endswith('/') else name == item for item in config['include'])


def file_record(path):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f'不支持符号链接或特殊文件：{path}')
    return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'mode': '100755' if path.stat().st_mode & 0o111 else '100644'}


def git_manifest(root, config):
    names = git('ls-files', '-z', cwd=root).decode().split('\0')
    return {name: file_record(root / name) for name in sorted(names) if name and allowed(name, config)}


def svn_manifest(root, config):
    result = {}
    for parent, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name != '.svn']
        for name in dirs:
            if (Path(parent) / name).is_symlink():
                raise RuntimeError(f'不支持目录符号链接：{Path(parent) / name}')
        for name in files:
            path = Path(parent) / name
            name = path.relative_to(root).as_posix()
            if not allowed(name, config):
                raise RuntimeError(f'SVN 含同步范围外文件，先人工确认：{name}')
            result[name] = file_record(path)
    return result


def revision(config):
    info = ET.fromstring(svn('info', '--xml', config['url']))
    if info.findtext('.//repository/uuid') != config['uuid']:
        raise RuntimeError('SVN UUID 与配置不一致')
    return int(info.find('entry').attrib['revision'])


def clean(root):
    if git('status', '--porcelain', '--untracked-files=all', cwd=root).strip():
        raise RuntimeError('Git 工作目录不干净；请在整合分支保存并提交改动后再同步')


def checkout(config, rev, path):
    svn('checkout', '--quiet', '--ignore-externals', '-r', rev, config['url'], path)
    if svn('propget', 'svn:externals', '--recursive', path).strip():
        raise RuntimeError('同步范围不支持 SVN externals')


def changes(before, after):
    return [name for name in sorted(before.keys() | after.keys()) if before.get(name) != after.get(name)]


def ensure_ancestor(root, ancestor, head):
    git('merge-base', '--is-ancestor', ancestor, head, cwd=root)


def import_commit(root, base, remote, working, rev, state_dir):
    with tempfile.TemporaryDirectory(dir=state_dir, prefix='index-') as temporary:
        env = {**os.environ, 'GIT_INDEX_FILE': str(Path(temporary) / 'index')}
        git('read-tree', base['git'], cwd=root, env=env)
        for name in changes(base['files'], remote):
            if name not in remote:
                git('update-index', '--force-remove', '--', name, cwd=root, env=env)
            else:
                blob = git('hash-object', '-w', '--stdin', cwd=root, input=(working / name).read_bytes()).decode().strip()
                git('update-index', '--add', '--cacheinfo', remote[name]['mode'], blob, name, cwd=root, env=env)
        tree = git('write-tree', cwd=root, env=env).decode().strip()
        return git('commit-tree', tree, '-p', base['git'], '-m', f'svn: import dbscan r{base["svn"] + 1}:r{rev}', cwd=root).decode().strip()


def published(root, config, head):
    response = git('ls-remote', config['gitRemote'], f'refs/heads/{config["gitBranch"]}', cwd=root).decode().split()
    if not response or response[0] != head:
        raise RuntimeError(f'请先将验收通过的当前提交推送到 {config["gitRemote"]}/{config["gitBranch"]}，再回写 SVN')


def complete(state, head, rev, files, state_file):
    state['base'] = {'git': head, 'svn': rev, 'files': files}
    state.pop('pending', None)
    state.pop('publishing', None)
    write_json(state_file, state)
    print(f'同步完成：Git {head} ↔ SVN r{rev}，已逐文件核对 {len(files)} 个文件')


def sync(root, action, initial_revision=None):
    config = json.loads((root / '.svn-sync.json').read_text())
    common = Path(git('rev-parse', '--git-common-dir', cwd=root).decode().strip())
    state_dir = (root / common).resolve() / 'svn-sync-dbscan'
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file = state_dir / 'state.json'
    lock = state_dir / 'lock'
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError(f'已有同步运行；异常退出时先确认没有同步进程，再移除锁：{lock}')
    try:
        (lock / 'pid').write_text(str(os.getpid()))
        state = json.loads(state_file.read_text()) if state_file.exists() else {'url': config['url'], 'uuid': config['uuid']}
        if (state['url'], state['uuid']) != (config['url'], config['uuid']):
            raise RuntimeError('同步目标已变化，不能复用旧基线')
        head = git('rev-parse', 'HEAD', cwd=root).decode().strip()
        latest = revision(config)
        if action == 'status':
            base = state.get('base')
            print(json.dumps({'git': head, 'svnHead': latest, 'base': {k: v for k, v in base.items() if k != 'files'} if base else None,
                              'pending': {k: v for k, v in state.get('pending', {}).items() if k != 'files'} or None, 'publishing': {k: v for k, v in state.get('publishing', {}).items() if k != 'files'} or None, 'state': str(state_file)}, ensure_ascii=False, indent=2))
            return
        clean(root)
        if action == 'bootstrap':
            if state.get('base') or state.get('pending') or state.get('publishing'):
                raise RuntimeError('已有基线或待完成同步，不能重新初始化')
            if initial_revision != latest:
                raise RuntimeError(f'需明确指定已人工整合的最新 SVN 版本：--revision {latest}')
            state['pending'] = {'svn': latest, 'gitStart': head, 'bootstrap': True}
            write_json(state_file, state)
            print('首次人工整合版本已登记；推送 Git 正式主线后执行 sync:push')
            return
        base = state.get('base')
        if action == 'cancel':
            pending = state.get('pending')
            if state.get('publishing') or not pending or head != pending['gitStart']:
                raise RuntimeError('仅能在 git merge --abort 且回到整合前干净提交后取消导入；发布中状态必须恢复完成')
            state.pop('pending')
            write_json(state_file, state)
            return
        if action == 'pull':
            if not base:
                raise RuntimeError('需先完成首次基线；初始化期间 SVN 有变化时请取消初始化并人工合并新增版本')
            pending = state.get('pending', {})
            if state.get('publishing'):
                publishing = state['publishing']
                expected = pending.get('svn', base['svn'])
                logs = ET.fromstring(svn('log', '--xml', '-r', f'{expected + 1}:HEAD', config['url'])) if latest > expected else ET.Element('log')
                if any(entry.findtext('msg') == publishing['message'] for entry in logs.findall('logentry')):
                    raise RuntimeError('上次 SVN 提交已成功，请先 sync:push 恢复并核对回执')
                state.pop('publishing')
                write_json(state_file, state)
            source = {'git': pending['imported'], 'svn': pending['svn'], 'files': pending['files']} if pending else base
            ensure_ancestor(root, source['git'], head)
            if latest == source['svn']:
                print('SVN 没有新提交')
                return
            with tempfile.TemporaryDirectory(dir=state_dir, prefix='pull-') as temporary:
                working = Path(temporary) / 'checkout'
                checkout(config, latest, working)
                remote = svn_manifest(working, config)
                imported = import_commit(root, source, remote, working, latest, state_dir)
            state['pending'] = {'svn': latest, 'gitStart': head, 'imported': imported, 'files': remote}
            write_json(state_file, state)
            git('update-ref', 'refs/svn/dbscan', imported, cwd=root)
            result = subprocess.run(['git', 'merge', '--no-commit', '--no-ff', imported], cwd=root)
            if result.returncode:
                raise RuntimeError('SVN 已导入到 refs/svn/dbscan；请处理 Git 冲突后验收并提交，或 git merge --abort 后 sync:cancel')
            print(f'已合并 SVN r{latest} 到当前工作目录；请检查差异、验收并提交，再发布 Git 和回写 SVN')
            return
        if action != 'push' or not (base or state.get('pending')):
            raise RuntimeError('请先 bootstrap 初始化共同版本')
        pending = state.get('pending', {})
        expected = pending.get('svn', base['svn'] if base else None)
        ensure_ancestor(root, pending.get('imported', pending.get('gitStart', base['git'] if base else head)), head)
        published(root, config, head)
        files = git_manifest(root, config)
        publishing = state.get('publishing')
        if publishing:
            if publishing['git'] != head or publishing['files'] != files:
                raise RuntimeError('上次发布未完成；请先回到该 Git 提交恢复同步')
            logs = ET.fromstring(svn('log', '--xml', '-r', f'{expected + 1}:HEAD', config['url'])) if latest > expected else ET.Element('log')
            receipt = next((entry for entry in logs.findall('logentry') if entry.findtext('msg') == publishing['message']), None)
            if receipt is not None:
                committed = int(receipt.attrib['revision'])
                with tempfile.TemporaryDirectory(dir=state_dir, prefix='recover-') as temporary:
                    working = Path(temporary) / 'checkout'
                    checkout(config, committed, working)
                    if svn_manifest(working, config) != files:
                        raise RuntimeError('上次提交内容与 Git 不一致，保留恢复状态并停止')
                complete(state, head, committed, files, state_file)
                return
        if latest != expected:
            raise RuntimeError(f'SVN 已从 r{expected} 更新到 r{latest}，停止回写；先处理新提交，不能覆盖')
        # Verify the exact clean Git snapshot immediately before publishing it.
        subprocess.run(config['verify'], cwd=root, check=True)
        clean(root)
        if git('rev-parse', 'HEAD', cwd=root).decode().strip() != head or git_manifest(root, config) != files:
            raise RuntimeError('验收期间 Git 内容变化，停止回写')
        with tempfile.TemporaryDirectory(dir=state_dir, prefix='push-') as temporary:
            working = Path(temporary) / 'checkout'
            checkout(config, expected, working)
            before = svn_manifest(working, config)
            if before == files:
                complete(state, head, expected, files, state_file)
                return
            for name in changes(before, files):
                path = working / name
                if name not in files:
                    svn('delete', '--force', path)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(root / name, path)
                    path.chmod(0o755 if files[name]['mode'] == '100755' else 0o644)
            svn('add', '--force', '--parents', working)
            for name in changes(before, files):
                if name in files and files[name]['mode'] != before.get(name, {}).get('mode', '100644'):
                    if files[name]['mode'] == '100755':
                        svn('propset', 'svn:executable', '*', working / name)
                    elif before.get(name, {}).get('mode') == '100755':
                        svn('propdel', 'svn:executable', working / name)
            # Changing the repository root property makes any concurrent SVN commit reject this transaction.
            svn('propset', 'dashboard:git-commit', head, working)
            message = f'sync: Git {head} -> dbscan (base r{expected})'
            state['publishing'] = {'git': head, 'files': files, 'message': message}
            write_json(state_file, state)
            if revision(config) != expected:
                raise RuntimeError('SVN 在准备期间发生变化，已停止提交')
            published(root, config, head)
            body = Path(temporary) / 'message.txt'; body.write_text(message)
            print(f'正在提交 {len(changes(before, files))} 个文件到 SVN…', flush=True)
            svn('commit', '-F', body, working)
            committed = int(ET.fromstring(svn('info', '--xml', working)).find('entry').attrib['revision'])
            svn('update', '--quiet', '--ignore-externals', '-r', committed, working)
            if svn_manifest(working, config) != files:
                raise RuntimeError('SVN 提交后核对不一致，保留恢复状态')
        complete(state, head, committed, files, state_file)
    finally:
        shutil.rmtree(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'bootstrap', 'pull', 'push', 'cancel'])
    parser.add_argument('--revision', type=int)
    args = parser.parse_args()
    root = Path(git('rev-parse', '--show-toplevel').decode().strip())
    try:
        sync(root, args.action, args.revision)
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f'同步停止：{error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
