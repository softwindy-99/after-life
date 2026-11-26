import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const skillName = 'use-after-life';
const assetPaths = ['SKILL.md', 'references/tools.md', 'scripts/afterlife.mjs'] as const;

interface SkillFile {
  path: string;
  content: string;
  sizeBytes: number;
  sha256: string;
}

@Injectable()
export class AgentDistributionService {
  private readonly files: SkillFile[] = assetPaths.map((path) => {
    const content = readFileSync(join(__dirname, 'skill', skillName, path), 'utf8');
    return {
      path,
      content,
      sizeBytes: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  });

  // Content-derived release identifier also changes when only the instructions change.
  private readonly version = createHash('sha256')
    .update(JSON.stringify(this.files))
    .digest('hex')
    .slice(0, 16);

  private readonly archive = this.createArchive();

  manifest(): object {
    return {
      name: skillName,
      version: this.version,
      requires: { node: '>=22.12.0' },
      skill: 'ai/SKILL.md',
      cli: 'ai/cli.mjs',
      bundle: 'ai/skill.json',
      archive: 'ai/skill.tar.gz',
      archiveSha256: createHash('sha256').update(this.archive).digest('hex'),
      mcp: 'mcp',
      authentication: 'Create a grant in the web AI access page; use its Bearer token.',
      files: this.files.map(({ content: _content, ...file }) => file),
    };
  }

  bundle(): object {
    return { name: skillName, version: this.version, files: this.files };
  }

  file(path: (typeof assetPaths)[number]): string {
    return this.files.find((file) => file.path === path)!.content;
  }

  tarball(): Buffer {
    return this.archive;
  }

  private createArchive(): Buffer {
    const blocks: Buffer[] = [];
    for (const file of this.files) {
      const header = Buffer.alloc(512);
      header.write(`${skillName}/${file.path}`);
      const octal = (value: number, offset: number, length: number): void => {
        header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length);
      };
      octal(0o644, 100, 8);
      octal(0, 108, 8);
      octal(0, 116, 8);
      octal(file.sizeBytes, 124, 12);
      octal(0, 136, 12);
      header.fill(32, 148, 156);
      header.write('0', 156);
      header.write('ustar\0', 257);
      header.write('00', 263);
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
      blocks.push(header, Buffer.from(file.content));
      blocks.push(Buffer.alloc((512 - (file.sizeBytes % 512)) % 512));
    }
    return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
  }
}
