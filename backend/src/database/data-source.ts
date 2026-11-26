import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseEntities } from './entities';
import { databaseMigrations } from './migrations';
import { loadEnvIntoProcess } from 'src/setup/env';

loadEnvIntoProcess();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: false,
  entities: databaseEntities,
  migrations: databaseMigrations,
  migrationsTableName: 'migrations',
});

export default AppDataSource;
