const { spawn } = require('child_process');
const core = require('@actions/core');
const fs = require('fs');

const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN");
const FILEPATH = core.getInput("image_path");
const THM_USERNAME = core.getInput("username");
const COMMITTER_USERNAME = core.getInput('committer_username');
const COMMITTER_EMAIL = core.getInput('committer_email');
const COMMIT_MESSAGE = core.getInput('commit_message');
const USE_STATIC_IMAGE = core.getInput('use_static_image') === 'true';
const USER_PUBLIC_ID = core.getInput('user_public_id');

/*
 * Executes a command and returns its result as promise
 * @param cmd {string} command to execute
 * @param args {array} command line args
 * @param options {Object} extra options
 * @return {Promise<Object>}
 */
function exec(cmd, args = [], options = {}) {
  console.log(`[exec] Running command: ${cmd} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    let outputData = '';
    const app = spawn(cmd, args, { ...options, stdio: 'pipe' });

    if (app.stdout) app.stdout.on('data', data => {
       // Only needed for pipes
      outputData += data.toString();
      process.stdout.write(`[exec][stdout] ${data.toString()}`);
    });
    if (app.stderr) app.stderr.on('data', data => {
      outputData += data.toString();
      process.stderr.write(`[exec][stderr] ${data.toString()}`);
    });

    app.on('close', code => {
      console.log(`[exec] Process exited with code: ${code}`);
      if (code !== 0) return reject({ code, outputData });
      resolve({ code, outputData });
    });
    app.on('error', err => {
      console.error(`[exec] Error: ${err.message}`);
      reject({ code: 1, outputData: err.message });
    });
  });
}

core.setSecret(GITHUB_TOKEN);

/**
 * Downloads the image and commits/pushes it to GitHub.
 */
async function dlImg(githubToken, filePath, username, useStaticImage, userPublicId) {
  try {
    let url = "";
    if (useStaticImage) {
      console.log('[dlImg] Using static image URL.');
      url = `https://tryhackme-badges.s3.amazonaws.com/${username}.png`;
    } else {
      console.log('[dlImg] Using dynamic image URL.');
      url = `https://tryhackme.com/api/v2/badges/public-profile?userPublicId=${userPublicId}`;
    }
    console.log(`[dlImg] Downloading image from: ${url}`);
    const res = await fetch(url);

    if (!res.ok) throw new Error(`[dlImg] Failed to download image: ${res.statusText}`);

    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(filePath);
      res.body.pipe(fileStream);
      res.body.on("error", err => {
        console.error(`[dlImg] Error while downloading image: ${err.message}`);
        reject(err);
      });
      fileStream.on("finish", () => {
        console.log(`[dlImg] Image saved to: ${filePath}`);
        resolve();
      });
    });

    console.log('[dlImg] Setting git user configuration...');
    await exec('git', ['config', '--global', 'user.email', COMMITTER_EMAIL]);
    await exec('git', ['config', '--global', 'user.name', COMMITTER_USERNAME]);

    if (githubToken) {
      console.log('[dlImg] Updating git remote URL...');
      await exec('git', [
        'remote', 'set-url', 'origin',
        `https://${githubToken}@github.com/${process.env.GITHUB_REPOSITORY}.git`
      ]);
    }

    console.log(`[dlImg] Adding file to git: ${filePath}`);
    await exec('git', ['add', filePath]);

    try {
      console.log('[dlImg] Committing changes...');
      await exec('git', ['commit', '-m', COMMIT_MESSAGE]);
    } catch (e) {
      console.log('[dlImg] No changes to commit.');
      return;
    }
    console.log('[dlImg] Pushing changes to remote...');
    await exec('git', ['push']);
    console.log('[dlImg] Image downloaded and changes pushed successfully.');
  } catch (error) {
    console.error('[dlImg] Error:', error.outputData || error.message);
  }
}

console.log('[main] Starting badge workflow...');
dlImg(GITHUB_TOKEN, FILEPATH, THM_USERNAME, USE_STATIC_IMAGE, USER_PUBLIC_ID).catch((error) => {
  console.log('[main] Nothing to commit.');
});
