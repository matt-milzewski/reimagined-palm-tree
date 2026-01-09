import React, { createContext, useContext, useEffect, useState } from 'react';
import { signIn, signOut, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import './amplify';

export type AuthState = {
  loading: boolean;
  isAuthenticated: boolean;
  accessToken?: string;
  idToken?: string;
  username?: string;
};

type AuthContextValue = AuthState & {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    loading: true,
    isAuthenticated: false
  });

  const refresh = async () => {
    try {
      const session = await fetchAuthSession();
      const user = await getCurrentUser();
      const accessToken = session.tokens?.accessToken?.toString();
      const idToken = session.tokens?.idToken?.toString();
      setState({
        loading: false,
        isAuthenticated: !!accessToken,
        accessToken,
        idToken,
        username: user.username
      });
    } catch (error) {
      setState({ loading: false, isAuthenticated: false });
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    refresh();
  }, []);

  const login = async (username: string, password: string) => {
    setState((prev) => ({ ...prev, loading: true }));
    await signIn({ username, password });
    await refresh();
  };

  const logout = async () => {
    await signOut();
    setState({ loading: false, isAuthenticated: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
