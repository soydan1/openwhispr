const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  ensureFfmpegStatic,
  ffmpegBinaryName,
  ffmpegBinaryPath,
} = require("../../scripts/ensure-ffmpeg-static");

test("ffmpegBinaryName is platform-specific", () => {
  assert.equal(ffmpegBinaryName("darwin"), "ffmpeg");
  assert.equal(ffmpegBinaryName("linux"), "ffmpeg");
  assert.equal(ffmpegBinaryName("win32"), "ffmpeg.exe");
});

test("ffmpegBinaryPath points at the ffmpeg-static package", () => {
  assert.match(ffmpegBinaryPath("linux"), /ffmpeg-static[/\\]ffmpeg$/);
  assert.match(ffmpegBinaryPath("win32"), /ffmpeg-static[/\\]ffmpeg\.exe$/);
});

test("ensureFfmpegStatic returns the existing binary without spawning", () => {
  const pkgDir = "/tmp/ffmpeg-static-fixture";
  const binaryPath = path.join(pkgDir, "ffmpeg");
  let spawned = false;
  const result = ensureFfmpegStatic({
    pkgDir,
    platform: "linux",
    exists: (candidate) => candidate === binaryPath,
    spawn: () => {
      spawned = true;
      return { status: 0 };
    },
  });
  assert.equal(result, binaryPath);
  assert.equal(spawned, false);
});

test("ensureFfmpegStatic fails closed when the package is not installed", () => {
  assert.throws(
    () =>
      ensureFfmpegStatic({
        pkgDir: "/tmp/missing-ffmpeg-static",
        platform: "darwin",
        exists: () => false,
        spawn: () => ({ status: 0 }),
      }),
    /ffmpeg-static is not installed/
  );
});

test("ensureFfmpegStatic runs install.js when the binary is missing", () => {
  const pkgDir = "/tmp/ffmpeg-static-fixture";
  const installJs = path.join(pkgDir, "install.js");
  const binaryPath = path.join(pkgDir, "ffmpeg");
  const present = new Set([installJs]);
  const result = ensureFfmpegStatic({
    pkgDir,
    platform: "linux",
    exists: (candidate) => present.has(candidate),
    spawn: (cmd, args, options) => {
      assert.equal(args[0], installJs);
      assert.equal(options.cwd, pkgDir);
      present.add(binaryPath);
      return { status: 0 };
    },
  });
  assert.equal(result, binaryPath);
});
