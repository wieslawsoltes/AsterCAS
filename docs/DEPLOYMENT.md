# GitHub Pages deployment

Application: **https://wieslawsoltes.github.io/AsterCAS/**

Source: https://github.com/wieslawsoltes/AsterCAS/tree/main

Workflow: https://github.com/wieslawsoltes/AsterCAS/actions/workflows/ci.yml

## Branches and publication

`main` contains the complete editable source, tests, documentation and an initial standalone build. The `gh-pages` branch contains the generated publication. Pages is configured to serve `gh-pages` at `/ (root)`. `.nojekyll` disables Jekyll processing.

On a push to `main`, CI runs the kernel suite, builds `dist/index.html`, executes the worksheet integration suite, and validates both source-module and standalone builds on an actual localhost origin. Only the tested artifact proceeds to publication. Pull requests run validation without production credentials or publication.

The publication job updates `gh-pages` without force-pushing, requests a Pages build explicitly (workflow-token pushes alone do not trigger Pages), checks that the expected deployment commit finishes building, then verifies the public HTML SHA-256 against the tested artifact. It also checks the `source_commit` in `version.json`.

The job finally opens the real HTTPS site in Chromium and verifies worker evaluation, 2D/3D geometry, persistent editing, a native document download, and absence of unhandled JavaScript errors. Test reports and screenshots are retained as workflow artifacts. The browser reports its actual rendering backend; passing a fallback-renderer test does not claim hardware WebGPU validation.

Production publication is serialized, and superseded source commits are skipped before publishing. Deployment uses only the job's short-lived `GITHUB_TOKEN` with repository `contents: write` and `pages: write`. No personal access token or external hosting service is required.

## Local development

```sh
npm test
npm run build
python3 -m http.server 8765
```

Open http://localhost:8765 for the modular application or http://localhost:8765/dist/ for the standalone build. After editing, push to `main`. The version of `dist/index.html` tracked in the source tree is a convenience snapshot; the published version is always rebuilt from the current validated source.

## Diagnostics

Check the **Validate, build and publish** workflow and the separate managed **pages build and deployment** run. Artifacts include `kernel.tap`, browser reports and screenshots, `pages-publish.json`, and `published-browser-results.json`. The public `/version.json` maps the served application to its source commit and HTML digest.

A repository administrator can inspect **Settings → Pages** to confirm **Deploy from a branch → gh-pages → / (root)**. Changing that setting to another branch or to a custom Actions source requires adapting the deployment script accordingly.
