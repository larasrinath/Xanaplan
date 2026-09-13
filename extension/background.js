import { createDiscoveryService } from './discovery-background.mjs';

const discover = createDiscoveryService(chrome);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'discovery-background') return;
  discover(message, sender).then(reply, error => reply({ ok: false, error: error.message }));
  return true;
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
