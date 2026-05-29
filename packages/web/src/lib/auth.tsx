import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api, type User, ACCESS_KEY, REFRESH_KEY } from "./api";

function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({ user: null, loading: true, login: async () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // api.me() transparently refreshes an expired access token, so we only need
    // a refresh token (or a still-valid access token) to attempt session restore.
    if (!localStorage.getItem(ACCESS_KEY) && !localStorage.getItem(REFRESH_KEY)) {
      setLoading(false);
      return;
    }
    api.me().then(setUser).catch(clearTokens).finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { token, refreshToken, user } = await api.login(email, password);
    localStorage.setItem(ACCESS_KEY, token);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    setUser(user);
  };

  const logout = () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (refreshToken) api.logout(refreshToken).catch(() => {}); // best-effort server-side revoke
    clearTokens();
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
