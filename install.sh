#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Habit Maker - installer for Linux, macOS and WSL
#
#      ./install.sh
#
#  The app has no runtime dependencies at all - the server is Python standard
#  library only - so this mostly *checks* your machine and then proves the app
#  really runs on it.  On Windows, double-click Install.bat instead.
# ---------------------------------------------------------------------------

APP_NAME='Habit Maker'
APP_BLURB='A local-first habit tracker and PDF reader. Your data never leaves this PC.'
APP_ISSUES='https://github.com/semyonsw/habbit_maker/issues'

# ===========================================================================
#  INSTALLER ENGINE - shared by all of the projects in this family.
#  Everything below this line is generic. Configure the block above instead.
# ===========================================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$ROOT/install.log"
cd "$ROOT"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    B=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'
    YEL=$'\033[33m'; CYA=$'\033[36m'; RST=$'\033[0m'
else
    B=''; DIM=''; RED=''; GRN=''; YEL=''; CYA=''; RST=''
fi

STEP_NO=0
WARNINGS=()
FIXES=()

log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG" 2>/dev/null || true; }
say()  { printf '%s\n' "$*"; log "$*"; }
step() { STEP_NO=$((STEP_NO + 1)); printf '\n%s  [%d] %s%s\n' "$CYA" "$STEP_NO" "$*" "$RST"; log "STEP $STEP_NO: $*"; }
ok()   { printf '      %sok%s   %s\n' "$GRN" "$RST" "$*"; log "  ok    $*"; }
info() { printf '           %s%s%s\n' "$DIM" "$*" "$RST"; log "  info  $*"; }
fixed(){ printf '      %sfixed%s  %s\n' "$GRN" "$RST" "$*"; log "  fixed $*"; FIXES+=("$*"); }
warn() {
    printf '      %swarn%s %s\n' "$YEL" "$RST" "$1"
    [ $# -gt 1 ] && printf '           %s-> %s%s\n' "$YEL" "$2" "$RST"
    log "  warn  $1 :: ${2:-}"
    WARNINGS+=("$1|${2:-}")
}

box() {
    local colour="$1"; shift
    local width=0 l
    for l in "$@"; do [ ${#l} -gt $width ] && width=${#l}; done
    width=$((width + 2))
    printf '%s  ┌' "$colour"; printf '─%.0s' $(seq 1 $width); printf '┐%s\n' "$RST"
    for l in "$@"; do
        printf '%s  │%s %-*s %s│%s\n' "$colour" "$RST" $((width - 2)) "$l" "$colour" "$RST"
        log "| $l"
    done
    printf '%s  └' "$colour"; printf '─%.0s' $(seq 1 $width); printf '┘%s\n' "$RST"
}

die() {
    local msg="$1"; shift
    log "FAILED: $msg"
    printf '\n'
    box "$RED" "INSTALL STOPPED - nothing is broken, it just did not finish"
    printf '\n  %sWhat went wrong:%s\n    %s\n' "$RED" "$RST" "$msg"
    if [ $# -gt 0 ]; then
        printf '\n  %sHow to fix it:%s\n' "$YEL" "$RST"
        local l; for l in "$@"; do printf '    %s\n' "$l"; log "FIX: $l"; done
    fi
    printf '\n  %sStill stuck?%s\n' "$B" "$RST"
    printf '    1. Full log:  %s\n' "$LOG"
    printf '    2. Troubleshooting table in INSTALL.md\n'
    [ -n "${APP_ISSUES:-}" ] && printf '    3. Open an issue with install.log attached:  %s\n' "$APP_ISSUES"
    printf '\n'
    exit 1
}

run() {   # run <logfile-label> <cmd...>  -> sets RUN_OUT, returns exit code
    local label="$1"; shift
    log "  run   $*"
    RUN_OUT="$("$@" 2>&1)"
    local rc=$?
    log "  exit  $rc"
    [ -n "$RUN_OUT" ] && log "  ----- $RUN_OUT"
    return $rc
}

have() { command -v "$1" >/dev/null 2>&1; }

pkg_hint() {   # how to install a system package on this distro
    if   have apt-get; then echo "sudo apt-get update && sudo apt-get install -y $1"
    elif have dnf;     then echo "sudo dnf install -y $1"
    elif have pacman;  then echo "sudo pacman -S --noconfirm $1"
    elif have zypper;  then echo "sudo zypper install -y $1"
    elif have brew;    then echo "brew install $1"
    else                    echo "install '$1' with your system package manager"
    fi
}

# --------------------------------------------------------------------------
#  Python
# --------------------------------------------------------------------------

py_version() { "$1" -c 'import sys;print("%d.%d.%d"%sys.version_info[:3])' 2>/dev/null; }

ver_ge() {   # ver_ge 3.11.2 3.10  -> 0 if first >= second
    [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]
}

BAD_PYTHONS=()

find_python() {
    local min="$1" c v
    BAD_PYTHONS=()
    for c in python3.12 python3.13 python3.11 python3.10 python3 python; do
        have "$c" || continue
        v="$(py_version "$c")" || continue
        [ -n "$v" ] || continue
        case "$v" in 2.*) continue ;; esac
        # A Python that cannot import ssl cannot download anything, and one
        # without venv/sqlite3 fails later in a far more confusing way.
        if ! "$c" -c 'import ssl,sqlite3,venv' >/dev/null 2>&1; then
            info "found Python $v ($(command -v "$c")) but it is missing ssl/sqlite3/venv - skipping it"
            BAD_PYTHONS+=("Python $v at $(command -v "$c")")
            continue
        fi
        info "found Python $v  ($(command -v "$c"))"
        if ver_ge "$v" "$min"; then PY="$(command -v "$c")"; PY_VER="$v"; return 0; fi
    done
    return 1
}

require_python() {
    local min="$1"
    if find_python "$min"; then ok "using Python $PY_VER"; return 0; fi
    local -a fix=("Install Python $min or newer:" "  $(pkg_hint 'python3 python3-venv python3-pip')")
    if [ ${#BAD_PYTHONS[@]} -gt 0 ]; then
        fix+=("" "A Python is installed but incomplete:")
        local b; for b in "${BAD_PYTHONS[@]}"; do fix+=("  - $b"); done
        fix+=("On Debian/Ubuntu the venv module ships separately: $(pkg_hint python3-venv)")
    fi
    die "Python $min or newer was not found." "${fix[@]}"
}

explain_pip() {
    local o="$1"
    case "$o" in
        *"No module named venv"*|*ensurepip*)
            PIP_WHY="this Python has no 'venv' module - on Debian/Ubuntu it ships separately."
            PIP_FIX=("$(pkg_hint python3-venv)" "then run ./install.sh again") ;;
        *"Python.h"*|*"gcc' failed"*|*"error: command 'cc'"*)
            PIP_WHY="a package had to be compiled and the C build tools are missing."
            PIP_FIX=("$(pkg_hint 'build-essential python3-dev')" "then run ./install.sh again") ;;
        *CERTIFICATE_VERIFY_FAILED*|*SSLError*)
            PIP_WHY="the HTTPS connection to pypi.org could not be verified."
            PIP_FIX=("Behind a proxy?  export HTTPS_PROXY=http://proxy:8080" "Otherwise update your CA certificates: $(pkg_hint ca-certificates)") ;;
        *"No matching distribution"*|*"Could not find a version"*)
            PIP_WHY="no build of one of the packages exists for Python $PY_VER."
            PIP_FIX=("Install Python 3.11 or 3.12 and re-run:  $(pkg_hint python3.12)" "then delete .venv and run ./install.sh again") ;;
        *"Temporary failure in name resolution"*|*ETIMEDOUT*|*"Network is unreachable"*|*"Connection reset"*)
            PIP_WHY="pypi.org could not be reached - the network is down or blocked."
            PIP_FIX=("Check the connection and run ./install.sh again.") ;;
        *"No space left"*)
            PIP_WHY="the disk is full."
            PIP_FIX=("Free up a couple of gigabytes and run ./install.sh again.") ;;
        *"Permission denied"*)
            PIP_WHY="pip could not write to the target folder."
            PIP_FIX=("Do not run this with sudo - the installer keeps everything in .venv inside the project." "Check you own this folder:  ls -ld \"$ROOT\"") ;;
        *)
            PIP_WHY="pip stopped with an error (full text at the end of install.log)."
            PIP_FIX=("Read the last lines of install.log - they name the package that failed.") ;;
    esac
}

