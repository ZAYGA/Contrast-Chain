// src/sync.mjs

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { mplex } from '@libp2p/mplex';
import { lpStream } from 'it-length-prefixed-stream';
import { createLibp2p } from 'libp2p';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';

const SYNC_PROTOCOL = '/blockchain-sync/1.0.0';
const MAX_MESSAGE_SIZE = 20000000; // 20MB
const MAX_BLOCKS_PER_REQUEST = 10000;


export class SyncNode {
    /**
     * Creates a new SyncNode instance.
     * @param {number} port - The port number to listen on.
     */
    constructor(port) {
        this.port = port;
        this.node = null;
        this.mockBlockData = [];
    }

    /**
     * Starts the synchronization node.
     * @returns {Promise<void>}
     */
    async start() {
        this.node = await createLibp2p({
            addresses: {
                listen: [`/ip4/0.0.0.0/tcp/${this.port}`]
            },
            connectionEncryption: [noise()],
            streamMuxers: [mplex()],
            transports: [tcp()],
            services: {
                identify: identify(),
                dht: new kadDHT()
            },
            connectionManager: {
                autoDial: true,
            },
        });

        await this.node.handle(SYNC_PROTOCOL, this.handleIncomingStream.bind(this));
        await this.node.start();
        console.log(`Node started with ID: ${this.node.peerId.toString()}`);
        console.log(`Listening on: ${this.node.getMultiaddrs().map(addr => addr.toString()).join(', ')}`);
    }

    /**
     * Handles incoming streams from peers.
     * @param {Object} param0 - The stream object.
     * @param {import('libp2p').Stream} param0.stream - The libp2p stream.
     * @returns {Promise<void>}
     */
    async handleIncomingStream({ stream }) {
        const lp = lpStream(stream);
        try {
            const req = await lp.read({ maxSize: MAX_MESSAGE_SIZE });
            let message;
            try {
                message = JSON.parse(uint8ArrayToString(req.subarray()));
            } catch (parseError) {
                throw new Error('Malformed JSON: ' + parseError.message);
            }
            console.log('Received message:', message);

            let response;
            switch (message.type) {
                case 'test':
                case 'block':
                    response = { status: 'received', echo: message };
                    break;
                case 'getBlocks':
                    response = this.handleGetBlocks(message);
                    break;
                default:
                    throw new Error('Invalid request type');
            }

            await lp.write(uint8ArrayFromString(JSON.stringify(response)));
        } catch (err) {
            console.error('Error handling incoming stream:', err);
            await lp.write(uint8ArrayFromString(JSON.stringify({ status: 'error', message: err.message })));
        } finally {
            await stream.close();
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
            const stream = await this.node.dialProtocol(peerMultiaddr, SYNC_PROTOCOL);
            const lp = lpStream(stream);

            await lp.write(uint8ArrayFromString(JSON.stringify(message)));
            const res = await lp.read({ maxSize: MAX_MESSAGE_SIZE });
            const response = JSON.parse(uint8ArrayToString(res.subarray()));
            console.log('Received response:', response);
            if (response.status === 'error') {
                throw new Error(response.message);
            }
            return response;
        } catch (err) {
            console.error('Error sending message:', err);
            throw err;
        } finally {
            if (stream) {
                await stream.close().catch(console.error);
            }
        }
    }

    /**
     * Handles the getBlocks request.
     * @param {Object} message - The getBlocks message.
     * @param {number} message.startIndex - The starting block index.
     * @param {number} message.endIndex - The ending block index.
     * @returns {Object} The response containing the requested blocks.
     */
    handleGetBlocks(message) {
        const { startIndex, endIndex } = message;
        if (startIndex > endIndex) {
            throw new Error('Invalid block range');
        }
        const blocks = this.mockBlockData
            .filter(block => block.index >= startIndex && block.index <= endIndex)
            .slice(0, MAX_BLOCKS_PER_REQUEST);
        return { status: 'success', blocks };
    }

    /**
     * Connects to a peer.
     * @param {string} peerMultiaddr - The multiaddress of the peer to connect to.
     * @returns {Promise<void>}
     */
    async connect(peerMultiaddr) {
        console.error(`Connecting to: ${peerMultiaddr}`);
        await this.node.dial(peerMultiaddr);
        console.log(`Connected to: ${peerMultiaddr}`);
    }

    /**
     * Stops the synchronization node.
     * @returns {Promise<void>}
     */
    async stop() {
        if (this.node) {
            await this.node.stop();
            console.log('Node stopped');
        }
    }

    /**
     * Gets the list of connected peers.
     * @returns {Array} An array of connected peers.
     */
    get peers() {
        return this.node.peerStore.all();
    }
}