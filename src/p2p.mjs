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
import { lpStream } from 'it-length-prefixed-stream';
import utils from './utils.mjs';

class P2PNetwork extends EventEmitter {
    /** @type {string} */
    static SYNC_PROTOCOL = '/blockchain-sync/1.0.0';

    /** @type {number} */
    static MAX_MESSAGE_SIZE = 2000000000000000;

    /** @type {pino.Logger} */
    static logger = null;

    /**
     * @param {Object} [options={}]
     */
    constructor(options = {}) {
        super();

        const defaultOptions = {
            bootstrapNodes: [
                '/ip4/82.126.155.210/tcp/7777',
                '/dns4/pinkparrot.science/tcp/7777',
            ],
            maxPeers: 50,
            announceInterval: 60000,
            cleanupInterval: 300000,
            peerTimeout: 600000,
            logLevel: 'silent',
            logging: true,
            listenAddress: '/ip4/0.0.0.0/tcp/7777',
        };

        this.options = { ...defaultOptions, ...options };

        this.p2pNode = null;
        this.peers = new Map();
        this.subscriptions = new Set();

        this.syncProtocol = P2PNetwork.SYNC_PROTOCOL;
        this.maxMessageSize = P2PNetwork.MAX_MESSAGE_SIZE;

        if (!P2PNetwork.logger) {
            P2PNetwork.logger = this.#initLogger();
        }
        this.logger = P2PNetwork.logger;
    }