pip_install() {   # pip_install <label> <args...>
    local label="$1"; shift
    local out=""
    local attempt
    for attempt in 1 2 3; do
        case $attempt in
            2) info "retrying with a longer timeout" ;;
            3) info "retrying with pre-built wheels only" ;;
        esac
        local -a flags=(--disable-pip-version-check)
        [ $attempt -ge 2 ] && flags+=(--timeout 60 --retries 5)
        [ $attempt -ge 3 ] && flags+=(--only-binary :all:)
        if run pip "$VENV_PY" -m pip "$@" "${flags[@]}"; then
            if [ $attempt -gt 1 ]; then fixed "$label (succeeded on retry $attempt)"; else ok "$label"; fi
            return 0
        fi
        out="$RUN_OUT"
        case "$out" in *"No matching distribution"*|*"Could not find a version"*) break ;; esac
        [ $attempt -eq 1 ] && warn "$label failed on the first try."
    done
    explain_pip "$out"
    die "$label failed: $PIP_WHY" "${PIP_FIX[@]}"
}

# --------------------------------------------------------------------------
#  Node
# --------------------------------------------------------------------------

ensure_node() {
    local min="$1" v
    if have node; then
        v="$(node --version 2>/dev/null | tr -d 'v')"
        if [ -n "$v" ] && ver_ge "$v" "$min"; then ok "Node.js $v"; return 0; fi
        warn "Node.js ${v:-?} is older than the required $min."
    else
        warn "Node.js was not found."
    fi
    die "Node.js $min or newer is required." \
        "Install it with nvm (does not need root):" \
        "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash" \
        "  exec \$SHELL -l && nvm install --lts" \
        "or from your package manager:  $(pkg_hint nodejs)"
}

