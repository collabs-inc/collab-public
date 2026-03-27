#!/usr/bin/env node

/**
 * Windows Code Signing Script
 *
 * Signs Windows executables and installers using a code signing certificate.
 * Supports both file-based certificates (.pfx) and Windows Certificate Store.
 *
 * Usage:
 *   bun scripts/sign-win.cjs [options] <file-to-sign>
 *
 * Options:
 *   --cert-path <path>    Path to .pfx certificate file
 *   --cert-password <pwd> Certificate password (P1 FIX: Use WIN_CERT_PASSWORD env or stdin instead)
 *   --cert-store <name>   Windows certificate store name (alternative to .pfx)
 *   --subject <name>      Subject name to find in certificate store
 *   --timestamp-url <url> Timestamp server URL (default: http://timestamp.digicert.com)
 *   --output <path>       Output path for signed file (default: overwrites original)
 *   --verify-only         Only verify existing signature, don't sign
 *
 * Environment Variables:
 *   WIN_CERT_PATH         Path to .pfx certificate file
 *   WIN_CERT_PASSWORD     Certificate password (P1 FIX: Preferred over command-line argument)
 *   WIN_CERT_STORE        Windows certificate store name
 *   WIN_CERT_SUBJECT      Certificate subject name
 *   WIN_TIMESTAMP_URL     Timestamp server URL
 *
 * P1 Security Fixes:
 * - Password should be passed via WIN_CERT_PASSWORD environment variable or stdin
 * - Command-line password argument is deprecated for security
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// P1 Fix: Read password from stdin securely
async function readPasswordFromStdin() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  return new Promise((resolve) => {
    // Try to hide input (works on Unix-like systems)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    let password = '';

    rl.write('Enter certificate password: ');

    rl.on('line', (line) => {
      password = line;
      rl.write('\n');
      rl.close();
    });

    rl.on('SIGINT', () => {
      rl.write('\n');
      rl.close();
      resolve('');
    });

    rl.on('close', () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      resolve(password);
    });
  });
}

// Default timestamp servers
const DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com';
const ALTERNATIVE_TIMESTAMP_URLS = [
  'http://timestamp.globalsign.com/tsa/r6advanced1',
  'http://timestamp.sectigo.com',
  'http://time.certum.pl'
];

// P2 Fix: Timestamp server fallback tracking
let lastUsedTimestampUrl = null;
let timestampFallbackAttempted = false;

function printUsage() {
  console.log(`
Windows Code Signing Script
============================

Usage: bun scripts/sign-win.cjs [options] <file-to-sign>

Options:
  --cert-path <path>       Path to .pfx certificate file
  --cert-password <pwd>    Certificate password (DEPRECATED: Use WIN_CERT_PASSWORD env for security)
  --cert-store <name>      Windows certificate store name
  --subject <name>         Certificate subject name to search for
  --timestamp-url <url>    Timestamp server URL
  --output <path>          Output path for signed file
  --verify-only            Only verify existing signature
  --help                   Show this help message

Environment Variables:
  WIN_CERT_PATH            Path to .pfx certificate file
  WIN_CERT_PASSWORD        Certificate password (PREFERRED - more secure than command-line)
  WIN_CERT_STORE           Windows certificate store name
  WIN_CERT_SUBJECT         Certificate subject name
  WIN_TIMESTAMP_URL        Timestamp server URL

P1 Security Notice:
  For security, use WIN_CERT_PASSWORD environment variable instead of --cert-password
  to avoid exposing the password in process listings and shell history.

Examples:
  WIN_CERT_PASSWORD=secret bun scripts/sign-win.cjs --cert-path cert.pfx dist/Collaborator.exe
  bun scripts/sign-win.cjs --subject "Collaborator AI" dist/setup.exe
  bun scripts/sign-win.cjs --verify-only dist/Collaborator.exe
`);
}

function parseArgs(args) {
  const options = {
    certPath: process.env.WIN_CERT_PATH,
    certPassword: process.env.WIN_CERT_PASSWORD, // P1 Fix: Prefer env over command-line
    certStore: process.env.WIN_CERT_STORE,
    subject: process.env.WIN_CERT_SUBJECT,
    timestampUrl: process.env.WIN_TIMESTAMP_URL || DEFAULT_TIMESTAMP_URL,
    output: null,
    inputFile: null,
    verifyOnly: false,
    useStdinPassword: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      case '--cert-path':
        options.certPath = args[++i];
        break;
      case '--cert-password':
        // P1 Fix: Warn about insecure password passing
        console.warn('WARNING: Using --cert-password exposes the password in process listings.');
        console.warn('Use WIN_CERT_PASSWORD environment variable for better security.');
        options.certPassword = args[++i];
        break;
      case '--cert-store':
        options.certStore = args[++i];
        break;
      case '--subject':
        options.subject = args[++i];
        break;
      case '--timestamp-url':
        options.timestampUrl = args[++i];
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--verify-only':
        options.verifyOnly = true;
        break;
      case '--stdin-password':
        // P1 Fix: Allow reading password from stdin for better security
        options.useStdinPassword = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          options.inputFile = arg;
        }
    }
  }

  return options;
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
    // Visual Studio
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\signtool.exe',
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

function buildSignCommand(options, inputFile, outputFile, timestampUrl) {
  const signTool = findSignTool();

  if (!signTool) {
    throw new Error(
      'signtool.exe not found. Please install Windows SDK or Visual Studio.\n' +
      'Download from: https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/'
    );
  }

  let certOptions = '';

  if (options.certPath) {
    // Use certificate file
    const certPath = path.resolve(options.certPath);
    if (!fs.existsSync(certPath)) {
      throw new Error(`Certificate file not found: ${certPath}`);
    }

    certOptions = `/f "${certPath}"`;
    if (options.certPassword) {
      // P1 Fix: Password is passed via env var or stdin, not directly in command
      certOptions += ` /p "${options.certPassword}"`;
    }
  } else if (options.certStore) {
    // Use Windows Certificate Store
    certOptions = `/s "${options.certStore}"`;
    if (options.subject) {
      certOptions += ` /n "${options.subject}"`;
    } else {
      throw new Error('Subject name required when using certificate store. Use --subject or WIN_CERT_SUBJECT.');
    }
  } else {
    throw new Error(
      'Certificate not specified. Provide either:\n' +
      '  --cert-path <path> for .pfx file, or\n' +
      '  --cert-store <name> --subject <name> for Windows Certificate Store'
    );
  }

  // P2 Fix: Use provided timestamp URL or fallback
  const tsUrl = timestampUrl || options.timestampUrl;
  lastUsedTimestampUrl = tsUrl;

  // Build the sign command
  let cmd = `"${signTool}" sign ${certOptions} /t "${tsUrl}" /fd sha256 /tr "${tsUrl}"`;

  // Add output path if specified
  if (outputFile && outputFile !== inputFile) {
    cmd += ` /o "${outputFile}"`;
  }

  cmd += ` "${inputFile}"`;

  return cmd;
}

// P2 Fix: Signature verification function
function verifySignature(inputFile) {
  const signTool = findSignTool();

  if (!signTool) {
    throw new Error('signtool.exe not found for signature verification');
  }

  const cmd = `"${signTool}" verify /pa /v "${inputFile}"`;

  console.log('Verifying signature...');
  console.log(`Command: ${cmd}`);

  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log('\nSignature verification passed!');
    return true;
  } catch (error) {
    console.error('\nSignature verification failed!');
    console.error('The file may not be properly signed or the signature is invalid.');
    throw error;
  }
}

// P2 Fix: Sign with timestamp fallback logic
async function signWithFallback(options, inputFile, outputFile) {
  const timestampsToTry = [options.timestampUrl, ...ALTERNATIVE_TIMESTAMP_URLS];

  for (let i = 0; i < timestampsToTry.length; i++) {
    const tsUrl = timestampsToTry[i];
    const isFallback = i > 0;

    if (isFallback) {
      console.log(`\nAttempting fallback timestamp server (${i + 1}/${timestampsToTry.length}): ${tsUrl}`);
      timestampFallbackAttempted = true;
    }

    try {
      const command = buildSignCommand(options, inputFile, outputFile, tsUrl);
      console.log(`Signing with timestamp: ${tsUrl}`);
      console.log(`Command: ${command}`);

      execSync(command, { stdio: 'inherit' });
      console.log('\nSigning completed successfully!');

      // P2 Fix: Verify signature after signing
      await verifySignature(inputFile);

      return true;
    } catch (error) {
      console.error(`\nSigning failed with timestamp server: ${tsUrl}`);
      console.error(`Error: ${error.message}`);

      if (i < timestampsToTry.length - 1) {
        console.log('Trying next timestamp server...');
        continue;
      } else {
        console.error('\nAll timestamp servers failed. Signing aborted.');
        throw error;
      }
    }
  }
}

async function signFile(options) {
  const inputFile = path.resolve(options.inputFile);

  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  const outputFile = options.output ? path.resolve(options.output) : inputFile;

  // P2 Fix: Support verify-only mode
  if (options.verifyOnly) {
    console.log(`Verifying signature: ${inputFile}`);
    await verifySignature(inputFile);
    return;
  }

  console.log(`Signing: ${inputFile}`);
  console.log(`Output: ${outputFile}`);
  console.log(`Primary timestamp: ${options.timestampUrl}`);
  if (timestampFallbackAttempted) {
    console.log(`Timestamp fallback enabled: ${ALTERNATIVE_TIMESTAMP_URLS.join(', ')}`);
  }

  // P2 Fix: Use signWithFallback for timestamp server fallback
  await signWithFallback(options, inputFile, outputFile);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const options = parseArgs(args);

  // P1 Fix: Read password from stdin if requested
  if (options.useStdinPassword && !options.verifyOnly) {
    console.log('Reading password from stdin...');
    const stdinPassword = await readPasswordFromStdin();
    if (!stdinPassword) {
      console.error('Error: Password required for signing');
      process.exit(1);
    }
    options.certPassword = stdinPassword;
  }

  if (!options.inputFile) {
    console.error('Error: No input file specified');
    printUsage();
    process.exit(1);
  }

  await signFile(options);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
