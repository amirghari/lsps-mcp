import { useCallback, useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { AuthResponse } from "@lsps/types";
import { authApi } from "../api/auth";
import { getToken, setToken } from "../api/client";

const TOKEN_EVENT = "lsps:token-changed";

function broadcast() {
  window.dispatchEvent(new CustomEvent(TOKEN_EVENT));
}

/**
 * Auth state for the app. Keeps the localStorage token and React Query's
 * /auth/me result in sync via a custom "token-changed" event — no Context
 * provider needed for a single-page demo.
 */
export function useAuth() {
  const qc = useQueryClient();
  const [hasToken, setHasToken] = useState<boolean>(() => !!getToken());

  useEffect(() => {
    const sync = () => setHasToken(!!getToken());
    window.addEventListener(TOKEN_EVENT, sync);
    window.addEventListener("storage", sync); // cross-tab
    return () => {
      window.removeEventListener(TOKEN_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => authApi.me(),
    enabled: hasToken,
    staleTime: 60_000,
    retry: false,
  });

  const onSuccess = useCallback(
    (data: AuthResponse) => {
      setToken(data.token);
      broadcast();
      qc.setQueryData(["auth", "me"], data.user);
    },
    [qc],
  );

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess,
  });

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess,
  });

  const logout = useCallback(() => {
    setToken(null);
    broadcast();
    qc.removeQueries({ queryKey: ["auth", "me"] });
    qc.removeQueries({ queryKey: ["my-reservation"] });
  }, [qc]);

  return {
    user: meQuery.data ?? null,
    isAuthenticated: hasToken && !!meQuery.data,
    isLoadingUser: hasToken && meQuery.isLoading,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    loginError: loginMutation.error,
    registerError: registerMutation.error,
    isAuthenticating:
      loginMutation.isPending || registerMutation.isPending,
    logout,
  };
}
