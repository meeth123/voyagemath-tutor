import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './popup/Popup';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function togglePanel() {
  if (container) {
    if (root) {
      root.unmount();
      root = null;
    }
    document.body.removeChild(container);
    container = null;
  } else {
    container = document.createElement('div');
    container.id = 'voyage-ai-tutor-root';
    document.body.appendChild(container);

    root = createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TOGGLE_TUTOR_PANEL") {
    togglePanel();
  }
  return true;
}); 