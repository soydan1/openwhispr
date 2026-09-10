#!/usr/bin/env node
/**
 * ffmpeg-static ships without its binary; install.js downloads it. npm ci
 * --ignore-scripts skips that, and electron-builder then packs an empty
 * package. afterPack refuses to ship an app that cannot spawn FFmpeg.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function ffmpegBinaryName(platform = process.platform) {
  return platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function ffmpegStaticDir() {
  return path.join(__dirname, "..", "node_modules", "ffmpeg-static");
}

function ffmpegBinaryPath(platform = process.platform) {
  return path.join(ffmpegStaticDir(), ffmpegBinaryName(platform));
}

function ensureFfmpegStatic({
  pkgDir = ffmpegStaticDir(),
  platform = process.platform,
  exists = (candidate) => fs.existsSync(candidate),
  spawn = spawnSync,
} = {}) {
  const binaryPath = path.join(pkgDir, ffmpegBinaryName(platform));
  if (exists(binaryPath)) {
    console.log(`[ffmpeg-static] ${binaryPath} already present`);
    return binaryPath;
  }

  const installJs = path.join(pkgDir, "install.js");
  if (!exists(installJs)) {
    throw new Error(
      "ffmpeg-static is not installed. Run npm ci without --ignore-scripts, or: npm install ffmpeg-static"
    );
  }

  console.log("[ffmpeg-static] binary missing; running install.js");
  const result = spawn(process.execPath, [installJs], {
    cwd: pkgDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg-static install.js failed (exit ${result.status ?? "spawn"}). The packaged app cannot spawn FFmpeg.`
    );
  }
  if (!exists(binaryPath)) {
    throw new Error(`ffmpeg-static install.js finished but ${binaryPath} is still missing.`);
  }
  return binaryPath;
}

module.exports = {
  ensureFfmpegStatic,
  ffmpegBinaryName,
  ffmpegBinaryPath,
  ffmpegStaticDir,
};

if (require.main === module) {
  try {
    ensureFfmpegStatic();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
