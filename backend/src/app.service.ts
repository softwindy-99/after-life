import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { networkInterfaces } from 'os';
import { join } from 'path';
import { isRuntimeConfigured } from './setup/env';

export interface ServerInfo {
  version: string;
  status: 'ready' | 'uninitialized';
  ipAddress: string;
  supportedClientVersion: {
    min: string;
    max: string;
  };
}

@Injectable()
export class AppService {
  private readonly packageVersion = this.getPackageVersion();

  getServerInfo(): ServerInfo {
    return {
      version: process.env.SERVER_VERSION || this.packageVersion,
      status: isRuntimeConfigured() ? 'ready' : 'uninitialized',
      ipAddress: this.getIpAddress(),
      supportedClientVersion: {
        min: process.env.SUPPORTED_CLIENT_VERSION_MIN || '0.0.0',
        max: process.env.SUPPORTED_CLIENT_VERSION_MAX || this.packageVersion,
      },
    };
  }

  private getPackageVersion(): string {
    try {
      const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
      return packageJson.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  private getIpAddress(): string {
    const interfaces = networkInterfaces();

    for (const networkInterface of Object.values(interfaces)) {
      const address = networkInterface?.find((item) => item.family === 'IPv4' && !item.internal);

      if (address) return address.address;
    }

    return '127.0.0.1';
  }
}
