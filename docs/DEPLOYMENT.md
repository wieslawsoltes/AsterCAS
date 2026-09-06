# GitHub Pages deployment

Application: **https://wieslawsoltes.github.io/AsterCAS/**

Source: https://github.com/wieslawsoltes/AsterCAS/tree/main

Workflow: https://github.com/wieslawsoltes/AsterCAS/actions/workflows/ci.yml

## Validation and publication

`main` contains the complete editable source, tests, documentation and an initial standalone build. On each push to `main`, CI runs the kernel suite, builds `dist/index.html`, executes the worksheet integration suite, and validates both source-module and standalone builds on an actual localhost origin. Only the tested artifact proceeds to publication. Pull requests run validation without production publication.

Publication uses GitHub's official `configure-pages`, `upload-pages-artifact`, and `deploy-pages` actions. The repository's Pages publishing source should be **GitHub Actions**. The `github-pages` deployment environment links to the published application. No generated branch is required for subsequent deployments; the initial `gh-pages` branch is only a bootstrap snapshot and is not maintained by this workflow.

Before uploading, the job writes `version.json` with the source commit and standalone HTML SHA-256. After GitHub reports a successful deployment, the job verifies the live HTTP response against the tested artifact, then opens the actual HTTPS site in Chromium. That browser check covers worker evaluation, 2D/3D geometry, persistent editing, a native document download, and absence of unhandled JavaScript errors.

The browser reports its actual rendering backend; passing a fallback-renderer test does not claim hardware WebGPU validation. Test reports and screenshots are retained as workflow artifacts.

Production publication is serialized, and superseded source commits are skipped. The deployment job uses only its short-lived `GITHUB_TOKEN` and OIDC identity with `contents: read`, `pages: write`, and `id-token: write`. No personal access token or external hosting service is required.

## Local development

```sh
npm test
npm run build
python3 -m http.server 8765
```

Open http://localhost:8765 for the modular application or http://localhost:8765/dist/ for the standalone build. After editing, push to `main`. The version of `dist/index.html` tracked in the source tree is a convenience snapshot; publication always uses a fresh build of validated source.

## Diagnostics

Check the **Validate, build and publish** workflow. Its configuration job records the actual Pages build type and publishing source without exposing credentials. Artifacts include `kernel.tap`, browser reports and screenshots, `pages-publish.json`, and `published-browser-results.json`. The public `/version.json` identifies the served source commit and HTML digest.
