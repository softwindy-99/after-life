#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { parseArgs } from 'node:util';

const help = `After Life CLI (Node.js 22.12+; no dependencies)

Usage:
  node afterlife.mjs tools [--server API_BASE]
  node afterlife.mjs call TOOL [--input FILE|-] [--server API_BASE]
  node afterlife.mjs upload FILE [--mime TYPE] [--server API_BASE]
  node afterlife.mjs --help | --version

API_BASE is the API base, e.g. https://example.com/api (not /mcp).
Environment: AFTERLIFE_SERVER_URL, AFTERLIFE_TOKEN_FILE or AFTERLIFE_TOKEN.
Token files contain only the Bearer value. Credentials are never saved by this CLI.
tools returns the currently granted tools and their JSON input schemas.
call defaults to {}; --input - reads a JSON object from stdin.
upload prepares a single-use ticket and uploads a local file (at most 10 MB).
stdout: JSON results; stderr: JSON errors. Exit 0: success, 1: request/tool
failure, 2: invalid arguments/config/input. Requests are never automatically retried.
Skill discovery and downloads: API_BASE/ai (no credentials required).
`;

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function invalid(message) {
  throw new CliError(message, 2);
}

function apiBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid('Set --server or AFTERLIFE_SERVER_URL to a complete API base URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /\/mcp\/?$/i.test(url.pathname)
  ) {
    invalid(
      'Use an HTTPS API base without credentials, query, fragment or /mcp; HTTP is local only.',
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

async function readLimited(source, limit, message, exitCode = 2) {
  const chunks = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > limit) throw new CliError(message, exitCode);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function inputObject(file) {
  if (!file) return {};
  let raw;
  try {
    if (file === '-') raw = await readLimited(process.stdin, 1024 * 1024, 'Input exceeds 1 MB.');
    else {
      if ((await stat(file)).size > 1024 * 1024) invalid('Input exceeds 1 MB.');
      raw = await readFile(file, 'utf8');
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    invalid('Cannot read input file.');
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid('Input must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('Input must be a JSON object.');
  }
  return value;
}

async function credential() {
  let token = process.env.AFTERLIFE_TOKEN;
  if (process.env.AFTERLIFE_TOKEN_FILE) {
    try {
      if ((await stat(process.env.AFTERLIFE_TOKEN_FILE)).size > 16384) {
        invalid('Token file is too large.');
      }
      token = await readFile(process.env.AFTERLIFE_TOKEN_FILE, 'utf8');
    } catch (error) {
      if (error instanceof CliError) throw error;
      invalid('Cannot read AFTERLIFE_TOKEN_FILE.');
    }
  }
  token = token?.trim();
  if (!token || /\s/.test(token) || token.length > 16384) {
    invalid('Set AFTERLIFE_TOKEN_FILE or AFTERLIFE_TOKEN to an AI access grant Bearer value.');
  }
  return token;
}

async function request(url, options) {
  try {
    const response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new CliError(`HTTP ${response.status}; request was not retried.`);
    return response;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('Network, redirect or timeout failure; request was not retried.');
  }
}

async function jsonResponse(response) {
  try {
    return JSON.parse(
      await readLimited(response.body, 4 * 1024 * 1024, 'Response exceeds 4 MB.', 1),
    );
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('Invalid JSON response; check the API base URL.');
  }
}

function toolData(result) {
  if (result?.isError) {
    const message = result.content
      ?.filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('; ');
    throw new CliError(message || 'Tool request failed.');
  }
  if (result?.structuredContent) return result.structuredContent;
  try {
    if (result?.content?.length === 1 && result.content[0].type === 'text') {
      return JSON.parse(result.content[0].text);
    }
  } catch {
    // Preserve valid MCP results that contain plain text instead of structured JSON.
  }
  return result;
}

async function connect(base, token) {
  let id = 0;
  let protocolVersion = '2025-03-26';
  async function rpc(method, params, notification = false) {
    const requestId = ++id;
    const response = await request(new URL('mcp', base), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': protocolVersion,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(notification ? {} : { id: requestId }),
        method,
        ...(params === undefined ? {} : { params }),
      }),
    });
    if (notification) {
      await response.body?.cancel();
      return;
    }
    const message = await jsonResponse(response);
    if (
      message?.jsonrpc !== '2.0' ||
      message.id !== requestId ||
      message.error ||
      !message.result
    ) {
      throw new CliError('MCP request rejected or invalid response; request was not retried.');
    }
    return message.result;
  }
  const initialized = await rpc('initialize', {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'afterlife-cli', version: '1.0.0' },
  });
  if (typeof initialized.protocolVersion !== 'string')
    throw new CliError('Invalid MCP initialization.');
  protocolVersion = initialized.protocolVersion;
  await rpc('notifications/initialized', undefined, true);
  return rpc;
}

