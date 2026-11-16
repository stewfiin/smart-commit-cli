#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const MAX_DIFF_LENGTH = 5000;
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:1.5b';

const SYSTEM_PROMPT = [
  'You are a strict Git commit message generator.',
  'Generate EXACTLY ONE Conventional Commit subject line based on the provided git diff.',
  'Format: <type>: <description> (or <type>(<scope>): <description> when scope is obvious).',
  'Allowed types: feat, fix, refactor, docs, style, test, chore, perf, build, ci.',
  'Rules:',
  '- Maximum 72 characters total.',
  '- Use imperative, present-tense English (e.g., "add", "fix", "update", not "added").',
  '- Output ONLY the commit message text itself.',
  '- NO introductory text, NO closing remarks, NO explanations.',
  '- NO markdown formatting, NO backticks, NO quotes.',
].join('\n');

const useColor = !process.env.NO_COLOR && output.isTTY;
const ANSI = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  red: useColor ? '\x1b[31m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  cyan: useColor ? '\x1b[36m' : '',
};

/**
 * Checks whether the current working directory is inside a Git work tree.
 * @returns {boolean}
 */
function isGitRepository() {
  try {
    const result = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Retrieves the staged Git diff.
 * @returns {string}
 */
function getStagedDiff() {
  return execFileSync('git', ['diff', '--cached'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Truncates diff text if it exceeds the maximum allowed character length.
 * @param {string} diff
 * @param {number} maxLength
 * @returns {string}
 */
function truncateDiff(diff, maxLength = MAX_DIFF_LENGTH) {
  if (diff.length <= maxLength) {
    return diff;
  }
  return `${diff.slice(0, maxLength)}\n...[diff truncated]`;
}

/**
 * Cleans up accidental markdown fences, quotes, or extra lines returned by the model.
 * @param {string} rawText
 * @returns {string}
 */
function sanitizeCommitMessage(rawText) {
  const withoutFences = rawText
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '')
    .trim();

  const firstLine = withoutFences
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) || '';

  return firstLine
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

/**
 * Requests a Conventional Commit message from the local Ollama API.
 * @param {object} params
 * @param {string} params.host
 * @param {string} params.model
 * @param {string} params.diff
 * @param {number} [params.attempt=1]
 * @returns {Promise<string>}
 */
async function generateCommitMessage({ host, model, diff, attempt = 1 }) {
  const normalizedHost = host.replace(/\/+$/, '');
  const endpoint = `${normalizedHost}/api/generate`;
  const userPrompt = attempt > 1
    ? `Provide a fresh alternative Conventional Commit message (max 72 chars) for this git diff:\n\n${diff}`
    : `Generate a Conventional Commit message (max 72 chars) for this git diff:\n\n${diff}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        stream: false,
        options: {
          temperature: 0.2,
        },
      }),
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Gagal terhubung ke Ollama di ${normalizedHost} (${details}).\n` +
      'Pastikan service Ollama aktif (ollama serve).'
    );
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errBody = await response.json();
      errorDetail = errBody?.error ? `: ${errBody.error}` : '';
    } catch {
      errorDetail = response.statusText ? `: ${response.statusText}` : '';
    }

    if (response.status === 404) {
      throw new Error(
        `Model "${model}" atau endpoint tidak ditemukan di Ollama (HTTP 404${errorDetail}).\n` +
        `Pastikan model sudah tersedia dengan menjalankan: ollama pull ${model}`
      );
    }

    throw new Error(`Ollama mengembalikan error HTTP ${response.status}${errorDetail}`);
  }

  const data = await response.json();
  const message = sanitizeCommitMessage(data?.response || '');

  if (!message) {
    throw new Error('Ollama tidak mengembalikan pesan commit yang valid. Coba regenerate [r].');
  }

  return message;
}

/**
 * Executes `git commit -m <message>` safely without shell interpolation.
 * @param {string} message
 * @returns {boolean}
 */
function executeGitCommit(message) {
  const result = spawnSync('git', ['commit', '-m', message], {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`${ANSI.red}Gagal menjalankan git commit: ${result.error.message}${ANSI.reset}`);
    return false;
  }

  return result.status === 0;
}

/**
 * Displays the suggested commit message in color.
 * @param {string} message
 */
function printSuggestedMessage(message) {
  console.log(`\n${ANSI.bold}Usulan Commit Message:${ANSI.reset}`);
  console.log(`  ${ANSI.cyan}${ANSI.bold}${message}${ANSI.reset} ${ANSI.dim}(${message.length}/72 chars)${ANSI.reset}\n`);
}

/**
 * Creates an async prompt helper on top of a readline interface so both interactive
 * TTY input and piped multi-line input across async calls work without closing errors.
 * @param {readline.Interface} rl
 * @returns {(promptText: string) => Promise<string | null>}
 */
function createPromptReader(rl) {
  const queue = [];
  let waiter = null;
  let closed = false;

  rl.on('line', (line) => {
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(line);
    } else {
      queue.push(line);
    }
  });

  rl.on('close', () => {
    closed = true;
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(null);
    }
  });

  return (promptText) => {
    if (queue.length > 0) {
      output.write(promptText);
      const next = queue.shift();
      output.write(`${next}\n`);
      return Promise.resolve(next);
    }

    if (closed) {
      return Promise.resolve(null);
    }

    output.write(promptText);
    return new Promise((resolve) => {
      waiter = resolve;
    });
  };
}

