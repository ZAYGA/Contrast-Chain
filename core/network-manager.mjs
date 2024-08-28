import { EventEmitter } from 'events';
import pino from 'pino';

class NetworkManager extends EventEmitter {
  constructor(node, options = {}) {
    super();
    this.node = node;
    this.peers = new Map();
    this.maxPeers = options.maxPeers || 50;
    this.announceInterval = options.announceInterval || 60000; // 1 minute
    this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes
    this.peerTimeout = options.peerTimeout || 600000; // 10 minutes
    
    this.logger = pino({
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        }
      },
    });
    this.logger.info('NetworkManager initialized');
  }
  
  
  async announcePeer() {
    const announcement = {
      peerId: this.node.peerId.toString(),
      timestamp: Date.now(),
      status: this.getNodeStatus()
    };
    await this.node.services.pubsub.publish('peer-announce', JSON.stringify(announcement));
  }

  async handlePeerAnnouncement(message) {
    const announcement = JSON.parse(message.data.toString());
    if (announcement.peerId !== this.node.peerId.toString()) {
      this.updatePeer(announcement.peerId, announcement);
    }
  }

  async handlePeerListRequest(message) {
    const requestingPeer = message.data.toString();
    if (requestingPeer !== this.node.peerId.toString()) {
      const peerList = Array.from(this.peers.values()).map(peer => ({
        peerId: peer.peerId,
        status: peer.status
      }));
      await this.node.services.pubsub.publish(`peer-list-response-${requestingPeer}`, JSON.stringify(peerList));
    }
  }

  async handleNetworkStatusRequest(message) {
    const requestingPeer = message.data.toString();
    if (requestingPeer !== this.node.peerId.toString()) {
      const networkStatus = this.getNetworkStatus();
      await this.node.services.pubsub.publish(`network-status-response-${requestingPeer}`, JSON.stringify(networkStatus));
    }
  }

  cleanupPeers() {
    const now = Date.now();
    for (const [peerId, peerData] of this.peers.entries()) {
      if (now - peerData.lastSeen > this.peerTimeout) {
        this.peers.delete(peerId);
        this.emit('peer-removed', peerId);
      }
    }
  }

  updatePeer(peerId, data) {
    this.peers.set(peerId, {
      ...data,
      lastSeen: Date.now(),
      address: data.address || null,  // Add address information
    });
    this.logger.debug({ peerId, data }, 'Peer updated');
    this.emit('peer-updated', peerId, data);
  }

  getNodeStatus() {
    return {
      isSyncing: false, 
      blockHeight: 0, 
      version: '1.0.0',
      connectionCount: this.peers.size,
      peerId: this.node.peerId.toString(),
    };
  }
  getNetworkStatus() {
    return {
      totalPeers: this.peers.size,
      averageBlockHeight: this.calculateAverageBlockHeight(),
      networkVersion: this.getNetworkVersion()
    };
  }
  getPeers() {
    return Array.from(this.peers.keys());
  }

  getPeerStatus(peerId) {
    const peer = this.peers.get(peerId);
    return peer ? peer.status : null;
  }

  async requestPeerList() {
    try {
      await this.node.services.pubsub.publish('peer-list-request', this.node.peerId.toString());
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Peer list request timed out'));
        }, 10000); // 10 second timeout

        this.node.services.pubsub.subscribe(`peer-list-response-${this.node.peerId.toString()}`, (message) => {
          clearTimeout(timeout);
          const peerList = JSON.parse(message.data.toString());
          resolve(peerList);
          this.node.services.pubsub.unsubscribe(`peer-list-response-${this.node.peerId.toString()}`);
        });
      });
    } catch (error) {
      this.logger.error({ error: error.message }, 'Error requesting peer list');
      throw error;
    }
  }

  async requestNetworkStatus() {
    try {
      await this.node.services.pubsub.publish('network-status-request', this.node.peerId.toString());
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Network status request timed out'));
        }, 10000); // 10 second timeout

        this.node.services.pubsub.subscribe(`network-status-response-${this.node.peerId.toString()}`, (message) => {
          clearTimeout(timeout);
          const networkStatus = JSON.parse(message.data.toString());
          resolve(networkStatus);
          this.node.services.pubsub.unsubscribe(`network-status-response-${this.node.peerId.toString()}`);
        });
      });
    } catch (error) {
      this.logger.error({ error: error.message }, 'Error requesting network status');
      throw error;
    }
  }

  async dialPeer(peerId, protocol) {
    try {
      const connection = await this.node.dial(peerId);
      const stream = await connection.newStream(protocol);
      return stream;
    } catch (error) {
      this.logger.error({ peerId, protocol, error: error.message }, 'Error dialing peer');
      throw error;
    }
  }

  calculateAverageBlockHeight() {
    const heights = Array.from(this.peers.values())
      .map(peer => peer.status.blockHeight)
      .filter(height => typeof height === 'number');
    return heights.length > 0 ? Math.round(heights.reduce((a, b) => a + b) / heights.length) : 0;
  }

  getNetworkVersion() {
    const versions = new Set(Array.from(this.peers.values()).map(peer => peer.status.version));
    return Array.from(versions).join(', ');
  }
}

export { NetworkManager };