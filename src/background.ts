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