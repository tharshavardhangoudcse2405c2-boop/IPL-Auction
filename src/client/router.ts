import { useCallback, useEffect, useState } from 'react';

export type AppRoute =
  | { page: 'home' }
  | { page: 'create' }
  | { page: 'join'; prefillCode: string }
  | { page: 'players' }
  | { page: 'rules' }
  | { page: 'room'; roomCode: string }
  | { page: 'winner'; roomCode: string }
  | { page: 'results'; roomCode: string };

export function parseAppLocation(pathname: string, search: string): AppRoute {
  const cleanPath = pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(search);
  const queryRoom = (params.get('room') || '').trim().toUpperCase();

  if (cleanPath === '/create') {
    return { page: 'create' };
  }
  if (cleanPath === '/join') {
    return { page: 'join', prefillCode: queryRoom };
  }
  if (cleanPath === '/players') {
    return { page: 'players' };
  }
  if (cleanPath === '/rules') {
    return { page: 'rules' };
  }

  const roomWinnerMatch = cleanPath.match(/^\/room\/([A-Za-z0-9]{4,10})\/winner$/i);
  if (roomWinnerMatch) {
    return { page: 'winner', roomCode: roomWinnerMatch[1].toUpperCase() };
  }

  const roomResultsMatch = cleanPath.match(/^\/room\/([A-Za-z0-9]{4,10})\/results$/i);
  if (roomResultsMatch) {
    return { page: 'results', roomCode: roomResultsMatch[1].toUpperCase() };
  }

  const roomMatch = cleanPath.match(/^\/room\/([A-Za-z0-9]{4,10})$/i);
  if (roomMatch) {
    return { page: 'room', roomCode: roomMatch[1].toUpperCase() };
  }

  if (cleanPath === '/' && queryRoom) {
    return { page: 'join', prefillCode: queryRoom };
  }

  return { page: 'home' };
}

export function useAppRouter() {
  const [route, setRoute] = useState<AppRoute>(() => {
    if (typeof window === 'undefined') return { page: 'home' };
    return parseAppLocation(window.location.pathname, window.location.search);
  });

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseAppLocation(window.location.pathname, window.location.search));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (typeof window === 'undefined') return;
    const current = window.location.pathname + window.location.search;
    if (current !== to) {
      if (opts?.replace) {
        window.history.replaceState({}, '', to);
      } else {
        window.history.pushState({}, '', to);
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    const url = new URL(to, window.location.origin);
    setRoute(parseAppLocation(url.pathname, url.search));
  }, []);

  return { route, navigate };
}
