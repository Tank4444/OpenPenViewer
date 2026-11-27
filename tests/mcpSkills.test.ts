import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain ESM JS module in tools/collab-bridge
import { listSkills, readSkill } from '../tools/collab-bridge/skillsLoader.js';

const EXPECTED_SKILLS = [
  'design-to-code-handoff',
  'figma-export-ready',
  'pen-format-and-layout',
  'ui-design-system',
  'visual-qa-workflow',
];

describe('MCP Skills Loader', () => {
  it('discovers all 5 curated skills with valid metadata', () => {
    const skills = listSkills() as Array<{
      name: string;
      title: string;
      description: string;
      tags: string[];
      uri: string;
    }>;
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(EXPECTED_SKILLS);
    for (const s of skills) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.description.length).toBeGreaterThan(15);
      expect(s.uri).toBe(`skill://${s.name}`);
      expect(s.tags.length).toBeGreaterThan(0);
    }
  });

  it('reads skill content by name or skill:// URI and blocks path traversal', () => {
    const s1 = readSkill('pen-format-and-layout');
    expect(s1).not.toBeNull();
    expect(s1.content).toContain('Auto Layout');

    const s2 = readSkill('skill://visual-qa-workflow');
    expect(s2).not.toBeNull();
    expect(s2.content).toContain('get_screenshot');

    expect(readSkill('../index.js')).toBeNull();
    expect(readSkill('..\\package.json')).toBeNull();
    expect(readSkill('non-existent-skill')).toBeNull();
  });
});

describe('MCP Bridge stdio JSON-RPC (skills + write tools)', () => {
  it('handles initialize, resources, skills tools, add_node, set_variable, and delete_node', async () => {
    const script = path.resolve(process.cwd(), 'tools/collab-bridge/index.js');
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, PORT: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const responses = new Map<number, Record<string, unknown>>();
    const waiters = new Map<number, (val: Record<string, unknown>) => void>();
    let buffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          const msg = JSON.parse(line) as { id?: number } & Record<string, unknown>;
          if (typeof msg.id === 'number') {
            const w = waiters.get(msg.id);
            if (w) {
              waiters.delete(msg.id);
              w(msg);
            } else {
              responses.set(msg.id, msg);
            }
          }
        }
        nl = buffer.indexOf('\n');
      }
    });

    const sendRpc = (id: number, method: string, params?: unknown) => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      if (responses.has(id)) {
        const val = responses.get(id)!;
        responses.delete(id);
        return Promise.resolve(val);
      }
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`RPC timeout for ${method}`)), 5000);
        waiters.set(id, (val) => {
          clearTimeout(t);
          resolve(val);
        });
      });
    };

    try {
      const init = (await sendRpc(1, 'initialize', {})) as {
        result: { capabilities: { resources?: unknown; tools?: unknown }; instructions?: string };
      };
      expect(init.result.capabilities.tools).toBeDefined();
      expect(init.result.capabilities.resources).toBeDefined();
      expect(init.result.instructions).toContain('list_skills');

      const toolsRes = (await sendRpc(2, 'tools/list')) as {
        result: { tools: Array<{ name: string }> };
      };
      const toolNames = toolsRes.result.tools.map((t) => t.name);
      expect(toolNames).toEqual(
        expect.arrayContaining([
          'list_skills',
          'get_skill',
          'add_node',
          'delete_node',
          'set_variable',
          'get_screenshot',
        ]),
      );

      const resList = (await sendRpc(3, 'resources/list')) as {
        result: { resources: Array<{ uri: string }> };
      };
      expect(resList.result.resources.length).toBe(5);
      expect(resList.result.resources[0].uri).toMatch(/^skill:\/\//);

      const resRead = (await sendRpc(4, 'resources/read', {
        uri: 'skill://figma-export-ready',
      })) as { result: { contents: Array<{ text: string }> } };
      expect(resRead.result.contents[0].text).toContain('Figma');

      const skillCall = (await sendRpc(5, 'tools/call', {
        name: 'get_skill',
        arguments: { name: 'ui-design-system' },
      })) as { result: { content: Array<{ text: string }> } };
      expect(skillCall.result.content[0].text).toContain('8px');

      const addRes = (await sendRpc(6, 'tools/call', {
        name: 'add_node',
        arguments: {
          node: { type: 'frame', id: 'test-screen', name: 'Test Screen', width: 412, height: 915 },
        },
      })) as { result: { content: Array<{ text: string }> } };
      expect(addRes.result.content[0].text).toContain('test-screen');

      const varRes = (await sendRpc(7, 'tools/call', {
        name: 'set_variable',
        arguments: { name: 'brand', type: 'color', value: '#4F46E5' },
      })) as { result: { content: Array<{ text: string }> } };
      expect(varRes.result.content[0].text).toContain('$brand');

      const delRes = (await sendRpc(8, 'tools/call', {
        name: 'delete_node',
        arguments: { id: 'test-screen' },
      })) as { result: { content: Array<{ text: string }> } };
      expect(delRes.result.content[0].text).toContain('Deleted: test-screen');

      // Error handling: invalid node type, missing node on update_node, invalid variable type
      const badAdd = (await sendRpc(9, 'tools/call', {
        name: 'add_node',
        arguments: { node: { type: 'invalid_type_xyz' } },
      })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
      expect(badAdd.result.isError).toBe(true);
      expect(badAdd.result.content[0].text).toContain('Unsupported node type');

      const badUpdate = (await sendRpc(10, 'tools/call', {
        name: 'update_node',
        arguments: { id: 'does-not-exist', patch: { fill: '#000' } },
      })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
      expect(badUpdate.result.isError).toBe(true);
      expect(badUpdate.result.content[0].text).toContain('Node not found');

      const badVar = (await sendRpc(11, 'tools/call', {
        name: 'set_variable',
        arguments: { name: 'foo', type: 'invalid', value: 123 },
      })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
      expect(badVar.result.isError).toBe(true);
      expect(badVar.result.content[0].text).toContain('Invalid variable type');

      // Server remains healthy after errors
      const statusAfter = (await sendRpc(12, 'tools/call', {
        name: 'get_status',
        arguments: {},
      })) as { result: { content: Array<{ text: string }> } };
      expect(statusAfter.result.content[0].text).toContain('wsPort');
    } finally {
      child.kill();
    }
  });
});

