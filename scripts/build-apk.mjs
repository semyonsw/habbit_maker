// Build the Android debug APK from whatever is currently in the source tree.
//
// There are three steps and skipping any one of them fails silently rather
// than loudly:
//
//   1. build-www.mjs   -- stage the web assets into www/
//   2. cap sync        -- copy www/ into android/app/src/main/assets/public
//   3. gradlew         -- package that directory into the APK
//
// Step 2 only stages; it does not build. Step 3 alone repackages assets that
// may be several edits old. Either way you get a BUILD SUCCESSFUL and an APK
// that does not contain your changes, which is a genuinely confusing failure
// on a device. So this runs all three, every time, and prints what came out.
//
// Finally it copies the result to habit-maker.apk in the repo root. Gradle's
// own output path is six directories down and named app-debug.apk, which is
// neither memorable nor obviously this app; the root copy is the one to put on
// the phone. It is gitignored -- see the note next to ROOT_APK below.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:process";
import { crc32 } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WWW = join(ROOT, "www");
const ANDROID = join(ROOT, "android");
const APK = join(ANDROID, "app/build/outputs/apk/debug/app-debug.apk");

// The copy you actually install. Deliberately a STABLE filename, not one with
// the version in it: the point is to overwrite the same file on the phone every
// time, and a name that changes each release defeats that.
//
// Gitignored on purpose. It is ~10MB, git keeps every version of it for ever,
// and committing one per release turns a 2MB source repo into a slow clone
// within a year. Publish a GitHub Release if it ever needs to be downloadable.
const ROOT_APK = join(ROOT, "habit-maker.apk");
const IS_WINDOWS = platform === "win32";

function fail(message) {
  console.error(`\nbuild-apk: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    // Needed for .cmd shims (npx, gradlew.bat) on Windows.
    shell: IS_WINDOWS,
  });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with ${result.status}`);
}

// Capacitor's Android library is compiled at Java 21, so a JDK 17 that happens
// to be first on PATH produces an unhelpful class-file-version error deep in
// the gradle output. Check up front instead.
function resolveJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    "/usr/lib/jvm/java-21-openjdk-amd64",
    "/usr/lib/jvm/java-21-openjdk",
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home",
  ].filter(Boolean);

  for (const home of candidates) {
    const java = join(home, "bin", IS_WINDOWS ? "java.exe" : "java");
    if (!existsSync(java)) continue;
    // `java -version` writes to stderr on every JDK ever shipped.
    const probe = spawnSync(java, ["-version"], { encoding: "utf8" });
    const major = parseInt(
      String(`${probe.stderr || ""}${probe.stdout || ""}`).match(
        /version "(\d+)/,
      )?.[1],
      10,
    );
    if (major >= 21) return home;
    console.warn(`build-apk: skipping JDK ${major || "?"} at ${home}`);
  }

  fail(
    "no JDK 21+ found. Set JAVA_HOME to one (see ANDROID.md) and run this again.",
  );
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The filename is stable, so the summary has to say which build it is --
// otherwise there is no way to tell the file on the phone from the new one.
function readVersion() {
  try {
    const gradle = readFileSync(join(ANDROID, "app/build.gradle"), "utf8");
    const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
    const code = gradle.match(/versionCode\s+(\d+)/)?.[1];
    if (!name || !code) return "";
    return ` v${name} (versionCode ${code})`;
  } catch {
    return "";
  }
}

/* ------------------------------------------------------ freshness assertion */

// An APK is a zip, and every entry's CRC-32 is recorded in the central
// directory -- so the shipped assets can be checked against the staged ones
// without unpacking anything, and without a zip dependency.
//
// This exists because the timestamp is not evidence: when the merged inputs
// have not changed, gradle leaves the existing APK alone, so a correct build
// can carry an hours-old mtime. The only honest question is whether the bytes
// inside match www/, and that is what this answers.
function readApkEntryCrcs(apkPath) {
  const buf = readFileSync(apkPath);

  // The end-of-central-directory record sits at the very end, after a comment
  // of up to 64KB, so scan back for its signature.
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) fail("could not read the APK: no end-of-central-directory.");

  const entryCount = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);

  const crcs = new Map();
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const crc = buf.readUInt32LE(at + 16);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    crcs.set(name, crc >>> 0);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return crcs;
}

function listFilesRecursive(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(full) : [full];
  });
}

function verifyApkMatchesStagedAssets(apkPath) {
  const crcs = readApkEntryCrcs(apkPath);
  const stale = [];
  let checked = 0;

  for (const file of listFilesRecursive(WWW)) {
    // Zip paths are always forward-slashed, whatever the host separator is.
    const entry = `assets/public/${relative(WWW, file).split(sep).join("/")}`;
    const packaged = crcs.get(entry);
    checked += 1;
    if (packaged === undefined) {
      stale.push(`${entry} (missing from the APK)`);
    } else if (packaged !== (crc32(readFileSync(file)) >>> 0)) {
      stale.push(entry);
    }
  }

  if (stale.length) {
    fail(
      `the APK does not match www/. ${stale.length} of ${checked} files are ` +
        `stale or missing:\n  ${stale.slice(0, 10).join("\n  ")}\n` +
        `Try again after: cd android && ./gradlew clean`,
    );
  }
  return checked;
}

// --verify-only answers "is the APK I have current?" without spending a build
// on the question. Assumes www/ is already staged, which it is after any run.
const verifyOnly = process.argv.includes("--verify-only");

if (!verifyOnly) {
  const javaHome = resolveJavaHome();

  console.log("build-apk: 1/3 staging web assets");
  run(process.execPath, [join(ROOT, "scripts/build-www.mjs")]);

  console.log("\nbuild-apk: 2/3 copying them into the Android project");
  run(IS_WINDOWS ? "npx.cmd" : "npx", ["cap", "sync", "android"]);

  console.log(`\nbuild-apk: 3/3 packaging the APK (JDK at ${javaHome})`);
  run(join(ANDROID, IS_WINDOWS ? "gradlew.bat" : "gradlew"), ["assembleDebug"], {
    cwd: ANDROID,
    env: { ...process.env, JAVA_HOME: javaHome },
  });
}

if (!existsSync(WWW)) fail("www/ is missing. Run without --verify-only.");
if (!existsSync(APK)) {
  fail(
    verifyOnly
      ? `no APK at ${APK}. Run without --verify-only to build one.`
      : `gradle reported success but ${APK} is missing.`,
  );
}

const fileCount = verifyApkMatchesStagedAssets(APK);
const { size } = statSync(APK);

// Copied only after the CRC check has passed, so the file in the root is never
// a stale build that merely looks current.
try {
  copyFileSync(APK, ROOT_APK);
} catch (error) {
  fail(`built the APK but could not copy it to the root: ${error.message}`);
}

console.log(
  `\nbuild-apk: ${verifyOnly ? "up to date" : "done"}${readVersion()}\n` +
    `           ${formatSize(size)}, and all ${fileCount} web files in it ` +
    `match www/ (CRC-checked)\n\n` +
    `  ->  habit-maker.apk  (repo root -- this is the one to put on the phone)\n\n` +
    `Install with:  adb install -r "${ROOT_APK}"\n` +
    `(or copy habit-maker.apk to the phone and open it from a file manager)`,
);
