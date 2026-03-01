export interface CreateUserRequest {
  email: string;
  role: 'editor' | 'viewer';
}

export interface UpdateUserRoleRequest {
  role: 'admin' | 'editor' | 'viewer';
}
