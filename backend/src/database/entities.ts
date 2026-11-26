import { McpActivity } from 'src/mcp/mcp-activity.entity';
import { Auth } from 'src/auth/auth.entity';
import { CheckIn } from 'src/check-in/check-in.entity';
import { Contact } from 'src/contact/contact.entity';
import { LetterDelivery } from 'src/letter-delivery/letter-delivery.entity';
import { Letter } from 'src/letter/letter.entity';
import { Permission } from 'src/permission/permission.entity';
import { PushSubscriptionRecord } from 'src/notification/push-subscription.entity';
import { Role } from 'src/role/role.entity';
import { User } from 'src/user/user.entity';
import { Resource } from 'src/resource/resource.entity';

export const databaseEntities = [
  Auth,
  McpActivity,
  CheckIn,
  Contact,
  Letter,
  LetterDelivery,
  Permission,
  PushSubscriptionRecord,
  Role,
  User,
  Resource,
];
