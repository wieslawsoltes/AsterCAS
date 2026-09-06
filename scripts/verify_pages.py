"""Verify that the public Pages site serves the exact tested standalone artifact."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.request


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={
        'User-Agent': 'AsterCAS-Pages-CI', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    digest = hashlib.sha256((root / 'dist/index.html').read_bytes()).hexdigest()
    site = args.url.rstrip('/') + '/'
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        try:
            query = f'?commit={args.commit}&check={time.time_ns()}'
            version = json.loads(fetch(site + 'version.json' + query))
            actual_digest = hashlib.sha256(fetch(site + query)).hexdigest()
            if version.get('source_commit') == args.commit and actual_digest == digest:
                break
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as error:
            print(f'Publication not yet available: {type(error).__name__}', flush=True)
        time.sleep(10)
    else:
        raise TimeoutError('The public site did not serve the expected verified artifact.')
    output = root / 'test-results'
    output.mkdir(exist_ok=True)
    report = {'url': site, 'source_commit': args.commit, 'html_sha256': digest,
              'http_status': 200, 'live_html_hash_verified': True}
    (output / 'pages-publish.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
