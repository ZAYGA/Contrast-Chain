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
import utils from './utils.mjs';
import { lpStream } from 'it-length-prefixed-stream';

const SYNC_PROTOCOL = '/blockchain-sync/1.0.0';
const MAX_MESSAGE_SIZE = 20000000;

class P2PNetwork extends EventEmitter {

    constructor(options = {}) {
        super();
        this.options = {
            bootstrapNodes: [

                '/ip4/82.126.155.210/tcp/7777',
            ],
            maxPeers: 50,
            announceInterval: 60000,
            cleanupInterval: 300000,
            peerTimeout: 600000,
            logLevel: 'debug', // 'info',
            logging: true,
            listenAddress: '/ip4/0.0.0.0/tcp/0',
            enableMDNS: true,
            ...options
        };
        this.p2pNode = null; // Libp2pNode
        this.peers = new Map();
        this.subscriptions = new Set();

        this.announceIntervalId = null;
        this.cleanupIntervalId = null;
        this.syncProtocol = SYNC_PROTOCOL;
        this.maxMessageSize = MAX_MESSAGE_SIZE;

        if (!P2PNetwork.logger) { P2PNetwork.logger = P2PNetwork.initLogger(this.options); }
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

    async stop() {
        if (this.p2pNode) {
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
            await this.p2pNode.stop();
            this.logger.info({ component: 'P2PNetwork' }, `${this.options.role} node stopped`);
        }
    }
    async #createLibp2pNode() {
        const peerDiscovery = [];

        if (this.options.bootstrapNodes.length > 0) {
            peerDiscovery.push(bootstrap({ list: this.options.bootstrapNodes }));
        }

        let mdnsConfig = null;
        if (this.options.enableMDNS) {
            try {
                mdnsConfig = mdns();
                peerDiscovery.push(mdnsConfig);
            } catch (error) {
                this.logger.warn({ component: 'P2PNetwork', error: error.message }, 'Failed to initialize mDNS, continuing without it');
            }
        }
        const libp2p = createLibp2p({
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
                autoDial: false,
            },
        });

        // resolve promise when libp2p is ready


