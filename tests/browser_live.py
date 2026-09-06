"""Normal-origin validation for Aster's ES-module and standalone applications.

This suite is separate from the policy-constrained about:blank fixture suite.
It runs on an ordinary localhost origin, never changes browser policies, tests
native persistence and downloads, and optionally requires a live WebGPU device.

Usage:
  python tests/browser_live.py
  python tests/browser_live.py --require-webgpu --headed
  python tests/browser_live.py --chromium /path/to/chromium
"""
from __future__ import annotations
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-webgpu', action='store_true')
    parser.add_argument('--headed', action='store_true')
    parser.add_argument('--chromium', default=os.environ.get('ASTER_CHROMIUM'))
    args = parser.parse_args()
    if not (ROOT / 'dist/index.html').is_file():
        parser.error('Build the standalone application first: npm run build')
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    report: dict[str, object] = {'builds': [], 'require_webgpu': args.require_webgpu}
    output = ROOT / 'test-results'
    output.mkdir(exist_ok=True)
    try:
        with sync_playwright() as p:
            launch: dict[str, object] = {'headless': not args.headed}
            if args.chromium:
                launch['executable_path'] = args.chromium
            browser = p.chromium.launch(**launch)
            report['browser'] = browser.version
            try:
                for name, path in [('modules', '/'), ('standalone', '/dist/index.html')]:
                    context = browser.new_context(
                        viewport={'width': 1600, 'height': 1180}, accept_downloads=True)
                    page = context.new_page()
                    page.set_default_timeout(15000)
                    errors: list[str] = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(f'http://127.0.0.1:{server.server_port}{path}')
                    page.wait_for_function('window.aster && !aster.state.running')
                    page.wait_for_function('document.querySelector(".plot-backend")?.textContent !== "Initializing"')
                    page.wait_for_timeout(600)
                    assert page.evaluate('!aster.state.docs[0].cells.some(c=>c.result?.kind==="error")')
                    assert page.evaluate('[...aster.state.plotViews.values()][0].vertexCount>0')
                    title = page.locator('[data-doc-field="title"]')
                    title.fill(f'Persistence test — {name}')
                    page.wait_for_function('document.querySelector("#save-indicator").textContent==="Saved locally"')
                    page.reload()
                    page.wait_for_function('window.aster && !aster.state.running')
                    assert title.inner_text() == f'Persistence test — {name}'
                    with page.expect_download() as event:
                        page.locator('.quick-tools [data-action="save"]').click()
                    download = event.value
                    destination = output / f'{name}.aster'
                    download.save_as(destination)
                    assert json.loads(destination.read_text())['format'] == 'aster-worksheet'
                    page.get_by_role('tab', name='Surface studio').click()
                    page.wait_for_function('!aster.state.running')
                    page.wait_for_function('[...aster.state.plotViews.values()][0]?.vertexCount===75264')
                    page.wait_for_timeout(700)
                    backend = page.locator('.plot-backend').first.inner_text()
                    reason = page.locator('.plot-backend').first.get_attribute('title')
                    if args.require_webgpu:
                        assert backend == 'WebGPU', f'{name}: {backend}: {reason}'
                        assert page.evaluate('!![...aster.state.plotViews.values()][0].gpu?.device')
                    page.locator('[data-plot-action="wire"]').click()
                    page.wait_for_timeout(250)
                    assert page.evaluate('[...aster.state.plotViews.values()][0].wire')
                    assert page.locator('.plot-backend').first.inner_text() == backend
                    page.screenshot(path=str(output / f'{name}-surface.png'))
                    assert not errors, errors
                    report['builds'].append({'build': name, 'passed': True,
                        'backend': backend, 'backend_detail': reason,
                        'native_storage': True, 'native_download': True,
                        'browser_errors': errors})
                    context.close()
            finally:
                browser.close()
        (output / 'browser-live-results.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

if __name__ == '__main__':
    main()
