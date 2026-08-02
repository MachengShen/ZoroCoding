#!/bin/zsh

set -euo pipefail

script_path="${0:A}"

scan_credential_shapes() {
  local label="$1"
  local mode="$2"
  shift 2

  node - "$label" "$mode" "$@" <<'NODE'
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { lstatSync, readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");

const [label, mode, ...inputs] = process.argv.slice(2);
const files = [];

function posixRelative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function collect(target, root) {
  let entry;
  try {
    entry = lstatSync(target);
  } catch {
    return;
  }
  if (entry.isSymbolicLink()) {
    return;
  }
  if (entry.isDirectory()) {
    for (const child of readdirSync(target)) {
      collect(path.join(target, child), root);
    }
    return;
  }
  if (entry.isFile()) {
    if (target.endsWith(".asar")) {
      return;
    }
    files.push({
      absolutePath: target,
      relativePath: posixRelative(root, target),
    });
  }
}

if (mode === "tracked") {
  const [projectRoot] = inputs;
  const tracked = execFileSync(
    "git",
    ["-C", projectRoot, "ls-files", "-z"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  ).split("\0").filter(Boolean);
  for (const relativePath of tracked) {
    if (!relativePath.startsWith("tests/")) {
      collect(path.join(projectRoot, relativePath), projectRoot);
    }
  }
} else if (mode === "paths") {
  for (const target of inputs) {
    let entry;
    try {
      entry = lstatSync(target);
    } catch {
      continue;
    }
    collect(target, entry.isDirectory() ? target : path.dirname(target));
  }
} else {
  throw new Error("Unknown credential audit mode");
}

const credentialShapes = [
  ["kimi-generic-sk", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["groq-gsk", /\bgsk_[A-Za-z0-9_-]{20,}\b/g],
  ["gemini-aq", /\bAQ\.[A-Za-z0-9_-]{20,}\b/g],
  ["openrouter-sk-or-v1", /\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/g],
  ["cerebras-csk", /\bcsk-[A-Za-z0-9_-]{20,}\b/g],
  ["nvidia-nvapi", /\bnvapi-[A-Za-z0-9_-]{20,}\b/g],
  [
    "zhipu-hex-dot-suffix",
    /\b[0-9a-fA-F]{32}\.[A-Za-z0-9_-]{6,}\b/g,
  ],
  [
    "sambanova-uuid",
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/g,
  ],
];
const quotedThirtyTwo = /(["'])([A-Za-z0-9]{32})\1/g;
const hits = [];
const reviewedPublicFixtures = new Map([
  [
    "docs/design/zorocoding-provider-settings-concept.png",
    new Set([
      "sambanova-uuid:a602d746c707eded283832fc7e607d75cde98a0c1a1c6002c383ec683199cd41",
    ]),
  ],
  [
    "docs/design/zorocoding-workbench-concept.png",
    new Set([
      "sambanova-uuid:c6b71326a36671c9f65bc3c78b3f2b695d4c866bd17f4209d35fb10be7c55260",
    ]),
  ],
  [
    "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c",
    new Set([
      "mistral-quoted-mixed-32:5f31ae198b74f7f8ffab28d4db37709262a1da0ac6841d257be016f48a08fad6",
    ]),
  ],
  [
    "node_modules/better-sqlite3/prebuilds/darwin-arm64.node",
    new Set([
      "sambanova-uuid:8059e132baf84ed367a5963cb7b01c1728b25e045913ec2a16a99945c9bd907b",
    ]),
  ],
  [
    "node_modules/node-addon-api/napi-inl.h",
    new Set([
      "sambanova-uuid:8059e132baf84ed367a5963cb7b01c1728b25e045913ec2a16a99945c9bd907b",
    ]),
  ],
  [
    "node_modules/zod/src/v3/tests/string.test.ts",
    new Set([
      "sambanova-uuid:1cd6dc37ee29282e6e2b0d7f1f98eeb05a0bc34e75f1aef5d47c333236a56d26",
    ]),
  ],
  [
    "node_modules/zod/src/v4/classic/tests/from-json-schema.test.ts",
    new Set([
      "sambanova-uuid:a3a9e1ed9732cab28868127be00f1ce921acaefdd5c3b23a6e9e0072bd9c1a34",
    ]),
  ],
  [
    "node_modules/zod/src/v4/classic/tests/string.test.ts",
    new Set([
      "sambanova-uuid:852fb45376a1c5e2789c62c947a2582b3af1afe9331b2721a81875cdb3babbba",
      "sambanova-uuid:5f3b5f562474ef8de28cd3bb2994f0ab7d1216075458e91be7d4a2513436d310",
      "sambanova-uuid:5d73145aeb2d88f498e884d0d83c222f3ec8edabf73712972d2e2fbd19dd10bd",
      "sambanova-uuid:1cd6dc37ee29282e6e2b0d7f1f98eeb05a0bc34e75f1aef5d47c333236a56d26",
      "sambanova-uuid:5ec503a80fdc20ae63520beac881ee8ec9cf0f8233696549ea1587e948c36037",
      "sambanova-uuid:b4810fb59ef2d05c06dd8691a9fd53c2f3a55d19980adc6afab027c9ca71a45e",
      "sambanova-uuid:ea7321cb528af74063a5f0aa0ab392f257f69b3e2b222421074f58f56655fc57",
      "sambanova-uuid:ea9dce1203634c0d43d4b3caacba4c6881ab0cdef5e115d4c501d707a5176cf5",
    ]),
  ],
  [
    "node_modules/zod/src/v4/classic/tests/template-literal.test.ts",
    new Set([
      "sambanova-uuid:416e9c4b20fa6c3ffced925d6f5db7e06acb01dc7f6518929670a37652ee589d",
    ]),
  ],
  [
    "node_modules/zod/src/v4/mini/tests/string.test.ts",
    new Set([
      "sambanova-uuid:a3a9e1ed9732cab28868127be00f1ce921acaefdd5c3b23a6e9e0072bd9c1a34",
    ]),
  ],
]);

function isExplicitlyAllowed(relativePath, shape, value) {
  const digest = createHash("sha256").update(value).digest("hex");
  const allowed = reviewedPublicFixtures.get(relativePath);
  return allowed?.has(`${shape}:${digest}`) === true;
}

for (const file of files) {
  const text = readFileSync(file.absolutePath).toString("utf8");
  const matchedShapes = new Set();
  for (const [name, pattern] of credentialShapes) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (!isExplicitlyAllowed(file.relativePath, name, match[0])) {
        matchedShapes.add(name);
        break;
      }
    }
  }
  quotedThirtyTwo.lastIndex = 0;
  for (const match of text.matchAll(quotedThirtyTwo)) {
    const candidate = match[2];
    if (
      /[A-Z]/.test(candidate) &&
      /[a-z]/.test(candidate) &&
      /[0-9]/.test(candidate) &&
      !isExplicitlyAllowed(
        file.relativePath,
        "mistral-quoted-mixed-32",
        candidate,
      )
    ) {
      matchedShapes.add("mistral-quoted-mixed-32");
      break;
    }
  }
  if (matchedShapes.size > 0) {
    hits.push(file.absolutePath);
  }
}

if (hits.length > 0) {
  console.error(`${label}: credential-shaped content found in ${hits.length} file(s)`);
  for (const file of hits) {
    console.error(file);
  }
  process.exit(1);
}
console.log(`${label}: credential audit passed (${files.length} files)`);
NODE
}

validate_dmg_staging() {
  local candidate_root="$1"
  local entries=("$candidate_root"/*(DN))
  local app_seen=0
  local instructions_seen=0
  local unexpected_seen=0

  for entry in "${entries[@]}"; do
    case "${entry:t}" in
      ZoroCoding.app)
        [[ ! -L "$entry" && -d "$entry" ]] &&
          app_seen=1 || unexpected_seen=1
        ;;
      ZoroCoding-安装说明.md)
        [[ ! -L "$entry" && -f "$entry" ]] &&
          instructions_seen=1 || unexpected_seen=1
        ;;
      *)
        unexpected_seen=1
        ;;
    esac
  done

  if (( ${#entries[@]} != 2 || app_seen != 1 ||
        instructions_seen != 1 || unexpected_seen != 0 )); then
    echo "DMG staging root must contain only ZoroCoding.app and installation instructions." >&2
    printf '%s\n' "${entries[@]}" >&2
    return 1
  fi
}

validate_sandbox_preload() {
  local preload_dir="$1"
  local validator_path="${script_path:h}/validate-preload.mjs"

  if [[ -L "$preload_dir" || ! -d "$preload_dir" ]]; then
    echo "Sandbox preload must be one self-contained bundle: $preload_dir" >&2
    return 1
  fi

  local preload_path="$preload_dir/index.js"
  local preload_entries=("$preload_dir"/*(DN))
  if (( ${#preload_entries[@]} != 1 )) ||
    [[ "${preload_entries[1]}" != "$preload_path" ||
      -L "$preload_path" || ! -f "$preload_path" ]]; then
    echo "Sandbox preload must be one self-contained bundle: $preload_dir" >&2
    return 1
  fi

  if [[ -L "$validator_path" || ! -f "$validator_path" ]]; then
    echo "Sandbox preload validator is unavailable." >&2
    return 1
  fi
  node "$validator_path" "$preload_path"
}

case "${1:-}" in
  --audit-paths)
    shift
    if (( $# == 0 )); then
      echo "At least one credential-audit path is required." >&2
      exit 1
    fi
    scan_credential_shapes "requested-paths" paths "$@"
    exit 0
    ;;
  --validate-staging)
    if (( $# != 2 )); then
      echo "Exactly one staging path is required." >&2
      exit 1
    fi
    validate_dmg_staging "$2"
    exit 0
    ;;
  --validate-preload)
    if (( $# != 2 )); then
      echo "Exactly one preload bundle path is required." >&2
      exit 1
    fi
    validate_sandbox_preload "$2"
    exit 0
    ;;
esac

run_full_flow() {
  local project_dir="$(cd "$(dirname "$script_path")/.." && pwd)"
  local package_json="$project_dir/package.json"
  local version="$(node -p "require(process.argv[1]).version" "$package_json")"
  local architecture="$(node -p "require(process.argv[1]).config.release_arch" "$package_json")"

  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
    echo "Invalid package version" >&2
    return 1
  fi
  case "$architecture" in
    arm64|x64|universal) ;;
    *)
      echo "Unsupported release architecture" >&2
      return 1
      ;;
  esac

  local release_dir="$project_dir/release"
  local app_path="$release_dir/mac-$architecture/ZoroCoding.app"
  local dmg_path="$release_dir/ZoroCoding-$version-$architecture.dmg"
  local work_dir="$(mktemp -d "${TMPDIR:-/tmp}/zorocoding-dmg.XXXXXX")"
  local staging_dir="$work_dir/staging"
  local hybrid_output="$work_dir/ZoroCoding.cdr"
  local hybrid_path="$hybrid_output.dmg"

  set +e
  (
    set -euo pipefail
    local stale_artifacts=()
    for candidate in \
      "$release_dir"/ZoroCoding-*.dmg(N) \
      "$release_dir"/ZoroCoding-*.dmg.sha256(N); do
      if [[ "$candidate" != "$dmg_path" &&
            "$candidate" != "$dmg_path.sha256" ]]; then
        stale_artifacts+=("$candidate")
      fi
    done
    if (( ${#stale_artifacts[@]} > 0 )); then
      echo "Stale release artifacts found; archive them before packaging:" >&2
      printf '%s\n' "${stale_artifacts[@]}" >&2
      exit 1
    fi

    if [[ ! -d "$app_path" ]]; then
      echo "ZoroCoding.app was not found at $app_path" >&2
      exit 1
    fi

    scan_credential_shapes "tracked-non-tests" tracked "$project_dir"
    scan_credential_shapes \
      "runtime" \
      paths \
      "$project_dir/dist-electron" \
      "$project_dir/dist-renderer"

    local asar_path="$app_path/Contents/Resources/app.asar"
    local asar_audit_dir="$work_dir/app-asar-audit"
    if [[ ! -f "$asar_path" ]]; then
      echo "app.asar was not found at $asar_path" >&2
      exit 1
    fi
    npx asar extract "$asar_path" "$asar_audit_dir"
    scan_credential_shapes "app.asar" paths "$asar_audit_dir"
    validate_sandbox_preload \
      "$asar_audit_dir/dist-electron/preload"

    local asar_unpacked_path="$app_path/Contents/Resources/app.asar.unpacked"
    if [[ -e "$asar_unpacked_path" ]]; then
      scan_credential_shapes "app.asar.unpacked" paths "$asar_unpacked_path"
    fi

    # Produce a structurally valid local build even when no Developer ID
    # certificate is available. Public distribution still requires a real
    # Developer ID signature and notarization.
    codesign --force --deep --sign - "$app_path"
    codesign --verify --deep --strict "$app_path"

    mkdir -p "$staging_dir"
    ditto "$app_path" "$staging_dir/ZoroCoding.app"
    ditto "$project_dir/README.md" "$staging_dir/ZoroCoding-安装说明.md"
    validate_dmg_staging "$staging_dir"
    scan_credential_shapes \
      "dmg-installation-instructions" \
      paths \
      "$staging_dir/ZoroCoding-安装说明.md"

    hdiutil makehybrid \
      -hfs \
      -hfs-volume-name "ZoroCoding $version" \
      -o "$hybrid_output" \
      -ov \
      "$staging_dir"

    hdiutil convert "$hybrid_path" -format UDZO -o "$dmg_path" -ov
    hdiutil verify "$dmg_path" >/dev/null
    (
      cd "$release_dir"
      shasum -a 256 "$(basename "$dmg_path")"
    ) > "$dmg_path.sha256"

    scan_credential_shapes \
      "current-release-files" \
      paths \
      "$dmg_path" \
      "$dmg_path.sha256"

    local archive_dir="$release_dir/archive"
    if [[ -d "$archive_dir" ]]; then
      scan_credential_shapes "archived-release-files" paths "$archive_dir"
    fi
  )
  local full_flow_status=$?
  rm -rf "$work_dir"
  local cleanup_status=$?
  set -e

  if (( cleanup_status != 0 )); then
    echo "Failed to remove the release temporary directory." >&2
    return "$cleanup_status"
  fi
  return "$full_flow_status"
}

run_full_flow
