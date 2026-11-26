import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentDistributionService } from './agent-distribution.service';

describe('AgentDistributionService', () => {
  it('ships a portable archive whose files match the manifest and JSON bundle', () => {
    const service = new AgentDistributionService();
    const bundle = service.bundle() as {
      name: string;
      files: { path: string; content: string; sizeBytes: number; sha256: string }[];
    };
    const manifest = service.manifest() as { archiveSha256: string };
    const directory = mkdtempSync(join(tmpdir(), 'afterlife-skill-'));
    try {
      const archive = join(directory, 'skill.tar.gz');
      writeFileSync(archive, service.tarball());
      expect(createHash('sha256').update(service.tarball()).digest('hex')).toBe(
        manifest.archiveSha256,
      );
      const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
      expect(names).toEqual(bundle.files.map((file) => `${bundle.name}/${file.path}`));
      execFileSync('tar', ['-xzf', archive, '-C', directory]);
      for (const file of bundle.files) {
        const bytes = readFileSync(join(directory, bundle.name, file.path));
        expect(bytes.toString('utf8')).toBe(file.content);
        expect(bytes.length).toBe(file.sizeBytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      }
      const cli = join(directory, bundle.name, 'scripts/afterlife.mjs');
      expect(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })).toContain(
        'AFTERLIFE_TOKEN_FILE',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
