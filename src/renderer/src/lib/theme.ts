import { useEffect, useState } from 'react';

/** Thème Monaco aligné sur le thème du système. */
export function useMonacoTheme(): 'vs' | 'vs-dark' {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, [query]);
  return dark ? 'vs-dark' : 'vs';
}
