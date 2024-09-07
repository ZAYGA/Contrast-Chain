import { lpStream } from 'it-length-prefixed-stream';
import pino from 'pino';
import utils from './utils.mjs';

const MAX_BLOCKS_PER_REQUEST = 10000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

export class SyncNode {
    /**
     * Creates a new SyncNode instance.
     * @param {import('libp2p')} p2p - The libp2p instance.
     * @param {import('./blockchain.mjs').Blockchain} blockchain - The blockchain instance.
     */
    constructor(p2p, blockchain) {
        this.node = null;
        this.p2p = p2p;
        this.blockchain = blockchain;
        this.logger = pino({
            level: process.env.LOG_LEVEL || 'info',
            transport: {
                target: 'pino-pretty'
            }
        });
    }

    /**
     * Starts the synchronization node.
     * @returns {Promise<void>}
     */
    async start() {
        try {
            this.node = this.p2p.node;
            this.node.handle(this.p2p.syncProtocol, this.handleIncomingStream.bind(this));
            this.logger.info({ protocol: this.p2p.syncProtocol }, 'Sync node started');
        } catch (error) {
            this.logger.error({ error: error.message }, 'Failed to start sync node');
            throw error;
        }
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
            const req = await lp.read({ maxSize: this.p2p.maxMessageSize });
            const message = utils.compression.msgpack_Zlib.rawData.fromBinary_v1(req.subarray());
            const response = await this.handleMessage(message);
            await lp.write(utils.compression.msgpack_Zlib.rawData.toBinary_v1(response));
        } catch (err) {
            this.logger.error({ error: err.message }, 'Error handling incoming stream');
            await lp.write(utils.compression.msgpack_Zlib.rawData.toBinary_v1({ status: 'error', message: err.message }));
        } finally {
            await stream.close();
        }
    }

    /**
     * Handles incoming messages based on their type.
     * @param {Object} message - The incoming message.
     * @returns {Promise<Object>} The response to the message.
     */
    async handleMessage(message) {
        switch (message.type) {
            case 'getBlocks':
                return await this.handleGetBlocks(message);
            case 'getStatus':
                return this.handleGetStatus();
            case 'test':
                return message;
            case 'block':
                return { status: 'received', echo: message };
            default:
                this.logger.warn({ type: message.type }, 'Invalid request type');
                throw new Error('Invalid request type');
        }
    }
    /**
     * Handles the getBlocks request.
     * @param {Object} message - The getBlocks message.
     * @returns {Promise<Object>} The response containing the requested blocks.
     */
    async handleGetBlocks(message) {
        this.logger.debug(message, 'Received getBlocks request');
        const { startIndex, endIndex } = message;
        if (startIndex > endIndex) { throw new Error('Invalid block range'); }

        const blocks = await this.getBlocksInRange(startIndex, endIndex);
        this.logger.debug({ count: blocks.length }, 'Sending blocks in response');
        return { status: 'success', blocks };
    }    
    /**
     * Handles the getStatus request.
     * @returns {Object} The current status of the blockchain.
     */
    handleGetStatus() {
        return {
            status: 'success',
            currentHeight: this.blockchain.currentHeight,
            latestBlockHash: this.blockchain.getLatestBlockHash()
        };
    }

    /**
     * Synchronizes missing blocks from a peer.
     * @param {string} peerMultiaddr - The multiaddress of the peer to sync with.
     * @returns {Promise<void>}
     */
    async syncMissingBlocks(peerMultiaddr) {
        try {
            const peerStatus = await this.getPeerStatus(peerMultiaddr);
            if (peerStatus.currentHeight <= this.blockchain.currentHeight) { this.logger.debug('No sync needed'); return; }

            await this.syncBlocksFromPeer(peerMultiaddr, peerStatus.currentHeight);
            this.logger.info('Sync completed successfully');
        } catch (error) {
            this.logger.error({ error: error.message }, 'Error during sync');
            throw error;
        }
    }

    /**
     * Gets the status of a peer.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @returns {Promise<Object>} The peer's status.
     */
    async getPeerStatus(peerMultiaddr) {
        const peerStatusMessage = { type: 'getStatus' };
        return await this.retryOperation(() => this.p2p.sendMessage(peerMultiaddr, peerStatusMessage));
    }

    /**
     * Synchronizes blocks from a peer.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @param {number} peerHeight - The height of the peer's blockchain.
     * @returns {Promise<void>}
     */
    async syncBlocksFromPeer(peerMultiaddr, peerHeight) {
        let currentHeight = Math.max(this.blockchain.currentHeight + 1, 0);
        while (currentHeight <= peerHeight) {
            const endIndex = Math.min(currentHeight + MAX_BLOCKS_PER_REQUEST - 1, peerHeight);
            const blocks = await this.requestBlocksFromPeer(peerMultiaddr, currentHeight, endIndex);
            if (blocks.length === 0) break;

            await this.addBlocksToChain(blocks);
            currentHeight = endIndex + 1;
        }
    }
    /**
     * Requests blocks from a peer.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @param {number} startIndex - The starting block index.
     * @param {number} endIndex - The ending block index.
     * @returns {Promise<Array>} An array of blocks.
     */
    async requestBlocksFromPeer(peerMultiaddr, startIndex, endIndex) {
        const message = { type: 'getBlocks', startIndex, endIndex };
        this.logger.debug({ startIndex, endIndex }, 'Requesting blocks');
        const response = await this.retryOperation(() => this.p2p.sendMessage(peerMultiaddr, message));
        return response.status === 'success' ? response.blocks : [];
    }
    /**
     * Adds blocks to the blockchain.
     * @param {Array} blocks - The blocks to add.
     * @returns {Promise<void>}
     */
    async addBlocksToChain(blocks) {
        for (const block of blocks) {
            try {
                await this.blockchain.addConfirmedBlock(block);
                this.logger.debug({ height: block.index }, 'Added block');
            } catch (error) {
                this.logger.error({ height: block.index, error: error.message }, 'Failed to add block');
                throw error;
            }
        }
    }

    /**
     * Gets blocks within a specified range.
     * @param {number} startIndex - The starting block index.
     * @param {number} endIndex - The ending block index.
     * @returns {Promise<Array>} An array of blocks.
     */
    async getBlocksInRange(startIndex, endIndex) {
        const blocks = [];
        for (let i = startIndex; i <= endIndex && i <= this.blockchain.currentHeight; i++) {
            const block = await this.blockchain.getBlockByIndex(i);
            if (block) {
                blocks.push(block);
            } else {
                this.logger.warn({ height: i }, 'Block not found');
                break;
            }
        }
        return blocks;
    }

    /**
     * Connects to a peer.
     * @param {string} peerMultiaddr - The multiaddress of the peer to connect to.
     * @returns {Promise<void>}
     */
    async connect(peerMultiaddr) {
        try {
            await this.node.dial(peerMultiaddr);
            this.logger.info({ peerMultiaddr }, 'Connected to peer');
        } catch (error) {
            this.logger.error({ peerMultiaddr, error: error.message }, 'Failed to connect to peer');
            throw error;
        }
    }

    /**
     * Retries an operation with exponential backoff.
     * @param {Function} operation - The operation to retry.
     * @returns {Promise<any>} The result of the operation.
     */
    async retryOperation(operation) {
        for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
            try {
                return await operation();
            } catch (error) {
                if (attempt === RETRY_ATTEMPTS) throw error;
                this.logger.warn({ attempt, error: error.message }, 'Operation failed, retrying');
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
            }
        }
    }
}