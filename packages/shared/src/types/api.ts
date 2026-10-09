// Generic API contract helpers.

export interface ApiSuccess<T> {
  data: T;
  message?: string;
  success?: true;
}

export interface ApiError {
  message: string;
  error?: string;
  details?: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page?: number;
  page_size?: number;
}

export interface MobileLoginRequest {
  username: string;
  password: string;
  device_id?: string;
  device_name?: string;
  platform?: "ios" | "android" | "web";
  app_version?: string;
}

export interface MobileLoginResponse {
  token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
  user: {
    id: string;
    username: string;
    display_name?: string;
    display_name_ar?: string;
    full_name?: string;
    phone?: string;
    email?: string;
    profile_image_url?: string;
    role_id?: number | null;
    role_name?: string;
    role_name_ar?: string;
    section_id?: number | null;
    permissions?: string[];
  };
}

export interface MobileRefreshResponse {
  token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
}
