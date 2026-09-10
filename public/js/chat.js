/**
 * Chat and Audio Notification Engine
 * Handles Text Messaging, Direct Messages, Hand Raising, and Web Audio API synthesized sound cues
 */
class ChatManager {
  constructor(socket, chatContainerEl, badgeEl) {
    this.socket = socket;
    this.container = chatContainerEl;
    this.badge = badgeEl;
    this.unreadCount = 0;
    this.isChatOpen = false;

    // Web Audio Synthesizer
    this.audioCtx = null;
    this.initAudioContext();
  }

  initAudioContext() {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    } catch (e) {}
  }

  /**
   * Synthesize audio chimes with Web Audio API (Zero external mp3 files needed)
   */
  playSound(type) {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    if (type === 'message') {
      // Gentle two-tone pop
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880.00, now + 0.08); // A5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'join') {
      // Warm rising major arpeggio
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'leave') {
      // Descending tone
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.setValueAtTime(440.00, now + 0.12);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'hand') {
      // Bell chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.50, now); // C6
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  }

  sendMessage(text, toSocketId = null) {
    if (!text || !text.trim() || !this.socket) return;
    this.socket.emit('chat-message', {
      text: text.trim(),
      toSocketId
    });
  }

  addMessage(msg, isLocal = false) {
    if (!this.container) return;

    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${isLocal ? 'msg-local' : 'msg-remote'} ${msg.isPrivate ? 'msg-private' : ''}`;

    const safeText = this.escapeHtml(msg.text);
    const timeStr = msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgEl.innerHTML = `
      <div class="msg-header">
        <span class="msg-sender">${this.escapeHtml(msg.senderName || 'Anonymous')}</span>
        ${msg.isPrivate ? '<span class="msg-badge-private">Direct</span>' : ''}
        <span class="msg-time">${timeStr}</span>
      </div>
      <div class="msg-content">${safeText}</div>
    `;

    this.container.appendChild(msgEl);
    this.container.scrollTop = this.container.scrollHeight;

    if (!isLocal) {
      this.playSound('message');
      if (!this.isChatOpen) {
        this.unreadCount++;
        this.updateBadge();
      }
    }
  }

  updateBadge() {
    if (!this.badge) return;
    if (this.unreadCount > 0) {
      this.badge.textContent = this.unreadCount > 9 ? '9+' : this.unreadCount;
      this.badge.classList.remove('hidden');
    } else {
      this.badge.classList.add('hidden');
    }
  }

  setChatOpen(open) {
    this.isChatOpen = open;
    if (open) {
      this.unreadCount = 0;
      this.updateBadge();
      if (this.container) {
        this.container.scrollTop = this.container.scrollHeight;
      }
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

if (typeof window !== 'undefined') {
  window.ChatManager = ChatManager;
}
