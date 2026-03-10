import { createSupabaseClient } from '@pvsmartinez/shared'

export const supabase = createSupabaseClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    clientOptions: {
      auth: {
        // Persist session in localStorage so the user stays logged in across restarts
        persistSession: true,
        autoRefreshToken: true,
        // We handle URL parsing ourselves in the deep-link event listener (Tauri)
        detectSessionInUrl: false,
        // Implicit flow is required for custom URL schemes (cafezin://) because
        // PKCE stores the code verifier in the WebView but the OAuth callback
        // arrives from an external browser that has no access to it.
        flowType: 'implicit',
      },
    },
  },
)
