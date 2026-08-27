/**
 * 直接用 HTTP 调 cocos-creator-mcp 的 JSON-RPC 接口。
 *
 * Cursor 侧的 MCP 集成要重载编辑器才生效，这个脚本绕过那一步，
 * 也可以在 MCP 客户端出问题时当作对照，判断是服务端还是客户端的毛病。
 *
 * 用法：
 *   node _research/mcp-call.mjs --list
 *   node _research/mcp-call.mjs --resources
 *   node _research/mcp-call.mjs <工具名> '<JSON 参数>'
 *
 * 例：
 *   node _research/mcp-call.mjs scene_manage "{\"action\":\"current\"}"
 */

const ENDPOINT = process.env.COCOS_MCP_URL || 'http://127.0.0.1:3000/mcp';

let sessionId = null;

/** 服务端用 SSE 包装响应，正文在 `data:` 行里。 */
function parseBody(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);

  for (const line of trimmed.split('\n')) {
    if (line.startsWith('data:')) return JSON.parse(line.slice(5).trim());
  }
  throw new Error('无法解析响应: ' + trimmed.slice(0, 200));
}

async function rpc(method, params, { notify = false } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const payload = notify
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: Date.now(), method, params };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  if (notify) return null;

  const data = parseBody(await res.text());
  if (data.error) throw new Error(`${method} 失败: ${JSON.stringify(data.error)}`);
  return data.result;
}

async function connect() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'warmpet-shell', version: '1.0' },
  });
  await rpc('notifications/initialized', {}, { notify: true });
}

/** 工具结果统一包在 content[].text 里，能解析成 JSON 的就还原成对象。 */
function unwrap(result) {
  const parts = (result && result.content) || [];
  const texts = parts.filter((p) => p.type === 'text').map((p) => p.text);
  if (texts.length === 0) return result;

  const joined = texts.join('\n');
  try {
    return JSON.parse(joined);
  } catch {
    return joined;
  }
}

async function main() {
  const [first, second] = process.argv.slice(2);
  if (!first) {
    console.error('用法: node _research/mcp-call.mjs --list | <工具名> \'<JSON 参数>\'');
    process.exit(2);
  }

  await connect();

  if (first === '--list') {
    const { tools } = await rpc('tools/list', {});
    console.log(`共 ${tools.length} 个工具\n`);
    for (const t of tools) {
      console.log(`${t.name.padEnd(28)} ${(t.description || '').split('\n')[0].slice(0, 90)}`);
    }
    return;
  }

  // 长段 JS 经 PowerShell 转义很容易出错，改成从文件读。
  if (first === '--eval') {
    const fs = await import('node:fs');
    const code = fs.readFileSync(second, 'utf8');
    const result = await rpc('tools/call', {
      name: 'execute_editor_script',
      arguments: { code, returnLogs: true, timeoutMs: 20000 },
    });
    console.log(JSON.stringify(unwrap(result), null, 2));
    return;
  }

  if (first === '--describe') {
    const { tools } = await rpc('tools/list', {});
    const tool = tools.find((t) => t.name === second);
    if (!tool) {
      console.error(`没有名为 ${second} 的工具`);
      process.exitCode = 1;
      return;
    }
    console.log(tool.description || '(无描述)');
    console.log('\n--- inputSchema ---');
    console.log(JSON.stringify(tool.inputSchema, null, 2));
    return;
  }

  if (first === '--resources') {
    const { resources } = await rpc('resources/list', {});
    console.log(`共 ${resources.length} 个资源\n`);
    for (const r of resources) console.log(`${r.uri.padEnd(34)} ${r.name || ''}`);
    return;
  }

  const args = second ? JSON.parse(second) : {};
  const result = await rpc('tools/call', { name: first, arguments: args });
  console.log(JSON.stringify(unwrap(result), null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