explain_npm() {
    local o="$1"
    case "$o" in
        *EBADENGINE*|*"Unsupported engine"*)
            NPM_WHY="the installed Node.js version is not supported by this project."
            NPM_FIX=("Install the current LTS:  nvm install --lts") ;;
        *ERESOLVE*)
            NPM_WHY="two packages asked for conflicting dependency versions."
            NPM_FIX=("Already retried with --legacy-peer-deps." "If it still fails: rm -rf node_modules package-lock.json && ./install.sh") ;;
        *EACCES*|*EPERM*)
            NPM_WHY="npm could not write into the project folder."
            NPM_FIX=("Do not use sudo. Fix ownership instead:  sudo chown -R \"\$(id -u):\$(id -g)\" \"$ROOT\"") ;;
        *ENOTFOUND*|*ETIMEDOUT*|*ECONNRESET*|*EAI_AGAIN*)
            NPM_WHY="the npm registry could not be reached."
            NPM_FIX=("Check the connection and try again." "Behind a proxy:  npm config set proxy http://proxy:8080") ;;
        *ENOSPC*)
            NPM_WHY="the disk is full, or the inotify watch limit was hit."
            NPM_FIX=("Free up disk space, or raise the watch limit:" "  echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p") ;;
        *)
            NPM_WHY="npm stopped with an error (full text at the end of install.log)."
            NPM_FIX=("Read the last lines of install.log - npm names the failing package.") ;;
    esac
}

npm_install() {   # npm_install <dir> <label>
    local dir="$1" label="$2" out="" attempt rc prev="$PWD"
    cd "$dir" || die "the folder $dir does not exist." "Re-clone the project - this download is incomplete."
    for attempt in 1 2 3; do
        local -a args
        case $attempt in
            1) if [ -f "$dir/package-lock.json" ]; then args=(ci --no-audit --no-fund)
               else args=(install --no-audit --no-fund); fi ;;
            2) info "retrying with 'npm install'"; args=(install --no-audit --no-fund) ;;
            3) info "retrying with --legacy-peer-deps"; args=(install --no-audit --no-fund --legacy-peer-deps) ;;
        esac
        run npm npm "${args[@]}"; rc=$?
        if [ $rc -eq 0 ]; then
            cd "$prev"
            if [ $attempt -gt 1 ]; then fixed "$label (succeeded on retry $attempt)"; else ok "$label"; fi
            return 0
        fi
        out="$RUN_OUT"
        [ $attempt -eq 1 ] && warn "$label failed on the first try."
    done
    cd "$prev"
    explain_npm "$out"
    die "$label failed: $NPM_WHY" "${NPM_FIX[@]}"
}

# --------------------------------------------------------------------------
#  Virtual environment
# --------------------------------------------------------------------------

ensure_venv() {
    local dir="$ROOT/$1"
    VENV_PY="$dir/bin/python"
    if [ -x "$VENV_PY" ] && py_version "$VENV_PY" >/dev/null; then
        ok "existing environment reused  ($1, Python $(py_version "$VENV_PY"))"
        return 0
    fi
    if [ -d "$dir" ]; then
        warn "the existing $1 folder is broken."
        info "deleting and rebuilding it..."
        rm -rf "$dir" || die "the old $1 folder could not be deleted." "Delete it by hand and run ./install.sh again:  rm -rf '$dir'"
        fixed "removed the broken environment"
    fi
    info "creating a private Python environment in $1 ..."
    if ! run venv "$PY" -m venv "$dir"; then
        explain_pip "$RUN_OUT"
        die "the private Python environment could not be created: $PIP_WHY" "${PIP_FIX[@]}"
    fi
    [ -x "$VENV_PY" ] || die "the environment was created but has no python in it." "Delete $1 and run ./install.sh again."
    ok "private Python environment created  ($1)"
}

