import { EventEmitter } from 'events';
import pino from 'pino';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { mplex } from '@libp2p/mplex';
import { noise } from '@chainsafe/libp2p-noise';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { bootstrap } from '@libp2p/bootstrap';
import { multiaddr } from 'multiaddr';

class P2PNetwork extends EventEmitter {

    constructor(options = {}) {
        super();
        this.options = {
            bootstrapNodes: [],
            maxPeers: 50,
            announceInterval: 60000,
            cleanupInterval: 300000,
            peerTimeout: 600000,
            logLevel: 'info', // 'info',
            logging: true,
            listenAddress: '/ip4/0.0.0.0/tcp/0',
            ...options
        };

        this.node = null;
        this.peers = new Map();
        this.subscriptions = new Set();

        this.announceIntervalId = null;
        this.cleanupIntervalId = null;

        if (!P2PNetwork.logger) {
            P2PNetwork.logger = P2PNetwork.initLogger(this.options);
        }
        this.logger = P2PNetwork.logger;
        this.logger.setMaxListeners(10000);
    }

    static initLogger(options) {
        return pino({
            level: options.logLevel,
            enabled: options.logging,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                    messageFormat: '{component} - {msg}'
                }
            }
        });
    }

    async start() {
        try {
            this.node = await this.createLibp2pNode();
            await this.node.start();
            this.logger.debug({ component: 'P2PNetwork', peerId: this.node.peerId.toString() }, `${this.options.role} node started`);

            await this.connectToBootstrapNodes();
            this.setupEventListeners();
            this.startPeriodicTasks();
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', error: error.message }, 'Failed to start P2P network');
            throw error;
        }
    }

    async createLibp2pNode() {
        const peerDiscovery = [mdns()];
        if (this.options.bootstrapNodes.length > 0) {
            peerDiscovery.push(bootstrap({ list: this.options.bootstrapNodes }));
        }
        return createLibp2p({
            addresses: { listen: [this.options.listenAddress] },
            transports: [tcp()],
            streamMuxers: [mplex()],
            connectionEncryption: [noise()],
            services: {
                identify: identify(),
                pubsub: gossipsub({
                    emitSelf: false,
                    gossipIncoming: true,
                    fallbackToFloodsub: true,
                    floodPublish: true,
                    allowPublishToZeroPeers: true,
                }),
            },
            peerDiscovery,
            connectionManager: {
                autoDial: true,
            },
        });
    }

    async connectToBootstrapNodes() {
        for (const addr of this.options.bootstrapNodes) {
            try {
                const ma = multiaddr(addr);
                await this.node.dial(ma);
                this.logger.info({ component: 'P2PNetwork', bootstrapNode: addr }, 'Connected to bootstrap node');
            } catch (err) {
                this.logger.error({ component: 'P2PNetwork', bootstrapNode: addr, error: err.message }, 'Failed to connect to bootstrap node');
            }
        }
    }

    setupEventListeners() {
        this.node.addEventListener('peer:connect', this.handlePeerConnect.bind(this));
        this.node.addEventListener('peer:disconnect', this.handlePeerDisconnect.bind(this));
        this.node.services.pubsub.addEventListener('message', this.handlePubsubMessage.bind(this));
    }

    startPeriodicTasks() {
        this.announceIntervalId = setInterval(() => this.announcePeer(), this.options.announceInterval);
        this.cleanupIntervalId = setInterval(() => this.cleanupPeers(), this.options.cleanupInterval);
    }

    handlePeerConnect = ({ detail: peerId }) => {
        this.logger.debug({ component: 'P2PNetwork', peerId: peerId.toString() }, 'Peer connected');
        this.updatePeer(peerId.toString(), { status: 'connected' });
        this.emit('peer:connect', peerId.toString());
    }

    handlePeerDisconnect = ({ detail: peerId }) => {
        this.logger.debug({ component: 'P2PNetwork', peerId: peerId.toString() }, 'Peer disconnected');
        this.peers.delete(peerId.toString());
        this.emit('peer:disconnect', peerId.toString());
    }

    handlePubsubMessage = async ({ detail: { topic, data, from } }) => {
        try {
            //const message = JSON.parse(data.toString());
            //this.emit(topic, message, from);
            const isUint8Array = Object.prototype.toString.call(data) === '[object Uint8Array]';
            const uint8Array = isUint8Array ? data : Buffer.from(JSON.stringify(data));
            this.emit(topic, uint8Array, from);
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Failed to parse pubsub message');
        }
    }


    async stop() {
        if (this.node) {
            // Clear periodic tasks
            if (this.announceIntervalId) {
                clearInterval(this.announceIntervalId);
                this.announceIntervalId = null;
            }
            if (this.cleanupIntervalId) {
                clearInterval(this.cleanupIntervalId);
                this.cleanupIntervalId = null;
            }

            // Stop the libp2p node
            await this.node.stop();
            this.logger.info({ component: 'P2PNetwork' }, `${this.options.role} node stopped`);
        }
    }

    async subscribe(topic, callback) {
        this.logger.debug({ component: 'P2PNetwork', topic }, 'Subscribing to topic');
        try {
            await this.node.services.pubsub.subscribe(topic);
            this.subscriptions.add(topic);
            //if (callback) this.on(topic, callback);
            if (callback) this.on(topic, (message) => callback(topic, message));
            this.logger.debug({ component: 'P2PNetwork', topic, subscriptions: Array.from(this.subscriptions) }, 'Subscribed to topic');
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Failed to subscribe to topic');
            throw error;
        }
    }
    /**
     * @param {string[]} topics
     * @param {Function} callback
     * @returns
     */
    async subscribeMultipleTopics(topics, callback) {
        for (const topic of topics) {
            await this.subscribe(topic, callback);
        }
    }

    async unsubscribe(topic) {
        if (!this.subscriptions.has(topic)) {
            this.logger.debug({ component: 'P2PNetwork', topic }, 'Attempting to unsubscribe from a topic that was not subscribed to');
            return;
        }

        try {
            await this.node.services.pubsub.unsubscribe(topic);
            this.subscriptions.delete(topic);
            this.logger.debug({ component: 'P2PNetwork', topic }, 'Unsubscribed from topic');
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Error unsubscribing from topic');
            throw error;
        }
    }

    async broadcast(topic, message) {
        this.logger.debug({ component: 'P2PNetwork', topic, message }, 'Broadcasting message');
        try {
            // if uint8array, send as is
            //if (message instanceof Uint8Array) {
            const isUint8Array = Object.prototype.toString.call(message) === '[object Uint8Array]';
            //const buffer = isUint8Array ? Buffer.from(message) : Buffer.from(JSON.stringify(message));
            const uint8Array = isUint8Array ? message : Buffer.from(JSON.stringify(message));
            await this.node.services.pubsub.publish(topic, uint8Array);
            this.logger.debug({ component: 'P2PNetwork', topic }, 'Broadcast complete');
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Broadcast error');
            throw error;
        }
    }

    updatePeer(peerId, data) {
        this.peers.set(peerId, { ...data, lastSeen: Date.now(), address: data.address || null });
        this.logger.debug({ component: 'P2PNetwork', peerId, data }, 'Peer updated');
        this.emit('peer:updated', peerId, data);
    }

    cleanupPeers() {
        const now = Date.now();
        for (const [peerId, peerData] of this.peers.entries()) {
            if (now - peerData.lastSeen > this.options.peerTimeout) {
                this.peers.delete(peerId);
                this.emit('peer:removed', peerId);
            }
        }
    }

    getStatus() {
        return {
            isSyncing: false,
            blockHeight: 0,
            version: '1.1.0',
            connectionCount: this.peers.size,
            peerId: this.node.peerId.toString(),
        };
    }

    async announcePeer() {
        try {
            const topic = 'peer:announce';
            await this.subscribe(topic);
            await this.node.services.pubsub.publish(topic, Buffer.from(JSON.stringify({
                peerId: this.node.peerId.toString(),
                status: this.getStatus(),
            })));
            this.logger.debug({ component: 'P2PNetwork' }, 'Peer announced');
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', error: error.message }, 'Failed to announce peer');
        }
    }

    async findPeer(peerId) {
        try {
            return await this.node.peerRouting.findPeer(peerId);
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', peerId, error: error.message }, 'Failed to find peer');
            return null;
        }
    }

    getConnectedPeers() {
        return Array.from(this.peers.keys());
    }

    getSubscribedTopics() {
        return Array.from(this.subscriptions);
    }

    isStarted() {
        return this.node && this.node.status === 'started';
    }

}

export default P2PNetwork;
export { P2PNetwork };