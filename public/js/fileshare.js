/**
 * Secure End-to-End Encrypted File Transfer Engine over WebRTC DataChannel
 * Features: AES-256-GCM Encryption, SHA-256 Checksums, Chunked Streaming, Flow Control, and UI Progress
 */
class FileShareManager {
  constructor(webrtcManager, roomKeyGetter, uiCallbacks = {}) {
    this.webrtcManager = webrtcManager;
    this.getRoomKey = roomKeyGetter;
    this.callbacks = {
      onFileSendStart: uiCallbacks.onFileSendStart || (() => {}),
      onFileSendProgress: uiCallbacks.onFileSendProgress || (() => {}),
      onFileSendComplete: uiCallbacks.onFileSendComplete || (() => {}),
      onFileReceiveStart: uiCallbacks.onFileReceiveStart || (() => {}),
      onFileReceiveProgress: uiCallbacks.onFileReceiveProgress || (() => {}),
      onFileReceiveComplete: uiCallbacks.onFileReceiveComplete || (() => {}),
      onError: uiCallbacks.onError || (() => {})
    };

    this.CHUNK_SIZE = 16384; // 16 KB chunk size for WebRTC DataChannel
    this.MAX_BUFFERED_AMOUNT = 64 * 1024; // 64 KB flow control threshold

    // Incoming file assembly maps: fileId -> { meta, receivedChunks, totalChunks, chunksMap }
    this.incomingTransfers = new Map();
  }

