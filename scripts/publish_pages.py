"""Publish the tested standalone artifact and verify GitHub Pages delivery.

Used by CI with its short-lived, repository-scoped GH_TOKEN. No personal access
 token or external deployment service is needed. Never prints credentials.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.github.com'
REPOSITORY = os.environ.get('GITHUB_REPOSITORY', '')
SOURCE_SHA = os.environ.get('GITHUB_SHA', '')
TOKEN = os.environ.get('GH_TOKEN', '')


def git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()


def api(path: str, method: str = 'GET') -> dict:
    request = urllib.request.Request(
        f'{API}/repos/{REPOSITORY}/{path}',
        data=b'{}' if method == 'POST' else None,
        method=method,
        headers={'Authorization': f'Bearer {TOKEN}',
                 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28',
                 'User-Agent': 'AsterCAS-Pages-CI'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def public_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={
        'User-Agent': 'AsterCAS-Pages-CI', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def main() -> None:
    if REPOSITORY != 'wieslawsoltes/AsterCAS' or not re.fullmatch(r'[0-9a-f]{40}', SOURCE_SHA) or not TOKEN:
        raise RuntimeError('Run in the AsterCAS GitHub Actions deployment job.')
    if os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise RuntimeError('Only the main branch can publish production.')
    current = api('git/ref/heads/main')['object']['sha']
    if current != SOURCE_SHA:
        print(f'Skipping superseded source commit {SOURCE_SHA}; main is {current}.')
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('published=false\n')
        return
    settings = api('pages')
    if settings.get('source') != {'branch': 'gh-pages', 'path': '/'}:
        raise RuntimeError('Pages must be configured to publish gh-pages / (root).')
    site_url = settings['html_url'].rstrip('/') + '/'
    data = (ROOT / 'dist/index.html').read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    version = {'name': 'Aster CAS', 'version': json.loads((ROOT / 'package.json').read_text())['version'],
               'source_commit': SOURCE_SHA, 'repository': REPOSITORY, 'html_sha256': digest}
    git('fetch', 'origin', 'gh-pages')
    with tempfile.TemporaryDirectory(prefix='aster-pages-') as temporary:
        worktree = Path(temporary) / 'site'
        git('worktree', 'add', '--detach', str(worktree), 'FETCH_HEAD')
        try:
            (worktree / 'index.html').write_bytes(data)
            (worktree / '.nojekyll').write_text('')
            (worktree / 'version.json').write_text(json.dumps(version, indent=2) + '\n')
            git('add', 'index.html', '.nojekyll', 'version.json', cwd=worktree)
            if git('diff', '--cached', '--name-only', cwd=worktree):
                git('-c', 'user.name=github-actions[bot]', '-c',
                    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
                    'commit', '-m', f'deploy: Aster CAS from {SOURCE_SHA[:12]}', cwd=worktree)
                git('push', 'origin', 'HEAD:gh-pages', cwd=worktree)
            deployment_sha = git('rev-parse', 'HEAD', cwd=worktree)
        finally:
            git('worktree', 'remove', '--force', str(worktree))
    # GITHUB_TOKEN pushes do not trigger Pages builds: request one explicitly.
    for attempt in range(12):
        try:
            api('pages/builds', 'POST')
            break
        except urllib.error.HTTPError as error:
            if error.code not in (409, 429) or attempt == 11:
                raise
            print('A Pages build is already active; retrying the build request.')
            time.sleep(10)
    deadline = time.monotonic() + 360
    while time.monotonic() < deadline:
        build = api('pages/builds/latest')
        print(f"Pages build: {build.get('status')} ({build.get('commit')})", flush=True)
        if build.get('commit') == deployment_sha:
            if build.get('status') == 'errored':
                raise RuntimeError(f"Pages build failed: {build.get('error')}")
            if build.get('status') == 'built':
                break
        time.sleep(10)
    else:
        raise TimeoutError('Pages did not finish building the expected deployment commit.')
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        try:
            stamp = f'?commit={SOURCE_SHA}&check={time.time_ns()}'
            served_version = json.loads(public_bytes(site_url + 'version.json' + stamp))
            served_digest = hashlib.sha256(public_bytes(site_url + stamp)).hexdigest()
            if served_version.get('source_commit') == SOURCE_SHA and served_digest == digest:
                break
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as error:
            print(f'Publication not yet available: {type(error).__name__}', flush=True)
        time.sleep(10)
    else:
        raise TimeoutError('The public site did not serve the verified artifact before the deadline.')
    evidence = ROOT / 'test-results'
    evidence.mkdir(exist_ok=True)
    report = {**version, 'url': site_url, 'deployment_commit': deployment_sha,
              'pages_status': 'built', 'live_html_hash_verified': True}
    (evidence / 'pages-publish.json').write_text(json.dumps(report, indent=2) + '\n')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'published=true\nurl={site_url}\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
        summary.write(f'## Aster CAS published\n\n[Open application]({site_url})\n\n'
                      f'Source: `{SOURCE_SHA}`\n\nDeployment: `{deployment_sha}`\n\n'
                      f'Public HTML SHA-256 verified: `{digest}`\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
