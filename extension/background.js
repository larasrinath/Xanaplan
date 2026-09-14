import { createDiscoveryService } from './discovery-background.mjs';
import { createPageService } from './page-background.mjs';

const discover = createDiscoveryService(chrome);
const page = createPageService(chrome);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handle = message?.target === 'discovery-background' ? discover : message?.target === 'page-background' ? page : null;
  if (!handle) return;
  handle(message, sender).then(reply, error => reply({ ok: false, error: error.message }));
  return true;
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
