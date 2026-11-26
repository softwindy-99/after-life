import { Controller, Get } from '@nestjs/common';
import { Permission } from 'src/permission/permission.decorator';
import { AdminService } from './admin.service';

@Controller('admin')
@Permission('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboard();
  }
}
