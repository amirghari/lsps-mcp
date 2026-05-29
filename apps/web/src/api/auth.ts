import type {
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthResponse,
} from "@lsps/types";
import { api } from "./client";

export const authApi = {
  register: (body: AuthRegisterRequest) =>
    api<AuthResponse>("/api/auth/register", {
      method: "POST",
      body,
      auth: false,
    }),

  login: (body: AuthLoginRequest) =>
    api<AuthResponse>("/api/auth/login", {
      method: "POST",
      body,
      auth: false,
    }),

  me: () =>
    api<{ id: string; email: string; displayName: string | null }>(
      "/api/auth/me",
    ),
};
