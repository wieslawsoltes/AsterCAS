"""Smoke-test the actual public HTTPS deployment; no origin/storage fixtures."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / 'test-results'
    output.mkdir(exist_ok=True)
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={'width': 1600, 'height': 1180}, accept_downloads=True)
            page = context.new_page()
            page.set_default_timeout(30000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            response = page.goto(args.url + '?validation=' + args.commit)
            assert response and response.status == 200, 'Public app did not return HTTP 200'
            page.wait_for_function('window.aster && !aster.state.running')
            page.wait_for_function('[...aster.state.plotViews.values()][0]?.vertexCount>0')
            assert page.evaluate('window.isSecureContext'), 'Expected a secure HTTPS context'
            assert page.evaluate('!aster.state.docs[0].cells.some(c=>c.result?.kind==="error")')
            version_response = context.request.get(urljoin(args.url, 'version.json') + '?validation=' + args.commit)
            assert version_response.ok
            version = version_response.json()
            assert version['source_commit'] == args.commit, version
            title = page.locator('[data-doc-field="title"]')
            title.fill('Published Aster CAS persistence validation')
            page.wait_for_function('document.querySelector("#save-indicator").textContent==="Saved locally"')
            page.reload()
            page.wait_for_function('window.aster && !aster.state.running')
            assert title.inner_text() == 'Published Aster CAS persistence validation'
            with page.expect_download() as event:
                page.locator('.quick-tools [data-action="save"]').click()
            destination = output / 'published.aster'
            event.value.save_as(destination)
            assert json.loads(destination.read_text())['format'] == 'aster-worksheet'
            page.get_by_role('tab', name='Surface studio').click()
            page.wait_for_function('!aster.state.running')
            page.wait_for_function('[...aster.state.plotViews.values()][0]?.vertexCount===75264')
            page.wait_for_timeout(700)
            backend = page.locator('.plot-backend').first.inner_text()
            page.locator('[data-plot-action="wire"]').click()
            page.wait_for_timeout(250)
            assert page.evaluate('[...aster.state.plotViews.values()][0].wire')
            assert page.locator('.plot-backend').first.inner_text() == backend
            page.screenshot(path=str(output / 'published-surface.png'))
            assert not errors, errors
            report = {'passed': True, 'url': args.url, 'source_commit': args.commit,
                      'browser': browser.version, 'backend': backend, 'http_status': 200,
                      'secure_context': True, 'native_persistence': True,
                      'native_download': True, 'surface_vertices': 75264, 'browser_errors': errors}
            (output / 'published-browser-results.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report, indent=2))
            context.close()
        finally:
            browser.close()


if __name__ == '__main__':
    main()
