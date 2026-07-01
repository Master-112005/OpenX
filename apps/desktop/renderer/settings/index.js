async function initialize() {
  const snapshot = await window.openx.getSettings();
  const assistantName = snapshot?.settings?.assistant?.displayName || 'OpenX';
  document.getElementById('title').textContent = `${assistantName} Settings`;
  document.getElementById('meta').textContent = `${assistantName} settings now live inside the chat window.`;
}

document.getElementById('open-chat-settings').addEventListener('click', async () => {
  await window.openx.openChat();
  window.close();
});

document.getElementById('close-window').addEventListener('click', () => {
  window.close();
});

initialize();
