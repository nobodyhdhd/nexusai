/* ─── NexusAI Frontend ──────────────────────────────────────────────────────── */

// Configure marked
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

// Custom renderer for code blocks with header
const renderer = new marked.Renderer();
renderer.code = (code, lang) => {
  const language = lang || 'text';
  let highlighted;
  try {
    highlighted = hljs.getLanguage(language)
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code).value;
  } catch { highlighted = code; }
  return `
    <pre>
      <div class="code-header">
        <span class="code-lang">${language}</span>
        <button class="copy-code-btn" onclick="copyCode(this)">Copy</button>
      </div>
      <code class="hljs language-${language}">${highlighted}</code>
    </pre>`;
};
marked.use({ renderer });

// ─── State ──────────────────────────────────────────────────────────────────
let currentChatId = null;
let isLoading = false;
let isImageMode = false;
let isRecording = false;
let recognition = null;
let isAuthenticated = false;
let currentUsername = '';

// ─── DOM refs ───────────────────────────────────────────────────────────────
const authOverlay      = document.getElementById('auth-overlay');
const appEl            = document.getElementById('app');
const sidebar          = document.getElementById('sidebar');
const chatList         = document.getElementById('chat-list');
const newChatBtn       = document.getElementById('new-chat-btn');
const messagesEl       = document.getElementById('messages');
const messagesContainer = document.getElementById('messages-container');
const welcomeScreen    = document.getElementById('welcome-screen');
const messageInput     = document.getElementById('message-input');
const sendBtn          = document.getElementById('send-btn');
const voiceBtn         = document.getElementById('voice-btn');
const imageModeBtn     = document.getElementById('image-mode-btn');
const imageModeBanner  = document.getElementById('image-mode-banner');
const cancelImageMode  = document.getElementById('cancel-image-mode');
const chatTitleDisplay = document.getElementById('chat-title-display');
const menuBtn          = document.getElementById('menu-btn');
const sidebarToggle    = document.getElementById('sidebar-toggle');
const logoutBtn        = document.getElementById('logout-btn');
const userNameEl       = document.getElementById('user-name');
const userAvatarEl     = document.getElementById('user-avatar');

// ─── Init ────────────────────────────────────────────────────────────────────
(async function init() {
  await checkAuth();
  setupEventListeners();
  setupVoiceInput();
})();

// ─── Auth ────────────────────────────────────────────────────────────────────
async function checkAuth() {
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  if (data.authenticated) {
    isAuthenticated = true;
    currentUsername = data.username;
    showApp();
    loadChats();
  } else {
    showAuthModal();
  }
}

function showApp() {
  authOverlay.classList.add('hidden');
  appEl.classList.remove('hidden');
  userNameEl.textContent = currentUsername || 'Guest';
  userAvatarEl.textContent = (currentUsername || 'G')[0].toUpperCase();
  if (!isAuthenticated) {
    logoutBtn.style.display = 'none';
  }
}

function showAuthModal() {
  authOverlay.classList.remove('hidden');
  appEl.classList.add('hidden');
}

// Auth tab switching
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-form').classList.add('active');
  });
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.textContent = '';

  if (!email || !password) { errEl.textContent = 'Please fill all fields.'; return; }

  const res  = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error; return; }

  isAuthenticated = true;
  currentUsername = data.username;
  showApp();
  loadChats();
});

document.getElementById('register-btn').addEventListener('click', async () => {
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('register-error');
  errEl.textContent = '';

  if (!username || !email || !password) { errEl.textContent = 'Please fill all fields.'; return; }

  const res  = await fetch('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error; return; }

  isAuthenticated = true;
  currentUsername = data.username;
  showApp();
  loadChats();
});

document.getElementById('guest-btn').addEventListener('click', () => {
  isAuthenticated = false;
  currentUsername = 'Guest';
  showApp();
  showWelcome();
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  isAuthenticated = false;
  currentChatId = null;
  chatList.innerHTML = '<p class="empty-chats">No conversations yet</p>';
  showAuthModal();
});

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function setupEventListeners() {
  menuBtn.addEventListener('click', toggleSidebar);
  sidebarToggle.addEventListener('click', toggleSidebar);
  newChatBtn.addEventListener('click', startNewChat);
  sendBtn.addEventListener('click', handleSend);
  messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  messageInput.addEventListener('input', () => {
    autoResizeTextarea();
    sendBtn.disabled = !messageInput.value.trim();
  });

  imageModeBtn.addEventListener('click', () => toggleImageMode(true));
  cancelImageMode.addEventListener('click', () => toggleImageMode(false));

  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      messageInput.value = card.dataset.prompt;
      sendBtn.disabled = false;
      messageInput.focus();
      handleSend();
    });
  });

  // Mobile sidebar overlay
  document.addEventListener('click', e => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && e.target !== menuBtn) {
        closeSidebar();
      }
    }
  });
}

