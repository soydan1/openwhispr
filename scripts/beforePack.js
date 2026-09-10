const { ensureFfmpegStatic } = require("./ensure-ffmpeg-static");

// Runs before electron-builder copies node_modules, so a missing
// ffmpeg-static binary (npm ci --ignore-scripts) is downloaded in time.
exports.default = async function beforePack() {
  ensureFfmpegStatic();
};