  /**
   * Encrypt and send a File or Blob to all peers in the room
   */
  async sendFile(file, senderName = 'Me') {
    if (!file) return;

    try {
      const fileBuffer = await file.arrayBuffer();

      // Compute original file checksum for integrity verification
      const originalSha256 = await CryptoUtil.computeSha256(fileBuffer);

      // Encrypt with room AES-256-GCM key
      const roomKey = await this.getRoomKey();
      let payloadToSend = fileBuffer;
      let isEncrypted = false;

      if (roomKey) {
        try {
          payloadToSend = await CryptoUtil.encryptBuffer(fileBuffer, roomKey);
          isEncrypted = true;
        } catch (encErr) {
          console.warn('Encryption failed, sending unencrypted fallback:', encErr);
        }
      }

      const fileId = 'file_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      const totalSize = payloadToSend.byteLength;
      const totalChunks = Math.ceil(totalSize / this.CHUNK_SIZE);

      const metadata = {
        type: 'file-meta',
        fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        senderName,
        totalChunks,
        totalBytes: totalSize,
        originalSha256,
        isEncrypted
      };

      // Broadcast metadata header
      this.callbacks.onFileSendStart(metadata);
      this.webrtcManager.broadcastData(JSON.stringify(metadata));

      // Stream chunks with flow control
      const dataView = new Uint8Array(payloadToSend);
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * this.CHUNK_SIZE;
        const end = Math.min(start + this.CHUNK_SIZE, totalSize);
        const chunkData = dataView.slice(start, end);

        // Packet structure:
        // [fileIdLength: 1 byte] [fileId: utf-8] [chunkIndex: 4 bytes] [chunkData: remainder]
        const fileIdBytes = new TextEncoder().encode(fileId);
        const headerBuffer = new ArrayBuffer(1 + fileIdBytes.length + 4);
        const headerView = new DataView(headerBuffer);
        headerView.setUint8(0, fileIdBytes.length);
        new Uint8Array(headerBuffer, 1, fileIdBytes.length).set(fileIdBytes);
        headerView.setUint32(1 + fileIdBytes.length, chunkIndex);

        const packet = new Uint8Array(headerBuffer.byteLength + chunkData.byteLength);
        packet.set(new Uint8Array(headerBuffer), 0);
        packet.set(chunkData, headerBuffer.byteLength);

        // Send packet across all peers
        await this.sendChunkWithFlowControl(packet.buffer);

        const progressPercent = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        this.callbacks.onFileSendProgress({ fileId, progress: progressPercent });
      }

      this.callbacks.onFileSendComplete({ fileId, fileName: file.name, sha256: originalSha256 });
    } catch (err) {
      console.error('File send error:', err);
      this.callbacks.onError('Failed to send file: ' + err.message);
    }
  }

  /**
   * Flow control helper: waits if peer DataChannel buffer is full
   */
  async sendChunkWithFlowControl(packetBuffer) {
    let pending = false;
    for (const [socketId, peer] of this.webrtcManager.peers.entries()) {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        if (peer.dataChannel.bufferedAmount > this.MAX_BUFFERED_AMOUNT) {
          pending = true;
          await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
              if (!peer.dataChannel || peer.dataChannel.bufferedAmount <= this.MAX_BUFFERED_AMOUNT / 2) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 25);
          });
        }
        try {
          peer.dataChannel.send(packetBuffer);
        } catch (e) {
          console.warn(`Chunk send error to ${socketId}:`, e);
        }
      }
    }
  }

  /**
   * Handle incoming DataChannel packet (Metadata JSON or Binary Chunk)
   */
  async handleDataChannelMessage(socketId, rawData) {
    if (typeof rawData === 'string') {
      try {
        const parsed = JSON.parse(rawData);
        if (parsed.type === 'file-meta') {
          this.handleFileMeta(parsed);
        }
      } catch (e) {
        // Not a JSON file meta, ignore
      }
      return;
    }

    if (rawData instanceof ArrayBuffer) {
      this.handleFileChunk(rawData);
    }
  }

  /**
   * Initialize incoming file record from metadata
   */
  handleFileMeta(meta) {
    this.incomingTransfers.set(meta.fileId, {
      meta,
      receivedChunks: 0,
      totalChunks: meta.totalChunks,
      chunks: new Array(meta.totalChunks)
    });
    this.callbacks.onFileReceiveStart(meta);
  }

  /**
   * Parse chunk packet, buffer, and trigger assembly upon completion
   */
  async handleFileChunk(packetBuffer) {
    try {
      const headerView = new DataView(packetBuffer);
      const fileIdLength = headerView.getUint8(0);
      const fileIdBytes = new Uint8Array(packetBuffer, 1, fileIdLength);
      const fileId = new TextDecoder().decode(fileIdBytes);
      const chunkIndex = headerView.getUint32(1 + fileIdLength);

      const chunkData = packetBuffer.slice(1 + fileIdLength + 4);

      const transfer = this.incomingTransfers.get(fileId);
      if (!transfer) return;

      if (!transfer.chunks[chunkIndex]) {
        transfer.chunks[chunkIndex] = chunkData;
        transfer.receivedChunks++;

        const progressPercent = Math.round((transfer.receivedChunks / transfer.totalChunks) * 100);
        this.callbacks.onFileReceiveProgress({
          fileId,
          progress: progressPercent,
          fileName: transfer.meta.fileName
        });

        // Check if all chunks have arrived
        if (transfer.receivedChunks === transfer.totalChunks) {
          await this.assembleAndCompleteFile(fileId, transfer);
        }
      }
    } catch (err) {
      console.error('Error handling file chunk:', err);
    }
  }

  /**
   * Assemble chunks, decrypt, verify SHA-256 hash, and produce download link
   */
  async assembleAndCompleteFile(fileId, transfer) {
    try {
      const { meta, chunks } = transfer;

      // Concatenate chunks
      let totalLength = 0;
      for (let i = 0; i < chunks.length; i++) {
        totalLength += chunks[i].byteLength;
      }

      const combinedBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        combinedBuffer.set(new Uint8Array(chunks[i]), offset);
        offset += chunks[i].byteLength;
      }

      let finalBuffer = combinedBuffer.buffer;

      // Decrypt if encrypted
      if (meta.isEncrypted) {
        const roomKey = await this.getRoomKey();
        if (roomKey) {
          try {
            finalBuffer = await CryptoUtil.decryptBuffer(finalBuffer, roomKey);
          } catch (decErr) {
            console.error('Decryption failed for received file:', decErr);
            this.callbacks.onError('Failed to decrypt received file. Passcode may not match.');
            return;
          }
        }
      }

      // Verify SHA-256 checksum
      const computedHash = await CryptoUtil.computeSha256(finalBuffer);
      const isVerified = computedHash.toLowerCase() === meta.originalSha256.toLowerCase();

      // Create downloadable Blob
      const blob = new Blob([finalBuffer], { type: meta.fileType });
      const downloadUrl = URL.createObjectURL(blob);

      this.callbacks.onFileReceiveComplete({
        fileId: meta.fileId,
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        fileType: meta.fileType,
        senderName: meta.senderName,
        downloadUrl,
        isVerified,
        isEncrypted: meta.isEncrypted,
        sha256: computedHash
      });

      this.incomingTransfers.delete(fileId);
    } catch (err) {
      console.error('File reassembly failed:', err);
      this.callbacks.onError('File reassembly failed: ' + err.message);
    }
  }
}

if (typeof window !== 'undefined') {
  window.FileShareManager = FileShareManager;
}
