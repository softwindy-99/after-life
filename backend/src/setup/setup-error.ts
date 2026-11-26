import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

// Only codes, never SQL, driver messages, connection settings or file paths.
export function setupErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as Record<string, unknown>;
  if (typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value.code))
    return value.code;
  for (const nested of [
    value.driverError,
    value.cause,
    ...(Array.isArray(value.errors) ? value.errors : []),
  ]) {
    if (!nested || typeof nested !== 'object') continue;
    const code = (nested as Record<string, unknown>).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(code)) return code;
  }
  return undefined;
}

export function setupException(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  switch (setupErrorCode(error)) {
    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR':
      return new BadRequestException('数据库认证失败，请检查用户名、密码及该账号的访问权限。');
    case 'ER_DBACCESS_DENIED_ERROR':
    case 'ER_TABLEACCESS_DENIED_ERROR':
    case 'ER_SPECIFIC_ACCESS_DENIED_ERROR':
      return new BadRequestException('数据库权限不足，请检查该账号的创建数据库、建表和读写权限。');
    case 'ER_BAD_DB_ERROR':
      return new BadRequestException('指定的数据库不存在，请检查数据库名称及创建权限。');
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new BadRequestException('无法解析数据库地址，请检查数据库主机名。');
    case 'ECONNREFUSED':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return new ServiceUnavailableException(
        '无法连接数据库，请检查数据库地址、端口及网络访问设置。',
      );
    case 'ETIMEDOUT':
    case 'PROTOCOL_SEQUENCE_TIMEOUT':
      return new ServiceUnavailableException('数据库连接超时，请检查地址、端口及网络后重试。');
    case 'ER_DUP_ENTRY':
      return new ConflictException('数据库中已有冲突的数据，请检查账号邮箱及已有初始化记录。');
    case 'ER_LOCK_WAIT_TIMEOUT':
    case 'ER_LOCK_DEADLOCK':
      return new ConflictException('数据库正在处理其他操作，请稍后重试。');
    case 'ER_BAD_FIELD_ERROR':
    case 'ER_NO_SUCH_TABLE':
      return new BadRequestException(
        '数据库结构与当前版本不一致，请检查迁移状态；不要重置现有数据。',
      );
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
    case 'ENOSPC':
      return new InternalServerErrorException(
        '无法保存初始化配置，请检查后端文件写入权限和磁盘空间。',
      );
    default:
      return new InternalServerErrorException('初始化失败，请检查后端日志。可以修改配置后重试。');
  }
}