    /**
     * @returns {pino.Logger}
     */
    #initLogger() {
        return pino({
            level: this.options.logLevel,
            enabled: this.options.logging,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                    messageFormat: '{component} - {msg}',
                },
            },
        });
    }

    async start() {
        try {
            this.p2pNode = await this.#createLibp2pNode();
            await this.p2pNode.start();

            this.logger.debug({ component: 'P2PNetwork', peerId: this.p2pNode.peerId.toString() },);

            this.#setupEventListeners();
            await this.#connectToBootstrapNodes();
        } catch (error) {
            this.logger.error(
                { component: 'P2PNetwork', error: error.message }, 'Failed to start P2P network');
            throw error;
        }
    }
    async stop() {
        if (this.p2pNode) {
            await this.p2pNode.stop();
            this.logger.info({ component: 'P2PNetwork', peerId: this.p2pNode.peerId.toString() }, 'P2P network stopped');
        }
    }

    /**
     * @returns {Promise<Libp2p>}
     */
    async #createLibp2pNode() {
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
                dht: kadDHT(),
            },
            peerDiscovery,
            connectionManager: {
                autoDial: true,
            },
        });
    }

    async #connectToBootstrapNodes() {
        for (const addr of this.options.bootstrapNodes) {
            try {
                const ma = multiaddr(addr);
                await this.p2pNode.dial(ma);
                this.logger.info({ component: 'P2PNetwork', bootstrapNode: addr }, 'Connected to bootstrap node'
                );
            } catch (err) {
                this.logger.error({ component: 'P2PNetwork', bootstrapNode: addr, error: err.message }, 'Failed to connect to bootstrap node');
            }
        }
    }

    #setupEventListeners() {
        this.p2pNode.addEventListener('peer:connect', this.#handlePeerConnect);
        this.p2pNode.addEventListener('peer:disconnect', this.#handlePeerDisconnect);
        this.p2pNode.services.pubsub.addEventListener('message', this.#handlePubsubMessage);
    }

    /**
     * @param {CustomEvent} event
     */
    #handlePeerConnect = (event) => {
        const peerId = event.detail.toString();
        this.logger.debug({ component: 'P2PNetwork', peerId }, 'Peer connected');
        this.updatePeer(peerId, { status: 'connected' });
    };
    /**
     * @param {CustomEvent} event
     */
    #handlePeerDisconnect = (event) => {
        const peerId = event.detail.toString();
        this.logger.debug({ component: 'P2PNetwork', peerId }, 'Peer disconnected');
        this.peers.delete(peerId);
    };

    /**
     * @param {CustomEvent} event
     */
    #handlePubsubMessage = async (event) => {
        const { topic, data, from } = event.detail;
        try {
            let parsedMessage;
            switch (topic) {
                case 'new_transaction':
                    parsedMessage = utils.serializer.transaction.fromBinary_v2(data);
                    break;
                case 'new_block_candidate':
                    parsedMessage = utils.serializer.block_candidate.fromBinary_v2(data);
                    break;
                case 'new_block_finalized':
                    parsedMessage = utils.serializer.block_finalized.fromBinary_v2(data);
                    break;
                default:
                    parsedMessage = utils.serializer.rawData.fromBinary_v1(data);
                    break;
            }

            this.emit(topic, parsedMessage, from);
        } catch (error) {
            console.error('Failed to parse pubsub message:', error);
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Failed to parse pubsub message');
        }
    }

    /**
     * @param {string} topic
     * @param {any} message - Can be any JavaScript object
     */
    async broadcast(topic, message) {
        this.logger.debug({ component: 'P2PNetwork', topic }, 'Broadcasting message');
        try {
            const readableNow = `${new Date().toLocaleTimeString()}:${new Date().getMilliseconds()}`;
            let serialized;
            switch (topic) {
                case 'new_transaction':
                    serialized = utils.serializer.transaction.toBinary_v2(message);
                    break;
                case 'new_block_candidate':
                    serialized = utils.serializer.block_candidate.toBinary_v2(message);
                    break;
                case 'new_block_finalized':
                    serialized = utils.serializer.block_finalized.toBinary_v2(message);
                    break;
                default:
                    serialized = utils.serializer.rawData.toBinary_v1(message);
                    break;
            }

            await this.p2pNode.services.pubsub.publish(topic, serialized);
            this.logger.debug({ component: 'P2PNetwork', topic }, 'Broadcast complete');
        } catch (error) {
            console.error('Broadcast error:', error);
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Broadcast error');
        }
    }
    /**
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @param {Object} message - The message to send.
     * @returns {Promise<Object>} The response from the peer.
     */
    async sendMessage(peerMultiaddr, message) {
        let stream;
        try {
            // Dial the peer
            stream = await this.p2pNode.dialProtocol(peerMultiaddr, this.syncProtocol);
            const lp = lpStream(stream);
            const serialized = utils.serializer.rawData.toBinary_v1(message);

            // Write the message to the stream
            await lp.write(serialized);
            const res = await lp.read({ maxSize: MAX_MESSAGE_SIZE });
            const response = utils.serializer.rawData.fromBinary_v1(res.subarray());
            // console.log('Received response:', response);
            if (response.status === 'error') { throw new Error(response.message); }
            return response;
        } catch (err) {
            this.logger.error(
                { component: 'P2PNetwork', protocol: this.syncProtocol, error: err.message },
                'Error sending message'
            );
            throw err;
        } finally {
            // Ensure the stream is properly closed
            if (stream && !stream.closed) {
                await stream.close().catch(console.error);
            }
        }
    }


    /**
     * @param {string} topic
     * @param {Function} [callback]
     */
    async subscribe(topic, callback) {
        this.logger.debug({ component: 'P2PNetwork', topic }, 'Subscribing to topic');
        try {
            await this.p2pNode.services.pubsub.subscribe(topic);
            this.subscriptions.add(topic);
            if (callback) {
                this.on(topic, (message) => callback(topic, message));
            }
            this.logger.debug({ component: 'P2PNetwork', topic, subscriptions: Array.from(this.subscriptions) }, 'Subscribed to topic'
            );
        } catch (error) {
            this.logger.error({ component: 'P2PNetwork', topic, error: error.message }, 'Failed to subscribe to topic'
            );
            throw error;
        }
    }
    /**
     * @param {string[]} topics
     * @param {Function} [callback]
     */
    async subscribeMultipleTopics(topics, callback) {
        await Promise.all(topics.map((topic) => this.subscribe(topic, callback)));
    }
    /**
     * @param {string} topic
     */
    async unsubscribe(topic) {
        if (!this.subscriptions.has(topic)) {
            this.logger.debug(
                { component: 'P2PNetwork', topic },
                'Attempting to unsubscribe from a topic that was not subscribed to'
            );
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

    /**
     * @param {string} peerId
     * @param {Object} data
     */
    updatePeer(peerId, data) {
        this.peers.set(peerId, {
            ...data,
            lastSeen: Date.now(),
            address: data.address || null,
        });
        this.logger.debug({ component: 'P2PNetwork', peerId, data }, 'Peer updated');
        this.emit('peer:updated', peerId, data);
    }


    /**
     * @returns {Object}
     */
    getStatus() {
        return {
            isSyncing: false,
            blockHeight: 0,
            version: '1.1.0',
            connectionCount: this.peers.size,
            peerId: this.p2pNode.peerId.toString(),
        };
    }
    /**
     * @returns {string[]}
     */
    getConnectedPeers() {
        return Array.from(this.peers.keys());
    }
    /**
     * @returns {string[]}
     */
    getSubscribedTopics() {
        return Array.from(this.subscriptions);
    }
    /**
     * @returns {boolean}
     */
    isStarted() {
        return this.p2pNode && this.p2pNode.status === 'started';
    }
}

export default P2PNetwork;
export { P2PNetwork };
