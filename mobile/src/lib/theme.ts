import { useColorScheme } from 'react-native';

// Tokens from website/style.css so the app and the web portal read as one product.
const light = {
  bg: '#f4f6fb', surface: '#ffffff', border: '#d2d9e8',
  text: '#172036', textSecondary: '#46506b', muted: '#6b7390',
  accent: '#3b6fe0', onAccent: '#ffffff',
  green: '#12a06b', amber: '#c27c0a', red: '#d6453d',
};
const dark = {
  bg: '#0b0e17', surface: '#121623', border: '#323a5a',
  text: '#e9ecf5', textSecondary: '#b4bad3', muted: '#7a82a3',
  accent: '#5b8def', onAccent: '#0b0e17',
  green: '#34d399', amber: '#fbbf24', red: '#f87171',
};

export const radius = { md: 10, lg: 14 };
/** FR-DRV UI: oversized touch targets (>= 56 dp). */
export const MIN_TOUCH = 56;

export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}
