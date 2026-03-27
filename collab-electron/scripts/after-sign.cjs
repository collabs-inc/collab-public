/**
 * After Sign Hook Script
 *
 * This script is called by electron-builder after signing each artifact.
 * It handles:
 * - macOS notarization (via notarize.cjs)
 * - Windows signature verification
 *
 * Usage:
 *   electron-builder calls this automatically after signing
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function afterSign(context) {
  const { appOutDir, packager, electronPlatformName } = context;

  console.log(`After-sign hook triggered for platform: ${electronPlatformName}`);
  console.log(`App output directory: ${appOutDir}`);

  if (electronPlatformName === 'darwin') {
    // macOS - run notarization
    console.log('Running macOS notarization...');
    const notarizeScript = path.join(__dirname, 'notarize.cjs');

    if (fs.existsSync(notarizeScript)) {
      try {
        const notarize = require(notarizeScript);
        await notarize(context);
        console.log('Notarization completed successfully');
      } catch (error) {
        console.error('Notarization failed:', error.message);
        // Don't fail the build if notarization fails (may be expected in dev)
        if (process.env.REQUIRE_NOTARIZATION === 'true') {
          throw error;
        }
      }
    } else {
      console.log('Notarize script not found, skipping');
    }
  }

  if (electronPlatformName === 'win32') {
    // Windows - verify signature (non-fatal for dev builds)
    console.log('Verifying Windows signature (non-fatal for dev builds)...');

    const appName = packager.appInfo.productFilename;
    const appExe = path.join(appOutDir, `${appName}.exe`);

    if (fs.existsSync(appExe)) {
      const signTool = findSignTool();

      if (signTool) {
        console.log(`Verifying: ${appExe}`);
        try {
          // Capture output instead of inheriting stdio to prevent exit code propagation
          execSync(`"${signTool}" verify /pa "${appExe}"`, {
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8'
          });
          console.log('Windows signature verification passed');
        } catch (error) {
          // Log as warning, not error - unsigned builds are expected for development
          console.log('Note: This is an unsigned development build');
          console.log('Signature verification output:', error.message?.substring(0, 500) || 'verification failed');
          // Only fail the build if explicit signing is required
          if (process.env.REQUIRE_SIGNING === 'true') {
            throw new Error('Windows signing is required but verification failed');
          }
          // For dev builds: continue without failing
          console.log('Continuing build process (unsigned build is acceptable for development)');
        }
      } else {
        console.log('signtool.exe not found, skipping signature verification');
      }
    } else {
      console.log(`App executable not found: ${appExe}`);
    }
  }

  console.log('After-sign hook completed');
}

function findSignTool() {
  // Try to find signtool.exe in common locations
  const commonPaths = [
    // Windows SDK 10
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x86\\signtool.exe',
    // Windows SDK 8.1
    'C:\\Program Files (x86)\\Windows Kits\\8.1\\bin\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\8.1\\bin\\x86\\signtool.exe',
  ];

  for (const signtoolPath of commonPaths) {
    if (fs.existsSync(signtoolPath)) {
      return signtoolPath;
    }
  }

  // Try to find via PATH
  try {
    execSync('where signtool', { stdio: 'pipe' });
    return 'signtool';
  } catch (e) {
    return null;
  }
}

module.exports = afterSign;
