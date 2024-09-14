import { lpStream } from 'it-length-prefixed-stream';
import pino from 'pino';
import utils from './utils.mjs';
import { UtxoCache } from './utxoCache.mjs';

/**
* @typedef {import("./p2p.mjs").P2PNetwork} P2PNetwork
* @typedef {import("./blockchain.mjs").Blockchain} Blockchain
*/

const MAX_BLOCKS_PER_REQUEST = 10000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

export class SyncHandler {
    /** @type {Blockchain} */
    constructor(blockchain) {
        this.p2pNetworkMaxMessageSize = 0;
        /** @type {Blockchain} */
        this.blockchain = blockchain;
        this.logger = pino({
            level: process.env.LOG_LEVEL || 'info',
            transport: {
                target: 'pino-pretty'
            }
        });
    }

    /** @param {P2PNetwork} p2pNetwork */
    async start(p2pNetwork) {
        try {
            this.p2pNetworkMaxMessageSize = p2pNetwork.maxMessageSize;
            p2pNetwork.p2pNode.handle(p2pNetwork.syncProtocol, this.handleIncomingStream.bind(this));
            this.logger.info({ protocol: p2pNetwork.syncProtocol }, 'Sync node started');
        } catch (error) {
            this.logger.error({ error: error.message }, 'Failed to start sync node');
            throw error;
        }
    }
    async stop() {
        this.logger.info('Sync node stopped');
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
            const req = await lp.read({ maxSize: this.p2pNetworkMaxMessageSize });
            const message = utils.serializer.rawData.fromBinary_v1(req.subarray());
            const response = await this.#handleMessage(message);
            await lp.write(utils.serializer.rawData.toBinary_v1(response));
        } catch (err) {
            this.logger.error({ error: err.message }, 'Error handling incoming stream');
            await lp.write(utils.serializer.rawData.toBinary_v1({ status: 'error', message: err.message }));
        } finally {
            await stream.close();
            //console.log('Stream closed');
        }
    }
    /**
     * Handles incoming messages based on their type.
     * @param {Object} message - The incoming message.
     * @returns {Promise<Object>} The response to the message.
     */
    async #handleMessage(message) {
        switch (message.type) {
            case 'getBlocks':
                return await this.#handleGetBlocks(message);
            case 'getStatus':
                return {
                    status: 'success',
                    currentHeight: this.blockchain.currentHeight,
                    latestBlockHash: this.blockchain.getLatestBlockHash()
                };
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
    async #handleGetBlocks(message) {
        this.logger.debug(message, 'Received getBlocks request');
        const { startIndex, endIndex } = message;
        if (startIndex > endIndex) { throw new Error('Invalid block range'); }

        const blocks = await this.#getBlocks(startIndex, endIndex);
        this.logger.debug({ count: blocks.length }, 'Sending blocks in response');
        return { status: 'success', blocks };
    }
    /**
     * Gets blocks within a specified range.
     * @param {number} startIndex - The starting block index.
     * @param {number} endIndex - The ending block index.
     * @returns {Promise<Array>} An array of blocks.
     */
    async #getBlocks(startIndex, endIndex) {
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
     * Synchronizes missing blocks from a peer.
     * @param {UtxoCache} utxoCache - The UTXO cache instance.
     * @param {string} peerMultiaddr - The multiaddress of the peer to sync with.
     * @returns {Promise<void>}
     */
    async getMissingBlocks(p2pNetwork, peerMultiaddr) {
        try {
            const peerStatus = await this.#getPeerStatus(p2pNetwork, peerMultiaddr);
            const currentHeight = Math.max(this.blockchain.currentHeight + 1, 0);
            if (currentHeight >= peerStatus.currentHeight) { this.logger.debug('No sync needed'); return; }

            const endIndex = Math.min(currentHeight + MAX_BLOCKS_PER_REQUEST - 1, peerStatus.currentHeight);
            const blocks = await this.#requestBlocksFromPeer(p2pNetwork, peerMultiaddr, currentHeight, endIndex);
            this.logger.info('Sync => successfully fetch blocks from peer');
            return blocks;

            //await this.syncBlocksFromPeer(utxoCache, peerMultiaddr, peerStatus.currentHeight); => FUNCTION DELETED
            //await this.addBlocksToChain(utxoCache, blocks); => FUNCTION DELETED
            //await this.blockchain.addConfirmedBlocks(utxoCache, blocks);

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
    async #getPeerStatus(p2pNetwork, peerMultiaddr) {
        const peerStatusMessage = { type: 'getStatus' };
        return await this.#retryOperation(() => p2pNetwork.sendMessage(peerMultiaddr, peerStatusMessage));
    }
    /**
     * Requests blocks from a peer.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @param {number} startIndex - The starting block index.
     * @param {number} endIndex - The ending block index.
     * @returns {Promise<Array>} An array of blocks.
     */
    async #requestBlocksFromPeer(p2pNetwork, peerMultiaddr, startIndex, endIndex) {
        const message = { type: 'getBlocks', startIndex, endIndex };
        this.logger.debug({ startIndex, endIndex }, 'Requesting blocks');
        const response = await this.#retryOperation(() => p2pNetwork.sendMessage(peerMultiaddr, message));
        return response.status === 'success' ? response.blocks : [];
    }

    /**
     * Retries an operation with exponential backoff.
     * @param {Function} operation - The operation to retry.
     * @returns {Promise<any>} The result of the operation.
     */
    async #retryOperation(operation) {
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