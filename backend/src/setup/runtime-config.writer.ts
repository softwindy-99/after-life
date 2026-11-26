import { Injectable } from '@nestjs/common';
import { EnvMap, applyEnvUpdates, writeEnvFile } from './env';

@Injectable()
export class RuntimeConfigWriter {
  async update(changes: EnvMap): Promise<void> {
    writeEnvFile(changes);
    applyEnvUpdates(changes);
  }
}