        return await libp2p;

    }

    async #connectToNetwork() {
        let connected = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!connected && attempts < maxAttempts) {
            attempts++;
            this.logger.info({ component: 'P2PNetwork', attempt: attempts }, 'Attempting to connect to network');

            // Try connecting to bootstrap nodes
            if (this.options.bootstrapNodes.length > 0) {
                this.logger.info({ component: 'P2PNetwork' }, 'Attempting to connect to bootstrap nodes');
                connected = await this.#connectToBootstrapNodes();
            }

            // If not connected, try local network discovery (mDNS)
            if (!connected && this.options.enableMDNS) {
                this.logger.info({ component: 'P2PNetwork' }, 'Attempting to discover local peers via mDNS');
                connected = await this.#discoverLocalPeers();
            }

            // If still not connected, try DHT
            if (!connected) {
                this.logger.info({ component: 'P2PNetwork' }, 'Attempting to discover peers via DHT');
                connected = await this.#discoverPeersViaDHT();
            }

            if (!connected) {
                this.logger.warn({ component: 'P2PNetwork', attempt: attempts }, 'Failed to connect to any peers. Retrying...');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
            }
        }

        if (!connected) {
            this.logger.warn({ component: 'P2PNetwork' }, 'Failed to connect to any peers after multiple attempts. Node may be isolated.');
        } else {
            this.logger.info({ component: 'P2PNetwork' }, 'Successfully connected to the network');
            try {
                await this.p2pNode.services.dht.put(this.p2pNode.peerId.toBytes(), this.p2pNode.peerId.toBytes());
                this.logger.info({ component: 'P2PNetwork' }, 'Successfully put peer ID in DHT');
            } catch (error) {
                this.logger.error({ component: 'P2PNetwork', error: error.message }, 'Failed to put peer ID in DHT');
            }
        }
    }
    async #connectToBootstrapNodes() {
        let connected = false;
        for (const addr of this.options.bootstrapNodes) {
            try {
                const ma = multiaddr(addr);
                this.logger.info({ component: 'P2PNetwork', bootstrapNode: addr }, 'Attempting to connect to bootstrap node');
                await this.p2pNode.dial(ma);
                this.logger.info({ component: 'P2PNetwork', bootstrapNode: addr }, 'Connected to bootstrap node');
                connected = true;
                break;  // Successfully connected to a bootstrap node
            } catch (err) {
                this.logger.error({ component: 'P2PNetwork', bootstrapNode: addr, error: err.message }, 'Failed to connect to bootstrap node');
            }
        }

        if (!connected) {
            this.logger.warn({ component: 'P2PNetwork' }, 'Failed to connect to any bootstrap nodes');
        }

        return connected;
    }
    async #discoverLocalPeers() {
        return new Promise((resolve) => {
            let connected = false;
            const timeout = setTimeout(() => {
                this.logger.info({ component: 'P2PNetwork' }, 'Local peer discovery timed out');
                resolve(connected);
            }, 30000);  // 30 seconds timeout

            const handleDiscovery = async (evt) => {
                if (connected) return;
                try {
                    this.logger.info({ component: 'P2PNetwork', peerId: evt.detail.id.toString() }, 'Discovered local peer, attempting to connect');
                    await this.p2pNode.dial(evt.detail.id);
                    this.logger.info({ component: 'P2PNetwork', peerId: evt.detail.id.toString() }, 'Connected to peer via mDNS');
                    this.updatePeer(evt.detail.id.toString(), { status: 'connected' });
                    connected = true;
                    clearTimeout(timeout);
                    resolve(true);
                } catch (err) {
                    this.logger.error({ component: 'P2PNetwork', peerId: evt.detail.id.toString(), error: err.message }, 'Failed to connect to mDNS peer');
                }
            };

            // Add the event listener
            this.p2pNode.addEventListener('peer:discovery', handleDiscovery);

            // Optionally, we can manually trigger the mDNS discovery
            // this.p2pNode.services.mdns.query();

            this.logger.info({ component: 'P2PNetwork' }, 'Started listening for mDNS peer discovery events');
        });
    }

    async #discoverPeersViaDHT() {
        this.logger.info({ component: 'P2PNetwork' }, 'Trying DHT for peer discovery');
        try {
            await this.p2pNode.services.dht.start();
            const peers = await this.p2pNode.services.dht.getClosestPeers(this.p2pNode.peerId.toBytes());

            for await (const peer of peers) {
                try {
                    this.logger.info({ component: 'P2PNetwork', peerId: peer.toString() }, 'Discovered peer via DHT, attempting to connect');
                    await this.p2pNode.dial(peer);
                    this.logger.info({ component: 'P2PNetwork', peerId: peer.toString() }, 'Connected to peer via DHT');
                    return true;
                } catch (err) {
                    this.logger.error({ component: 'P2PNetwork', peerId: peer.toString(), error: err.message }, 'Failed to connect to DHT peer');
                }
            }
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', error: error.message }, 'Failed to use DHT for peer discovery');
        }
        return false;
    }


    async start() {
        try {
            this.p2pNode = await this.#createLibp2pNode();
            await this.p2pNode.start();
            this.logger.debug({ component: 'P2PNetwork', peerId: this.p2pNode.peerId.toString() }, `${this.options.role} node started`);

            await this.#connectToNetwork();
            this.#setupEventListeners();
            this.#startPeriodicTasks();
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', error: error.message }, 'Failed to start P2P network');
            throw error;
        }
    }

    #setupEventListeners() {
        this.p2pNode.addEventListener('peer:connect', this.#handlePeerConnect.bind(this));
        this.p2pNode.addEventListener('peer:disconnect', this.#handlePeerDisconnect.bind(this));
        this.p2pNode.services.pubsub.addEventListener('message', this.#handlePubsubMessage.bind(this));
    }
    #handlePeerConnect = ({ detail: peerId }) => {
        this.logger.debug({ component: 'P2PNetwork', peerId: peerId.toString() }, 'Peer connected');
        this.updatePeer(peerId.toString(), { status: 'connected' });
        this.emit('peer:connect', peerId.toString());
    }
    #handlePeerDisconnect = ({ detail: peerId }) => {
        this.logger.debug({ component: 'P2PNetwork', peerId: peerId.toString() }, 'Peer disconnected');
        this.peers.delete(peerId.toString());
        this.emit('peer:disconnect', peerId.toString());
    }
    /**
     * @param {Object} detail
     * @param {string} detail.topic
     * @param {Uint8Array} detail.data
     * @param {PeerId} detail.from
     */
    #handlePubsubMessage = async ({ detail: { topic, data, from } }) => { // TODO: optimize this by using specific compression serialization
        try {
            const parsedMessage = utils.compression.msgpack_Zlib.rawData.fromBinary_v1(data);
            this.emit(topic, parsedMessage, from);
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Failed to parse pubsub message');
        }
    }
    #startPeriodicTasks() {
        //this.announceIntervalId = setInterval(() => this.announcePeer(), this.options.announceInterval);
        //this.cleanupIntervalId = setInterval(() => this.cleanupPeers(), this.options.cleanupInterval);
    }

    /**
     * @param {string} topic
     * @param {any} message - Can be any JavaScript object
     */
    async broadcast(topic, message) {
        this.logger.debug({ component: 'P2PNetwork', topic }, 'Broadcasting message');
        try {
            const serialized = utils.compression.msgpack_Zlib.rawData.toBinary_v1(message);
            await this.p2pNode.services.pubsub.publish(topic, serialized);
            this.logger.debug({ component: 'P2PNetwork', topic }, 'Broadcast complete');
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Broadcast error');
            throw error;
        }
    }
    /**
     * Sends a message to a peer.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @param {Object} message - The message to send.
     * @returns {Promise<Object>} The response from the peer.
     */
    async sendMessage(peerMultiaddr, message) {
        let stream;
        try {
            stream = await this.p2pNode.dialProtocol(peerMultiaddr, SYNC_PROTOCOL);
            const lp = lpStream(stream);
            const serialized = utils.compression.msgpack_Zlib.rawData.toBinary_v1(message);

            await lp.write(serialized);
            const res = await lp.read({ maxSize: MAX_MESSAGE_SIZE });
            const response = utils.compression.msgpack_Zlib.rawData.fromBinary_v1(res.subarray());
            // console.log('Received response:', response);
            if (response.status === 'error') { throw new Error(response.message); }
            return response;
        } catch (err) {
            console.error('Error sending message:' + SYNC_PROTOCOL, err);
            throw err;
        } finally {
            if (stream && stream.status === 'closed') { return; }
            await stream.close().catch(console.error);
        }
    }
    /**
     * @param {string} topic
     * @param {Function} callback
     */
    async subscribe(topic, callback) {
        this.logger.debug({ component: 'P2PNetwork', topic }, 'Subscribing to topic');
        try {
            await this.p2pNode.services.pubsub.subscribe(topic);
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
     */
    async subscribeMultipleTopics(topics, callback) {
        for (const topic of topics) {
            await this.subscribe(topic, callback);
        }
    }
    /** @param {string} topic */
    async unsubscribe(topic) {
        if (!this.subscriptions.has(topic)) {
            this.logger.debug({ component: 'P2PNetwork', topic }, 'Attempting to unsubscribe from a topic that was not subscribed to');
            return;
        }

        try {
            await this.p2pNode.services.pubsub.unsubscribe(topic);
            this.subscriptions.delete(topic);
            this.logger.debug({ component: 'P2PNetwork', topic }, 'Unsubscribed from topic');
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Error unsubscribing from topic');
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
            peerId: this.p2pNode.peerId.toString(),
        };
    }
    async announcePeer() {
        try {
            const topic = 'peer:announce';
            await this.subscribe(topic);
            const data = { peerId: this.p2pNode.peerId.toString(), status: this.getStatus() };
            //  await this.broadcast(topic, data);
            this.logger.debug({ component: 'P2PNetwork' }, 'Peer announced');
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', error: error.message }, 'Failed to announce peer');
        }
    }
    async findPeer(peerId) {
        try {
            return await this.p2pNode.peerRouting.findPeer(peerId);
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
        return this.p2pNode && this.p2pNode.status === 'started';
    }
}

export default P2PNetwork;
export { P2PNetwork };