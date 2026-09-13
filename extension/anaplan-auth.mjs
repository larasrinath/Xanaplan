export function safeSignInUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'anaplan.com' || url.hostname.endsWith('.anaplan.com'))) return url.href;
  } catch {}
  return null;
}

export async function openAnaplanSignIn(value, tabs = globalThis.chrome?.tabs) {
  const url = safeSignInUrl(value);
  if (!url || !tabs?.create) return false;
  try { await tabs.create({ url, active: true }); return true; }
  catch { return false; } // The visible link remains available if Chrome cannot open a tab.
}