check_imports() {
    local bad=() m
    for m in "$@"; do
        "$VENV_PY" -c "import $m" >/dev/null 2>&1 || bad+=("$m")
    done
    if [ ${#bad[@]} -eq 0 ]; then ok "all $# required packages import cleanly"; return 0; fi
    die "these packages installed but will not load: ${bad[*]}" \
        "Delete the .venv folder and run ./install.sh again - that rebuilds it from scratch."
}

finish() {
    printf '\n'
    box "$GRN" "INSTALL COMPLETE  -  $APP_NAME" "finished in $SECONDS seconds"
    if [ ${#FIXES[@]} -gt 0 ]; then
        printf '\n  %sProblems found and fixed along the way:%s\n' "$GRN" "$RST"
        local f; for f in "${FIXES[@]}"; do printf '    - %s\n' "$f"; done
    fi
    if [ ${#WARNINGS[@]} -gt 0 ]; then
        printf '\n  %sWarnings - the app will run, but read these:%s\n' "$YEL" "$RST"
        local w; for w in "${WARNINGS[@]}"; do
            printf '    - %s\n' "${w%%|*}"
            [ -n "${w#*|}" ] && printf '      %s%s%s\n' "$DIM" "${w#*|}" "$RST"
        done
    fi
    printf '\n  %sHow to start it:%s\n' "$B" "$RST"
    local n; for n in "${NEXT_STEPS[@]}"; do printf '    %s\n' "$n"; done
    printf '\n  %sFull log: %s%s\n\n' "$DIM" "$LOG" "$RST"
}

start_banner() {
    [ -f "$LOG" ] && mv -f "$LOG" "$LOG.old" 2>/dev/null
    log "installer started for $APP_NAME"
    log "$(uname -a)"
    printf '\n'
    box "$CYA" "$APP_NAME  -  Installer" "$APP_BLURB"
    printf '\n  %sThis installs everything the app needs. A full record goes to install.log.%s\n' "$DIM" "$RST"
}

NEXT_STEPS=(
    './start.sh                 starts the server and opens the app'
    'or:  python3 server/app.py     then open http://localhost:3000'
    ''
    'Your data:  data.db in this folder. Back up that one file and you have'
    'backed up everything - habits, notes, bookmarks and summaries.'
)

start_banner

step 'Checking this computer'
ok "$(uname -s) $(uname -r)"
ok "project folder: $ROOT"

step 'Looking for Python 3.10 or newer'
require_python 3.10

step 'Checking the modules the server uses'
VENV_PY="$PY"          # no virtual environment: there is nothing to install
check_imports sqlite3 http.server json urllib.request

step 'Proving the app actually runs on this PC'
info 'starting the server on a spare port against a throwaway database...'
if run selfcheck "$PY" "$ROOT/tools/selfcheck.py"; then
    while IFS= read -r l; do
        case "$l" in
            PASS*) ok "${l#PASS }" ;;
            FAIL*) warn "${l#FAIL }" ;;
        esac
    done <<< "$RUN_OUT"
else
    while IFS= read -r l; do
        case "$l" in FAIL*) warn "${l#FAIL }" ;; esac
    done <<< "$RUN_OUT"
    die 'the app did not pass its own self-check on this machine.' \
        'The warn lines above say what broke; the full output is at the end of install.log.' \
        'Most common cause: an incomplete download - re-clone the project and try again.'
fi

step 'Checking that port 3000 is free'
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ':3000 '; then
    warn 'something is already listening on port 3000.' \
         'Either close it, or start the app on another port:  HABIT_PORT=4000 ./start.sh'
else
    ok 'port 3000 is free'
fi

step 'Developer tools (optional)'
info 'the app itself needs none of this - it is the linter and the Android build.'
if [ -n "${SKIP_DEV_TOOLS:-}" ]; then
    ok 'skipped (SKIP_DEV_TOOLS is set)'
elif have node && ver_ge "$(node --version | tr -d v)" 18.0; then
    printf '      Install them with npm? [y/N] '
    read -r answer || answer=n
    case "${answer:-n}" in
        y|Y|yes|YES) npm_install "$ROOT" 'developer tools' ;;
        *) ok 'skipped - run ./install.sh again if you change your mind' ;;
    esac
else
    ok 'skipped - Node.js 18+ is not installed, and the app does not need it'
fi

step 'Making the launcher executable'
if chmod +x "$ROOT/start.sh" 2>/dev/null; then ok './start.sh is ready to run'
else warn 'could not make start.sh executable' 'Run it with: bash start.sh'; fi

finish
