/**
 * Upload ./dist to cPanel (FTP or SFTP). Configure via .env:
 *
 *   FTP_HOST          — server hostname (required)
 *   FTP_USER          — username (required)
 *   FTP_PASSWORD      — password (required)
 *   FTP_REMOTE_ROOT   — remote folder, default /public_html/
 *   FTP_PORT          — default 21 (FTP) or 22 when FTP_SFTP=true
 *   FTP_SFTP          — set true for SFTP (SSH), false for FTP
 *
 * Optional: FTP_DRY_RUN=true to print config and exit without connecting.
 */

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const FtpDeploy = require("ftp-deploy");

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");

function envBool(name, defaultValue = false) {
  const v = process.env[name];
  if (v == null || v === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function main() {
  const dryRun = envBool("FTP_DRY_RUN", false);
  const sftp = envBool("FTP_SFTP", false);

  const host = process.env.FTP_HOST?.trim();
  const user = process.env.FTP_USER?.trim();
  const password = process.env.FTP_PASSWORD ?? "";

  let remoteRoot = process.env.FTP_REMOTE_ROOT?.trim() || "/public_html/";
  if (!remoteRoot.endsWith("/")) remoteRoot += "/";

  let port = process.env.FTP_PORT ? parseInt(process.env.FTP_PORT, 10) : NaN;
  if (!Number.isFinite(port)) {
    port = sftp ? 22 : 21;
  }

  if (!host || !user) {
    console.error(
      "Missing FTP_HOST or FTP_USER. Set them in .env (see scripts/deploy-ftp.js header)."
    );
    process.exit(1);
  }

  if (!password && !dryRun) {
    console.error("Missing FTP_PASSWORD.");
    process.exit(1);
  }

  if (!fs.existsSync(DIST)) {
    console.error(`No dist/ folder. Run: npm run build`);
    process.exit(1);
  }

  const config = {
    user,
    password,
    host,
    port,
    localRoot: DIST,
    remoteRoot,
    include: ["*", "**/*"],
    exclude: [".DS_Store", "**/.DS_Store"],
    deleteRemote: false,
    forcePasv: true,
    sftp,
  };

  if (dryRun) {
    console.log("FTP_DRY_RUN — would deploy with:");
    console.log({
      host: config.host,
      port: config.port,
      user: config.user,
      remoteRoot: config.remoteRoot,
      localRoot: config.localRoot,
      sftp: config.sftp,
    });
    process.exit(0);
  }

  const ftpDeploy = new FtpDeploy();

  ftpDeploy.on("uploading", (data) => {
    process.stdout.write(`\rUploading ${data.transferredFileCount}/${data.totalFilesCount} ${data.filename}`);
  });

  ftpDeploy.on("upload-error", (data) => {
    console.error("\nUpload error:", data.err?.message || data.err, data.filename);
  });

  console.log(`Deploying ${DIST} → ${host}:${port} ${remoteRoot} (${sftp ? "SFTP" : "FTP"})`);

  ftpDeploy
    .deploy(config)
    .then(() => {
      console.log("\nDeploy finished.");
    })
    .catch((err) => {
      console.error("\nDeploy failed:", err.message || err);
      process.exit(1);
    });
}

main();