async function main() {
  if (!isGitRepository()) {
    console.error(
      `${ANSI.red}Error: Direktori saat ini bukan merupakan Git repository.${ANSI.reset}\n` +
      'Jalankan perintah ini di dalam folder proyek Git atau inisialisasi terlebih dahulu dengan "git init".'
    );
    process.exitCode = 1;
    return;
  }

  let stagedDiff;
  try {
    stagedDiff = getStagedDiff();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`${ANSI.red}Gagal membaca staged changes: ${details}${ANSI.reset}`);
    process.exitCode = 1;
    return;
  }

  if (!stagedDiff || stagedDiff.trim().length === 0) {
    console.log(
      `${ANSI.yellow}Peringatan: Tidak ada perubahan yang di-stage (staged changes kosong).${ANSI.reset}\n` +
      'Silakan stage file terlebih dahulu dengan menjalankan:\n' +
      `  ${ANSI.cyan}git add <file>${ANSI.reset}  atau  ${ANSI.cyan}git add .${ANSI.reset}`
    );
    return;
  }

  const host = process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const preparedDiff = truncateDiff(stagedDiff);

  console.log(
    `${ANSI.dim}Menganalisis staged diff menggunakan model ${ANSI.reset}${ANSI.bold}${model}${ANSI.reset}${ANSI.dim}...${ANSI.reset}`
  );

  let attempt = 1;
  let commitMessage;
  try {
    commitMessage = await generateCommitMessage({ host, model, diff: preparedDiff, attempt });
  } catch (error) {
    console.error(`\n${ANSI.red}Error: ${error.message}${ANSI.reset}`);
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input, output });
  const ask = createPromptReader(rl);
  let aborted = false;

  rl.on('SIGINT', () => {
    aborted = true;
    console.log(`\n${ANSI.yellow}Proses commit dibatalkan.${ANSI.reset}`);
    rl.close();
  });

  try {
    while (!aborted) {
      printSuggestedMessage(commitMessage);

      const rawAnswer = await ask(
        `${ANSI.bold}Pilih aksi${ANSI.reset} ` +
        `[${ANSI.green}Enter/y${ANSI.reset}] Commit  ` +
        `[${ANSI.yellow}e${ANSI.reset}] Edit  ` +
        `[${ANSI.cyan}r${ANSI.reset}] Regenerate  ` +
        `[${ANSI.red}n/q${ANSI.reset}] Batal: `
      );

      if (rawAnswer === null) {
        if (!aborted) {
          console.log(`\n${ANSI.yellow}Proses commit dibatalkan.${ANSI.reset}`);
        }
        return;
      }

      const answer = rawAnswer.trim().toLowerCase();

      if (answer === '' || answer === 'y' || answer === 'yes') {
        rl.close();
        const ok = executeGitCommit(commitMessage);
        if (!ok) {
          process.exitCode = 1;
          return;
        }
        console.log(`${ANSI.green}Commit berhasil dibuat!${ANSI.reset}`);
        return;
      }

      if (answer === 'e' || answer === 'edit') {
        const customRaw = await ask(`${ANSI.bold}Masukkan pesan commit kustom:${ANSI.reset} `);
        if (customRaw === null) {
          console.log(`\n${ANSI.yellow}Proses commit dibatalkan.${ANSI.reset}`);
          return;
        }

        const customMessage = customRaw.trim();
        if (!customMessage) {
          console.log(`${ANSI.yellow}Input kosong, pesan commit sebelumnya tetap dipertahankan.${ANSI.reset}`);
          continue;
        }

        commitMessage = customMessage;
        continue;
      }

      if (answer === 'r' || answer === 'regenerate') {
        attempt += 1;
        console.log(`\n${ANSI.dim}Meminta variasi pesan commit baru ke Ollama...${ANSI.reset}`);
        try {
          commitMessage = await generateCommitMessage({ host, model, diff: preparedDiff, attempt });
        } catch (error) {
          console.error(`\n${ANSI.red}Error: ${error.message}${ANSI.reset}`);
        }
        continue;
      }

      if (answer === 'n' || answer === 'q' || answer === 'no' || answer === 'quit') {
        console.log(`${ANSI.yellow}Proses commit dibatalkan.${ANSI.reset}`);
        return;
      }

      console.log(
        `${ANSI.yellow}Pilihan tidak dikenali. Gunakan Enter/y, e, r, atau n/q.${ANSI.reset}`
      );
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`${ANSI.red}Unexpected error: ${error.message}${ANSI.reset}`);
  process.exitCode = 1;
});
