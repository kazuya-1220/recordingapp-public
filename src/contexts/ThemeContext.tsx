import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';
// '2xs' is a new smaller option (added below 極小). 'xl' is retired — legacy
// stored 'xl' values are migrated to 'lg' at load time.
export type FontSize = '2xs' | 'xs' | 'sm' | 'base' | 'lg';

export const FONT_SIZE_OPTIONS: { key: FontSize; label: string; px: number }[] = [
  { key: '2xs',  label: '極小', px: 11 },
  { key: 'xs',   label: '小',   px: 12 },
  { key: 'sm',   label: '標準', px: 13 },
  { key: 'base', label: '大',   px: 15 },
  { key: 'lg',   label: '特大', px: 17 },
];

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'light', setTheme: () => {}, fontSize: 'base', setFontSize: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('app-theme') as Theme) || 'light';
  });

  const [fontSize, setFontSizeState] = useState<FontSize>(() => {
    const raw = localStorage.getItem('app-font-size');
    // Legacy migration: old value 'xl' (19px, 特大) no longer exists — map to
    // 'lg' which is now the largest option (17px, labeled 特大).
    if (raw === 'xl') return 'lg';
    if (raw && FONT_SIZE_OPTIONS.some(o => o.key === raw)) return raw as FontSize;
    return 'base';
  });

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem('app-theme', t);
  };

  const setFontSize = (s: FontSize) => {
    setFontSizeState(s);
    localStorage.setItem('app-font-size', s);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const px = FONT_SIZE_OPTIONS.find(o => o.key === fontSize)?.px ?? 15;
    document.documentElement.style.fontSize = `${px}px`;
  }, [fontSize]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, fontSize, setFontSize }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
