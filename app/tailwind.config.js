/** @type {import('tailwindcss').Config} */
export default {
  // Only scan mobile entry points — keeps generated CSS minimal and avoids
  // interfering with the desktop stylesheet pipeline.
  content: [
    './src/MobileApp.tsx',
    './src/components/mobile/**/*.tsx',
  ],

  corePlugins: {
    // mobile.css handles global resets; let Tailwind skip its own Preflight so
    // the two reset layers don't conflict.
    preflight: false,
  },

  theme: {
    extend: {
      // Map design-system CSS variables to Tailwind colour names.
      // Opacity-based variants on accent/danger use arbitrary values inline:
      //   bg-[rgba(var(--accent-rgb),0.12)]
      colors: {
        'app-bg':     'var(--bg)',
        surface:      'var(--surface)',
        'surface-2':  'var(--surface2)',
        'app-border': 'var(--border)',
        'app-text':   'var(--text)',
        muted:        'var(--text-muted)',
        accent:       'var(--accent)',
        danger:       'var(--red)',
        success:      'var(--green)',
      },

      // Custom animations for the mobile shell.
      // Corresponding @keyframes are also declared in mobile.css (so the Tailwind
      // keyframes output and the CSS sheet are both available regardless of order).
      animation: {
        'mb-spin':         'mb-spin 0.7s linear infinite',
        'mb-blink':        'mb-blink 0.7s step-end infinite',
        'mb-pulse':        'mb-pulse 1s ease-in-out infinite',
        'mb-record-pulse': 'mb-record-pulse 1.4s ease-in-out infinite',
        'toast-in':        'toast-in 0.25s cubic-bezier(0.34,1.56,0.64,1) both',
      },
      keyframes: {
        'mb-spin':  { to: { transform: 'rotate(360deg)' } },
        'mb-blink': { '50%': { opacity: '0' } },
        'mb-pulse': {
          '0%, 100%': { 'box-shadow': '0 0 0 0 rgba(var(--red-rgb), 0.4)' },
          '50%':       { 'box-shadow': '0 0 0 6px rgba(var(--red-rgb), 0)' },
        },
        'mb-record-pulse': {
          '0%, 100%': { 'box-shadow': '0 0 0 0 rgba(var(--red-rgb), 0.35)' },
          '50%':       { 'box-shadow': '0 0 0 14px rgba(var(--red-rgb), 0)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-12px) scale(0.9)' },
          to:   { opacity: '1', transform: 'translateY(0)   scale(1)' },
        },
      },
    },
  },

  plugins: [],
}
