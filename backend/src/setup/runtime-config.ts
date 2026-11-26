import { EnvMap, getMissingRuntimeKeys, readEnvFile } from './env';

export type ResolvedRuntimeConfig = {
  values: EnvMap;
  ready: boolean;
};

export function resolveRuntimeConfig(values: EnvMap = readEnvFile()): ResolvedRuntimeConfig {
  return { values, ready: getMissingRuntimeKeys(values).length === 0 };
}
