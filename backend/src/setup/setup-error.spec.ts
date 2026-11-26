import { BadRequestException, ConflictException } from '@nestjs/common';
import { setupErrorCode, setupException } from './setup-error';

describe('Safe initialization errors', () => {
  it.each([
    ['ER_ACCESS_DENIED_ERROR', 400, '数据库认证失败'],
    ['ER_DBACCESS_DENIED_ERROR', 400, '数据库权限不足'],
    ['ENOTFOUND', 400, '无法解析数据库地址'],
    ['ECONNREFUSED', 503, '无法连接数据库'],
    ['ETIMEDOUT', 503, '数据库连接超时'],
    ['ER_DUP_ENTRY', 409, '冲突的数据'],
    ['ER_LOCK_WAIT_TIMEOUT', 409, '其他操作'],
    ['EACCES', 500, '文件写入权限'],
  ])('classifies %s without returning raw messages', (code, status, message) => {
    const raw = Object.assign(
      new Error('password=private SQL SELECT private_table /private/path'),
      { code },
    );
    const result = setupException(raw);
    expect(result.getStatus()).toBe(status);
    expect(result.message).toContain(message);
    expect(JSON.stringify(result.getResponse())).not.toMatch(/private|SELECT|password/);
  });
  it('recognizes wrapped TypeORM and connection errors', () => {
    expect(setupErrorCode({ driverError: { code: 'ER_ACCESS_DENIED_ERROR' } })).toBe(
      'ER_ACCESS_DENIED_ERROR',
    );
    expect(setupErrorCode({ errors: [{ code: 'ECONNREFUSED' }] })).toBe('ECONNREFUSED');
    expect(setupException({ cause: { code: 'ETIMEDOUT' } }).getStatus()).toBe(503);
  });
  it('preserves explicit validation/lock errors and masks every unknown exception', () => {
    for (const error of [new BadRequestException('Invalid port'), new ConflictException('Busy')])
      expect(setupException(error)).toBe(error);
    expect(setupException(new Error('secret database password')).message).toContain(
      '可以修改配置后重试',
    );
    expect(setupErrorCode({ code: 'password=secret' })).toBeUndefined();
  });
});