function toggleSidebar() {
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
  } else {
    sidebar.classList.toggle('collapsed');
  }
}

function closeSidebar() {
  sidebar.classList.remove('open');
}

// ─── Textarea auto-resize ────────────────────────────────────────────────────
function autoResizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
}

// ─── Chat management ──────────────────────────────────────────────────────────
async function loadChats() {
  if (!isAuthenticated) return;
  const res = await fetch('/api/chats');
  if (!res.ok) return;
  const chats = await res.json();
  renderChatList(chats);
}

function renderChatList(chats) {
  if (!chats.length) {
    chatList.innerHTML = '<p class="empty-chats">No conversations yet</p>';
    return;
  }
  chatList.innerHTML = chats.map(chat => `
    <div class="chat-item ${chat.id === currentChatId ? 'active' : ''}" data-id="${chat.id}">
      <svg class="chat-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="chat-item-title">${escapeHtml(chat.title)}</span>
      <button class="chat-item-delete" data-id="${chat.id}" title="Delete chat">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    </div>
  `).join('');

  chatList.querySelectorAll('.chat-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.chat-item-delete')) return;
      loadChat(item.dataset.id);
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  chatList.querySelectorAll('.chat-item-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteChat(btn.dataset.id);
    });
  });
}

async function startNewChat() {
  if (!isAuthenticated) {
    messagesEl.innerHTML = '';
    currentChatId = null;
    showWelcome();
    chatTitleDisplay.textContent = 'NexusAI';
    return;
  }

  const res  = await fetch('/api/chats', { method: 'POST' });
  const data = await res.json();
  currentChatId = data.id;
  messagesEl.innerHTML = '';
  showWelcome();
  chatTitleDisplay.textContent = 'New Chat';
  await loadChats();
  if (window.innerWidth <= 768) closeSidebar();
}

async function loadChat(chatId) {
  currentChatId = chatId;
  hideWelcome();
  messagesEl.innerHTML = '';

  const res  = await fetch(`/api/chats/${chatId}`);
  const data = await res.json();
  chatTitleDisplay.textContent = data.title;

  data.messages.forEach(msg => appendMessage(msg.role, msg.content, false));
  scrollToBottom();
  updateActiveChatItem();
}

async function deleteChat(chatId) {
  await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
  if (currentChatId === chatId) {
    currentChatId = null;
    messagesEl.innerHTML = '';
    showWelcome();
    chatTitleDisplay.textContent = 'NexusAI';
  }
  await loadChats();
}

function updateActiveChatItem() {
  chatList.querySelectorAll('.chat-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === currentChatId);
  });
}

