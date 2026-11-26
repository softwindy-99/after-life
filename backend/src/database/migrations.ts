import { InitialSchema1710000000000 } from './migrations/1710000000000-InitialSchema';
import { RuntimeConfiguration1720000000000 } from './migrations/1720000000000-RuntimeConfiguration';

import { McpPermissions1730000000000 } from './migrations/1730000000000-McpPermissions';
import { ResourceStorage1740000000000 } from './migrations/1740000000000-ResourceStorage';

import { RemoveRuntimeConfiguration1750000000000 } from './migrations/1750000000000-RemoveRuntimeConfiguration';

export const databaseMigrations = [
  InitialSchema1710000000000,
  RuntimeConfiguration1720000000000,
  McpPermissions1730000000000,
  ResourceStorage1740000000000,
  RemoveRuntimeConfiguration1750000000000,
];
