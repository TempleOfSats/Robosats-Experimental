# Code signing policy

**Preparation status:** this project has not yet been accepted by SignPath
Foundation. Current Windows releases are unsigned. Remove this notice only
after approval and after official Windows downloads use the signed artifact.

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

## Project

Project: RoboSats.Exp

Official Windows binaries are built from the source code and build scripts in
this repository using GitHub Actions on GitHub-hosted runners.

## Roles

The final public GitHub account or permission-group links must replace the
markers below before applying to SignPath Foundation:

- Authors and committers: **TempleOfSats**
- Reviewers: **TempleOfSats**
- Code-signing approvers: **TempleOfSats**

Changes proposed by people without direct commit access are reviewed by a
reviewer before they are merged. Every release signing request requires manual
approval through SignPath.

## Privacy policy

See the project [privacy notice](./PRIVACY.md).

## Build and signing process

The Windows installer is built by the repository's GitHub Actions workflow on
a GitHub-hosted Windows runner. The unsigned installer is uploaded as a GitHub
Actions artifact before the same workflow submits that artifact to SignPath.

SignPath verifies the workflow origin and signs an approved installer using a
certificate issued to SignPath Foundation. The workflow then verifies the
returned Authenticode signature. Only the signed artifact returned by SignPath
may be published as an official signed Windows release.
