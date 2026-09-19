# Download and Release Control

- Source bytes must resolve to the exact 40-character commit recorded by the tag and `release-authority.json`.
- Public assets are generated only from a clean exact commit with `tools/build-release-assets.ps1`.
- `install.ps1` and `install.sh` in the public asset set must have effective default source-ref and commit pins, not merely matching comments. These are recorded as default pins; command-line/environment overrides are not misrepresented as impossible.
- The builder must bind the canonical origin/repository, package and Plugin identity, exact `v<version>` tag peeled to the expected commit, and exact installer default source refs before emitting assets.
- Published Plugin installers must carry that exact Release tag, the generic Plugin-template ZIP SHA-256, and its exact entry manifest. They download from the tagged Release—not `latest`—and verify whole ZIP, containment, entry set, sizes, and entry hashes before extraction.
- `SHA256SUMS.txt` covers every asset except itself; the hosting API digest independently covers the uploaded manifest asset.
- `release-authority.json` records schema, canonical repository, version/tag/commit/tree, clean archive provenance, build runtime, installer default pins, asset bytes/hashes, and Plugin ZIP/entry identity.
- Downloads are transport only. No downloaded file becomes authority until its name, size, digest, schema, commit, and expected asset set all verify.
- Canary/prerelease downloads use `/releases/download/v<version>/...`; `/releases/latest/download/...` is allowed only after full-Release promotion because GitHub excludes prereleases from `latest`.
- Create the GitHub release as a draft, attach the complete exact asset set, then publish it. Before canary mutation, require API digest reconciliation, `immutable=true`, and the release attestation; do not assume prior releases were immutable.
- Artifact SHA-256 values prove the emitted and uploaded bytes. Cross-PowerShell/.NET/OS byte-for-byte reproducibility is `UNPROVEN` and must not be claimed without an independent double-build comparison.
- Runtime API keys, DPAPI plaintext, and Tunnel IDs are never release assets.