// ─── Messaging ───────────────────────────────────────────────────────────────
async function handleSend() {
  const text = messageInput.value.trim();
  if (!text || isLoading) return;

  // Guest mode — simulate AI
  if (!isAuthenticated) {
    appendMessage('user', text);
    messageInput.value = '';
    autoResizeTextarea();
    sendBtn.disabled = true;
    hideWelcome();
    showTyping();
    setTimeout(() => {
      removeTyping();
      appendMessage('assistant',
        '👋 **Hello!** I\'m NexusAI.\n\nTo save conversations and unlock full AI responses, please **sign in or create a free account** using the button in the sidebar.\n\nYou can still chat — but your messages won\'t be saved and I can\'t connect to the AI in guest mode.');
    }, 1200);
    return;
  }

  // Ensure we have a chat
  if (!currentChatId) {
    const res = await fetch('/api/chats', { method: 'POST' });
    const data = await res.json();
    currentChatId = data.id;
  }

  if (isImageMode) {
    await handleImageGeneration(text);
    return;
  }

  appendMessage('user', text);
  messageInput.value = '';
  autoResizeTextarea();
  sendBtn.disabled = true;
  hideWelcome();
  isLoading = true;
  showTyping();

  try {
    const res  = await fetch(`/api/chats/${currentChatId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();

    removeTyping();
    if (!res.ok) {
      appendMessage('assistant', `❌ **Error:** ${data.error || 'Something went wrong.'}`);
    } else {
      appendMessage('assistant', data.response);
      if (data.chat_title) {
        chatTitleDisplay.textContent = data.chat_title;
        await loadChats();
      }
    }
  } catch (err) {
    removeTyping();
    appendMessage('assistant', '❌ **Connection error.** Please check your setup and try again.');
  } finally {
    isLoading = false;
  }
}

async function handleImageGeneration(prompt) {
  appendMessage('user', `🎨 Generate image: ${prompt}`);
  messageInput.value = '';
  autoResizeTextarea();
  sendBtn.disabled = true;
  isLoading = true;
  showTyping();

  try {
    const res  = await fetch('/api/image/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    removeTyping();

    if (!res.ok) {
      appendMessage('assistant', `❌ **Image generation failed:** ${data.error}`);
    } else {
      const row = appendMessage('assistant', `✨ Here's your generated image for: *${escapeHtml(prompt)}*`);
      const img = document.createElement('img');
      img.src = data.image_url;
      img.className = 'generated-image';
      img.alt = prompt;
      row.querySelector('.message-bubble').appendChild(img);
    }
  } catch (err) {
    removeTyping();
    appendMessage('assistant', '❌ Image generation error.');
  } finally {
    isLoading = false;
  }
}

// ─── Message rendering ────────────────────────────────────────────────────────
function appendMessage(role, content, animate = true) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (!animate) row.style.animation = 'none';

  const avatarIcon = role === 'user'
    ? (currentUsername || 'U')[0].toUpperCase()
    : '✦';

  const renderedContent = role === 'assistant'
    ? marked.parse(content)
    : `<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`;

  row.innerHTML = `
    <div class="message-avatar">${avatarIcon}</div>
    <div class="message-content-wrapper">
      <div class="message-bubble">${renderedContent}</div>
      <div class="message-actions">
        <button class="msg-action-btn" onclick="copyMessage(this)" title="Copy">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy
        </button>
      </div>
    </div>`;

  row.dataset.rawContent = content;
  messagesEl.appendChild(row);
  scrollToBottom();
  return row;
}

function showTyping() {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = 'typing-row';
  row.innerHTML = `
    <div class="message-avatar">✦</div>
    <div class="message-content-wrapper">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  messagesEl.appendChild(row);
  scrollToBottom();
}

function removeTyping() {
  const row = document.getElementById('typing-row');
  if (row) row.remove();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showWelcome() {
  welcomeScreen.style.display = 'flex';
  messagesContainer.style.display = 'none';
}

function hideWelcome() {
  welcomeScreen.style.display = 'none';
  messagesContainer.style.display = 'block';
}

function toggleImageMode(on) {
  isImageMode = on;
  imageModeBanner.classList.toggle('hidden', !on);
  messageInput.placeholder = on
    ? 'Describe the image you want to generate…'
    : 'Message NexusAI…';
  if (on) messageInput.focus();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Copy message
function copyMessage(btn) {
  const row     = btn.closest('.message-row');
  const content = row.dataset.rawContent || row.querySelector('.message-bubble').innerText;
  navigator.clipboard.writeText(content).then(() => {
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    }, 2000);
  });
}

// Copy code block
function copyCode(btn) {
  const code = btn.closest('pre').querySelector('code').innerText;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}

// ─── Voice Input ─────────────────────────────────────────────────────────────
function setupVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceBtn.style.display = 'none';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isRecording = true;
    voiceBtn.classList.add('recording');
    voiceBtn.title = 'Recording… click to stop';
  };

  recognition.onresult = e => {
    const transcript = Array.from(e.results)
      .map(r => r[0].transcript).join('');
    messageInput.value = transcript;
    autoResizeTextarea();
    sendBtn.disabled = !transcript.trim();
  };

  recognition.onend = () => {
    isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.title = 'Voice input';
  };

  voiceBtn.addEventListener('click', () => {
    if (isRecording) { recognition.stop(); }
    else { recognition.start(); }
  });
}

// ─── Initial view ────────────────────────────────────────────────────────────
showWelcome();
