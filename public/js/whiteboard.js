/**
 * Collaborative Real-Time Whiteboard Engine
 * Supports Pen, Highlighter, Eraser, Shapes, Text, Undo/Redo, Realtime Sync & Multiplayer Cursors
 */
class Whiteboard {
  constructor(canvasElement, cursorOverlayElement, socket, webrtcManager) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.cursorOverlay = cursorOverlayElement;
    this.socket = socket;
    this.webrtcManager = webrtcManager;

    // Tool state
    this.currentTool = 'pen'; // 'pen', 'highlighter', 'eraser', 'line', 'arrow', 'rect', 'circle', 'text'
    this.currentColor = '#6366f1';
    this.currentSize = 4;
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;

    // History for local undo/redo
    this.history = [];
    this.redoStack = [];
    this.maxHistory = 100;

    // Remote cursors
    this.remoteCursors = new Map(); // socketId -> DOMElement

    this.initCanvasSize();
    this.bindEvents();
    this.bindNetworkEvents();
  }

  initCanvasSize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = (rect.width || 1200) * dpr;
    this.canvas.height = (rect.height || 700) * dpr;
    this.ctx.scale(dpr, dpr);
    this.redrawAll();
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.initCanvasSize();
    });

    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const handleStart = (e) => {
      const pos = getPos(e);
      this.isDrawing = true;
      this.startX = pos.x;
      this.startY = pos.y;

      if (this.currentTool === 'text') {
        const text = prompt('Enter text to place on whiteboard:');
        if (text && text.trim()) {
          const item = {
            tool: 'text',
            text: text.trim(),
            x: pos.x,
            y: pos.y,
            color: this.currentColor,
            size: this.currentSize * 4
          };
          this.executeItem(item);
          this.saveItem(item, true);
        }
        this.isDrawing = false;
        return;
      }

      this.currentPath = [pos];
    };

    const handleMove = (e) => {
      const pos = getPos(e);

      // Broadcast cursor movement
      this.broadcastCursor(pos.x, pos.y);

      if (!this.isDrawing) return;

      if (this.currentTool === 'pen' || this.currentTool === 'highlighter' || this.currentTool === 'eraser') {
        this.currentPath.push(pos);
        // Draw last segment immediately for fluid feedback
        const p1 = this.currentPath[this.currentPath.length - 2];
        const p2 = pos;
        this.drawSegment(p1, p2, this.currentTool, this.currentColor, this.currentSize);
      } else {
        // For shapes: redraw preview
        this.redrawAll();
        this.drawShape(this.startX, this.startY, pos.x, pos.y, this.currentTool, this.currentColor, this.currentSize);
      }
    };

    const handleEnd = (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;

      let item = null;
      if (this.currentTool === 'pen' || this.currentTool === 'highlighter' || this.currentTool === 'eraser') {
        if (this.currentPath && this.currentPath.length > 0) {
          item = {
            tool: this.currentTool,
            points: this.currentPath,
            color: this.currentColor,
            size: this.currentSize
          };
        }
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.changedTouches ? e.changedTouches[0].clientX : (e.clientX || this.startX);
        const clientY = e.changedTouches ? e.changedTouches[0].clientY : (e.clientY || this.startY);
        const endX = clientX - rect.left;
        const endY = clientY - rect.top;

        item = {
          tool: this.currentTool,
          x1: this.startX,
          y1: this.startY,
          x2: endX,
          y2: endY,
          color: this.currentColor,
          size: this.currentSize
        };
      }

      if (item) {
        this.saveItem(item, true);
        this.redrawAll();
      }
      this.currentPath = [];
    };

    this.canvas.addEventListener('mousedown', handleStart);
    this.canvas.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);

    this.canvas.addEventListener('touchstart', handleStart, { passive: true });
    this.canvas.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', handleEnd);
  }

  drawSegment(p1, p2, tool, color, size) {
    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = size;

    if (tool === 'eraser') {
      this.ctx.strokeStyle = '#0f172a'; // Canvas background color
      this.ctx.lineWidth = size * 3;
    } else if (tool === 'highlighter') {
      this.ctx.strokeStyle = color;
      this.ctx.globalAlpha = 0.35;
      this.ctx.lineWidth = size * 3;
    } else {
      this.ctx.strokeStyle = color;
      this.ctx.globalAlpha = 1.0;
    }

    this.ctx.beginPath();
    this.ctx.moveTo(p1.x, p1.y);
    this.ctx.lineTo(p2.x, p2.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawShape(x1, y1, x2, y2, tool, color, size) {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.ctx.beginPath();

    if (tool === 'line') {
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    } else if (tool === 'arrow') {
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = size * 3 + 8;
      this.ctx.beginPath();
      this.ctx.moveTo(x2, y2);
      this.ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      this.ctx.moveTo(x2, y2);
      this.ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      this.ctx.stroke();
    } else if (tool === 'rect') {
      this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (tool === 'circle') {
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      const cx = Math.min(x1, x2) + rx;
      const cy = Math.min(y1, y2) + ry;
      this.ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  drawText(text, x, y, color, size) {
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.font = `${size || 16}px Inter, sans-serif`;
    this.ctx.fillText(text, x, y);
    this.ctx.restore();
  }

  drawImage(dataUrl, x, y, width, height) {
    const img = new Image();
    img.onload = () => {
      this.ctx.drawImage(img, x, y, width, height);
    };
    img.src = dataUrl;
  }

  addImageFromFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const img = new Image();
      img.onload = () => {
        let maxW = 400;
        let maxH = 300;
        let w = img.width;
        let h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = w * ratio;
          h = h * ratio;
        }
        const item = {
          tool: 'image',
          dataUrl,
          x: 60,
          y: 60,
          width: w,
          height: h
        };
        this.executeItem(item);
        this.saveItem(item, true);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  executeItem(item) {
    if (item.tool === 'pen' || item.tool === 'highlighter' || item.tool === 'eraser') {
      if (!item.points || item.points.length < 2) return;
      for (let i = 1; i < item.points.length; i++) {
        this.drawSegment(item.points[i - 1], item.points[i], item.tool, item.color, item.size);
      }
    } else if (item.tool === 'text') {
      this.drawText(item.text, item.x, item.y, item.color, item.size);
    } else if (item.tool === 'image') {
      this.drawImage(item.dataUrl, item.x, item.y, item.width, item.height);
    } else {
      this.drawShape(item.x1, item.y1, item.x2, item.y2, item.tool, item.color, item.size);
    }
  }

  saveItem(item, broadcast = true) {
    this.history.push(item);
    this.redoStack = [];
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    if (broadcast) {
      // Send via DataChannel if available, else Socket.io
      const payload = { type: 'wb-draw', item };
      let sentViaDc = false;
      if (this.webrtcManager) {
        sentViaDc = this.webrtcManager.broadcastData(JSON.stringify(payload)) > 0;
      }
      if (!sentViaDc && this.socket) {
        this.socket.emit('whiteboard-draw', item);
      }
    }
  }

  redrawAll() {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    for (const item of this.history) {
      this.executeItem(item);
    }
  }

  undo() {
    if (this.history.length === 0) return;
    const popped = this.history.pop();
    this.redoStack.push(popped);
    this.redrawAll();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const item = this.redoStack.pop();
    this.history.push(item);
    this.redrawAll();
  }

  clear(broadcast = true) {
    this.history = [];
    this.redoStack = [];
    this.redrawAll();

    if (broadcast) {
      if (this.webrtcManager) {
        this.webrtcManager.broadcastData(JSON.stringify({ type: 'wb-clear' }));
      }
      if (this.socket) {
        this.socket.emit('whiteboard-clear');
      }
    }
  }

  exportImage() {
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.png`;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }

  broadcastCursor(x, y) {
    const now = Date.now();
    if (this._lastCursorSent && now - this._lastCursorSent < 60) return;
    this._lastCursorSent = now;

    if (this.socket) {
      this.socket.emit('whiteboard-cursor', { x, y });
    }
  }

  bindNetworkEvents() {
    if (this.socket) {
      this.socket.on('whiteboard-draw', (item) => {
        this.history.push(item);
        this.executeItem(item);
      });

      this.socket.on('whiteboard-clear', () => {
        this.clear(false);
      });

      this.socket.on('whiteboard-cursor', (data) => {
        this.updateRemoteCursor(data.socketId, data.x, data.y);
      });
    }
  }

  handleDataChannelMessage(data) {
    try {
      if (typeof data !== 'string') return;
      const parsed = JSON.parse(data);
      if (parsed.type === 'wb-draw' && parsed.item) {
        this.history.push(parsed.item);
        this.executeItem(parsed.item);
      } else if (parsed.type === 'wb-clear') {
        this.clear(false);
      }
    } catch (e) {}
  }

  updateRemoteCursor(socketId, x, y) {
    if (!this.cursorOverlay) return;
    let cursorEl = this.remoteCursors.get(socketId);
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'remote-cursor';
      cursorEl.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2.5">
          <path d="M3 3l7 18 3-7 7-3L3 3z"/>
        </svg>
      `;
      this.cursorOverlay.appendChild(cursorEl);
      this.remoteCursors.set(socketId, cursorEl);
    }

    cursorEl.style.transform = `translate(${x}px, ${y}px)`;

    clearTimeout(cursorEl._timer);
    cursorEl._timer = setTimeout(() => {
      if (cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
      this.remoteCursors.delete(socketId);
    }, 4000);
  }
}

if (typeof window !== 'undefined') {
  window.Whiteboard = Whiteboard;
}
