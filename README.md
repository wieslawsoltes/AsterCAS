# Aster CAS — bootstrap snapshot

This branch retains the initial generated, dependency-free standalone application.

**Production deployment uses GitHub Actions from `main`, not this branch.**

Application: https://wieslawsoltes.github.io/AsterCAS/

Source, tests and documentation: https://github.com/wieslawsoltes/AsterCAS/tree/main

Deployment workflow: https://github.com/wieslawsoltes/AsterCAS/actions/workflows/ci.yml

Make application changes on `main`. Its workflow validates the source, builds the standalone app, publishes through the official GitHub Pages actions, and tests the public HTTPS application. This bootstrap snapshot is not updated by subsequent deployments.

The public application's `/version.json` identifies the actual deployed source commit and HTML digest.
