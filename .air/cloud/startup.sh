#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# Match CI's Node 24 runtime; keep the installation in the warm snapshot.
node_prefix="$HOME/.local/share/air-node-24.13.0"
if [ ! -x "$node_prefix/node_modules/.bin/node" ]; then
  echo 'Installing Node 24.13.0 in userspace...'
  npm install --prefix "$node_prefix" --no-save --package-lock=false node@24.13.0
fi
export PATH="$node_prefix/node_modules/.bin:$PATH"

# Startup runs in a child shell. Persist the runtime for future agent shells.
mkdir -p "$HOME/.config/air"
cat > "$HOME/.config/air/skill-atlas-env.sh" <<'EOF'
export PATH="$HOME/.local/share/air-node-24.13.0/node_modules/.bin:$PATH"
EOF
profile_file="$HOME/.profile"
for candidate in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -f "$candidate" ]; then
    profile_file="$candidate"
    break
  fi
done
source_line='[ ! -f "$HOME/.config/air/skill-atlas-env.sh" ] || . "$HOME/.config/air/skill-atlas-env.sh" # air-skill-atlas'
for shell_file in "$profile_file" "$HOME/.bashrc"; do
  if ! grep -Fq '# air-skill-atlas' "$shell_file" 2>/dev/null; then
    printf '\n%s\n' "$source_line" >> "$shell_file"
  fi
done

echo "Preparing Skill Atlas with $(node --version) and npm $(npm --version)..."
npm ci --prefer-offline --no-fund
echo 'Dependencies ready.'

healthcheck() {
  echo 'Checking TypeScript, integration tests, and CLI fixture scanning...'
  npm run typecheck || return "$?"
  npm test || return "$?"
  ./skill-atlas help || return "$?"
  ./skill-atlas scan ./fixture || return "$?"
  echo 'Skill Atlas environment verified.'
}

# This CLI has no long-running services. Tests only block snapshot warmup.
if [ "${AIR_STARTUP_MODE:-}" = warmup ]; then
  healthcheck
fi
