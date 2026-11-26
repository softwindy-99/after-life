export interface NewUser {
  username: string;
  password: string;
  email: string;
  avatar?: string;
}

export interface AdminNewUser extends NewUser {
  roleUuid: string;
}

export interface UpdateUser {
  username?: string;
  password?: string;
  email?: string;
  avatar?: string | null;
}

export interface AdminUpdateUser extends UpdateUser {
  roleUuid?: string;
}
