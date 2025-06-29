// Background script for Voyage AI Tutor Chrome Extension

// Handle screenshot capture requests from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle both old and new message formats
    if (request.type === 'CAPTURE_SCREENSHOT' || request.action === 'captureScreenshot') {
        console.log('Background: Received screenshot request');
        
        // Capture the visible tab with proper API call
        chrome.tabs.captureVisibleTab({
            format: 'png',
            quality: 90
        })
        .then((dataUrl) => {
            console.log('Background: Screenshot captured successfully');
            // Send response in the format expected by content script
            sendResponse({ 
                success: true, 
                data: dataUrl.split(',')[1], // Remove data:image/png;base64, prefix
                dataUrl: dataUrl // Keep full dataUrl for backward compatibility
            });
        })
        .catch((error) => {
            console.error('Background: Error capturing screenshot:', error);
            sendResponse({ 
                success: false, 
                error: error.message 
            });
        });
        
        // Return true to indicate we'll respond asynchronously
        return true;
    }
});

console.log('Voyage AI Tutor background script loaded');

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_TUTOR_PANEL" });
    } catch (e) {
      console.warn(
        "Could not send message to content script. " +
        "This is expected on special pages like chrome:// pages. " +
        "If you are on a normal webpage, please try reloading the page first."
      );
    }
  }
}); 