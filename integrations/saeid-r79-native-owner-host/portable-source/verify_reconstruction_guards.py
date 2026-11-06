"""Small pure guard regression; does not extract, execute reconstructed code or install."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import runpy
import sys

sys.dont_write_bytecode = True
root = Path(__file__).parent
helper = root / "reconstruct_frozen_r78_sources.py"
ast.parse(helper.read_bytes())
api = runpy.run_path(str(helper))
checks = ["syntax"]
for bad in ("../x.cs", "/x.cs", "a/../x.cs", "a//x.cs", "a\\x.cs", "a/x.cs:stream", "CON.cs", "a/NUL", "a/x. ", "a/./x", "a/", "C:/x"):
    try:
        api["relative_path"](bad)
    except ValueError:
        checks.append("reject_path:" + bad)
    else:
        raise AssertionError("UNSAFE_PATH_ACCEPTED")
manifest = json.loads((root.parent / "SOURCE_INPUT_MANIFEST.json").read_text(encoding="utf-8-sig"))
api["validate_manifest"](manifest)
checks.append("admit_exact_frozen_dependencies")
for label, mutate in (
    ("bad_hash", lambda m: m["dependencies"][0].update(sha256="0" * 64)),
    ("missing_source", lambda m: m["dependencies"].pop()),
    ("duplicate_source", lambda m: m["dependencies"].__setitem__(0, m["dependencies"][1])),
    ("bad_archive", lambda m: m.update(r78ReturnSha256="0" * 64)),
    ("traversal_dependency", lambda m: m["dependencies"][0].update(path="../source.cs")),
):
    changed = copy.deepcopy(manifest)
    mutate(changed)
    try:
        api["validate_manifest"](changed)
    except ValueError:
        checks.append("reject_manifest:" + label)
    else:
        raise AssertionError("BAD_MANIFEST_ACCEPTED:" + label)
try:
    api["parse_json"](b'{"dependencies":[],"dependencies":[]}')
except ValueError:
    checks.append("reject_duplicate_json_key")
else:
    raise AssertionError("DUPLICATE_JSON_ACCEPTED")
out = {"status": "PASS_PURE_GUARD_REGRESSION", "checkCount": len(checks), "checks": checks,
       "helperSha256": hashlib.sha256(helper.read_bytes()).hexdigest(),
       "filesystemMutationByChecks": False, "sourceExecution": False, "scope": "Syntax/path/manifest guards only"}
with (root / "GUARD_REGRESSION_RECEIPT.json").open("x", encoding="utf-8") as handle:
    json.dump(out, handle, indent=2)
    handle.write("\n")
print(json.dumps({"status": out["status"], "checkCount": len(checks), "helperSha256": out["helperSha256"]}))
