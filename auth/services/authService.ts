import {
  AuthCredentials,
  RegisterPayload,
  UpdateProfilePayload,
  forgotPassword,
  getMemberProfile,
  getMe,
  login,
  refreshSession,
  register,
  socialAuth,
  signOut,
  updateProfile,
} from "../utils/authApi";

export type {
  AuthCredentials,
  RegisterPayload,
  UpdateProfilePayload,
};

const authService = {
  login,
  refreshSession,
  signOut,
  getMe,
  forgotPassword,
  register,
  socialAuth,
  updateProfile,
  getMemberProfile,
};

export default authService;
