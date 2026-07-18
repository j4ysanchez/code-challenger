import { useSyncExternalStore } from 'react';
import type { User } from '@code-challenger/contracts';

type Listener = () => void;

const listeners = new Set<Listener>();
let currentUser: User | null = null;

export const getSession = (): User | null => currentUser;

export const setSession = (user: User | null): void => {
  currentUser = user;
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Reactive read of the current session; re-renders the calling component on setSession. */
export const useSession = (): User | null => useSyncExternalStore(subscribe, getSession);
