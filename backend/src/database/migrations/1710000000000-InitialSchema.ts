import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1710000000000 implements MigrationInterface {
  name = 'InitialSchema1710000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.connection.synchronize(false);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('resource', true);
    await queryRunner.dropTable('push_subscription', true);
    await queryRunner.dropTable('contact_letters_letter', true);
    await queryRunner.dropTable('role_permissions_permission', true);
    await queryRunner.dropTable('letter_delivery', true);
    await queryRunner.dropTable('check_in', true);
    await queryRunner.dropTable('auth', true);
    await queryRunner.dropTable('contact', true);
    await queryRunner.dropTable('letter', true);
    await queryRunner.dropTable('user', true);
    await queryRunner.dropTable('role', true);
    await queryRunner.dropTable('permission', true);
  }
}
