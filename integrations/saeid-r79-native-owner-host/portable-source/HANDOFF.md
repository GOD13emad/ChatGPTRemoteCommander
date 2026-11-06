# R79 six-source portable reconstruction handoff

Key result: **PASS_SOURCE_RECONSTRUCTION_ONLY**. One fresh extraction reconstructed exactly six hash-pinned R78 C# dependencies under `G:/CodexWork/rc79src-20261106-a`. All six post-write SHA256 values match the frozen input manifest. This is source transfer acceptance, not a build, runtime, installation, owner-login, or whole-product acceptance.

Owner/executor: Commander R79 portable-source child agent; parent owns integration, publication, Return ZIP and final project control. The helper and all evidence live in `commander-one-native-issuer-r79/portable-source`. No installed Commander, sealed R78 files, R79 author source, credentials, active jobs, or personal profiles were modified by this task. No generated C# source was executed or compiled. No cleanup deletion occurred.

## Authority and exact identities

- `../SOURCE_INPUT_MANIFEST.json`: SHA256 `10c81512377c5034763ffd5016ff83cebf583142f0762915d93e769f987dcae1` at actual extraction. The helper binds the exact six dependency path/hash pairs, schema, R78 source commit, ZIP hash, and `FrozenR78SourceRoot` property. Unrelated R79 host source entries are not extracted or treated as this helper's inputs.
- Frozen R78 `RETURN_R78.zip`: SHA256 `3e3442499c71a3adcdf5dfc23061a6e7f8be13605747d4b41bf8d834f07c5784`; size 5,253,297 bytes. Transport archive only.
- Its `PATH_RECOVERY_MAP.json`: SHA256 `f0a6d7d1dbb27ffcc1a543d79c8d85593ea7a53ff9cf780b525d3f3a0524a138`.
- R78 immutable public commit: `5bdbd9c59a761b30d3a1aeda7df2bcdfa85cbccf`, repository `GOD13emad/ChatGPTRemoteCommander`.
- Executed helper: `reconstruct_frozen_r78_sources.py`, SHA256 `337ec452781a89836b41663750788f4f2ebdb3c880d3e4fc00d0cef8cd6c5a7f`.
- Actual owned target: `G:/CodexWork/rc79src-20261106-a`; admission required an absent, reparse-free target. `RECONSTRUCTION_OWNER.json` binds this target, helper, revision, receipt and archive hash. Preserve it; do not reuse or delete it automatically.
- Actual terminal receipt: `RECONSTRUCTION_RECEIPT.json`; status `PASS_SOURCE_RECONSTRUCTION_ONLY`, six verified files, source total 63,461 bytes.

## Reconstruction behavior and guards

The helper validates all six source bytes in memory before target creation. It hashes the same archive handle used to read ZIP members, checks the pinned recovery map and exact historic original-path-to-archive-path mapping, CRC through ZIP reading, exact member identity and bounds, duplicate ZIP names, duplicate JSON keys, traversal, encrypted/link entries, symlink/reparse ancestors, fresh target and fresh receipt. Every source file is created exclusively; no overwrite, shell, installation, execution or general-purpose ZIP extraction is used. Receipt progress is flushed before extraction and after each verified output. Failure preserves any partial owned target and the failure receipt; it never repairs pins, deletes an uncertain target, or retries an operation.

`GUARD_REGRESSION_RECEIPT.json` records 20 successful syntax and pure path/manifest checks (including traversal, alternate-data-stream names, reserved names, duplicate/missing/changed dependencies, wrong ZIP hash and duplicate JSON). These are bounded guard checks, not full Commander tests. The actual six-file extraction ran once and completed in the separate admitted target. No previous runner or consumed target was replayed.

## Reuse on another computer

Copy the small helper, the R79 source input manifest and the exact R78 Return archive. Select a **new, absent absolute target** and a **new receipt outside that target**, both with existing ordinary parents. Substitute actual paths in this one command; do not run it against the consumed fixture above:

```powershell
python -B 'G:\CommanderTransfer\portable-source\reconstruct_frozen_r78_sources.py' --archive 'G:\CommanderTransfer\RETURN_R78.zip' --source-manifest 'G:\CommanderTransfer\SOURCE_INPUT_MANIFEST.json' --target 'G:\CommanderR79Sources-new' --receipt 'G:\CommanderTransfer\RECONSTRUCTION_RECEIPT-new.json'
```

Stop if any identity/hash/path gate fails, if the receipt or target already exists, or if persistence is uncertain. Read the preserved receipt and reconcile the output before choosing a new authorized action; never blindly rerun or loosen the guards. For a separately authorized R79 build, `FrozenR78SourceRoot` must refer to the reconstructed root (the directory above `reviews`), not the archive's historic G: path. This task did not execute a build command.

## Public GitHub recovery alternative

`PUBLIC_SOURCE_RECOVERY_MAP.json` maps all six target relative paths to exact ZIP entries, full-commit GitHub blob/raw URLs, byte lengths, Git blob SHA and expected SHA256. All six public files were actually fetched through the connected GitHub tool at the immutable commit and independently SHA256-checked in memory; they exactly match the archive/frozen inputs. No public source download was executed or installed.

If the Return ZIP is unavailable, obtain only those six public source files from the **full commit URLs** in that map, verify each SHA256, and place each file under its mapped `targetRelativePath` in a separately admitted fresh owned source root. Preserve LF/CRLF bytes exactly; do not copy text via a renderer or fetch a moving branch/default ref. The ZIP helper deliberately has no network fallback: an absent/mismatched ZIP stops rather than silently switching source identity. A separate public-source transport requires its own fresh receipt and the same six-file verification before build use.

## Failure learning and next gate

No reconstruction or product-runtime failure occurred. Two earlier read-only public-provenance hash transports hit size boundaries before execution: Windows process command length (206), then the Node tool's 64,000-byte review limit. They produced no extraction/launch/job action. The alternative used one already-fetched public source per bounded in-memory hash call; all six succeeded. Details are preserved in `DIAGNOSTIC_NOTES.json`. Prevention: avoid embedding aggregate source bytes in shell arguments or oversized tool inputs; use bounded metadata processing and return only hashes/counts.

Roadmap: frozen six-source admission -> **portable reconstruction and public byte parity PASS <- here** -> parent integrates recovery instructions/publication -> separately accepted R79 build/runtime/owner acceptance/rollback/install gates. The latter gates are outside this task and remain controlled by the parent; source transfer success does not close them.

Parent action: retain this compact evidence and scripts in its R79 source/Return; reference the existing shared R78 ZIP by path and SHA instead of copying archives/dependencies repeatedly. The fixture is source-only, not an installed release or a production backup. `DELIVERY_MANIFEST.json` hashes the five deliverable/evidence files plus this handoff and the pure guard checker, with the actual receipt binding the helper used. No independent Return ZIP is produced here because the parent owns the cumulative R79 Return.
