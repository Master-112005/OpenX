async function initialize() {
  const snapshot = await window.jarvis.getSettings();
  const assistantName = snapshot?.settings?.assistant?.displayName || 'JARVIS';
  document.getElementById('title').textContent = `${assistantName} Settings`;
  document.getElementById('meta').textContent = `${assistantName} settings now live inside the chat window.`;
}

document.getElementById('open-chat-settings').addEventListener('click', async () => {
  await window.jarvis.openChat();
  window.close();
});

document.getElementById('close-window').addEventListener('click', () => {
  window.close();
});

initialize();