async function upload(rpc, base, file, mimeType) {
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
  };
  let bytes;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size < 1 || info.size > 10 * 1024 * 1024) {
      invalid('Upload must be a nonempty file of at most 10 MB.');
    }
    bytes = await readFile(file);
    if (bytes.length > 10 * 1024 * 1024) invalid('Upload exceeds 10 MB.');
  } catch (error) {
    if (error instanceof CliError) throw error;
    invalid('Cannot read upload file.');
  }
  const type = mimeType || mimeTypes[extname(file).toLowerCase()] || 'application/octet-stream';
  const ticket = toolData(
    await rpc('tools/call', {
      name: 'afterlife_prepare_resource_upload',
      arguments: { filename: basename(file), mimeType: type, sizeBytes: bytes.length },
    }),
  );
  // Do not let a returned path redirect credentials, escape the proxy prefix, or use the main token.
  if (
    ticket?.uploadPath !== '/mcp-files' ||
    ticket.multipartField !== 'file' ||
    typeof ticket.headers?.Authorization !== 'string' ||
    !/^Bearer [^\s]+$/.test(ticket.headers.Authorization)
  ) {
    throw new CliError('Invalid upload ticket destination or headers.');
  }
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), basename(file));
  const response = await request(new URL('mcp-files', base), {
    method: 'POST',
    headers: { Authorization: ticket.headers.Authorization },
    body: form,
  });
  const payload = await jsonResponse(response);
  return payload.data ?? payload;
}

let secret;
try {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        server: { type: 'string' },
        input: { type: 'string' },
        mime: { type: 'string' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
      },
    });
  } catch {
    invalid('Invalid arguments. Run with --help for usage.');
  }
  if (args.values.help || args.values.version) {
    process.stdout.write(args.values.help ? help : 'afterlife-cli 1.0.0\n');
  } else {
    const [command, target] = args.positionals;
    if (
      !['tools', 'call', 'upload'].includes(command) ||
      args.positionals.length !== (command === 'tools' ? 1 : 2) ||
      (args.values.input !== undefined && command !== 'call') ||
      (args.values.mime !== undefined && command !== 'upload') ||
      (command === 'call' && !/^afterlife_[a-z_]+$/.test(target))
    ) {
      invalid('Expected tools, call TOOL or upload FILE. Run with --help for usage.');
    }
    const base = apiBase(args.values.server || process.env.AFTERLIFE_SERVER_URL);
    const input = command === 'call' ? await inputObject(args.values.input) : undefined;
    secret = await credential();
    const rpc = await connect(base, secret);
    let result;
    if (command === 'tools') {
      const tools = [];
      const cursors = new Set();
      let cursor;
      do {
        const page = await rpc('tools/list', cursor ? { cursor } : undefined);
        if (!Array.isArray(page.tools)) throw new CliError('Invalid tool list.');
        tools.push(...page.tools);
        cursor = page.nextCursor;
        if (cursor && (cursors.has(cursor) || cursors.size >= 100)) {
          throw new CliError('Invalid tool pagination.');
        }
        cursors.add(cursor);
      } while (cursor);
      result = { tools };
    } else if (command === 'call') {
      result = toolData(await rpc('tools/call', { name: target, arguments: input }));
    } else {
      result = await upload(rpc, base, target, args.values.mime);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2).replaceAll(secret, '[REDACTED]')}\n`);
  }
} catch (error) {
  const message = error instanceof CliError ? error.message : 'Unable to complete the command.';
  process.stderr.write(
    `${JSON.stringify({ error: secret ? message.replaceAll(secret, '[REDACTED]') : message })}\n`,
  );
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
}
