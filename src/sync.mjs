import { lpStream } from 'it-length-prefixed-stream';
import pino from 'pino';
import utils from './utils.mjs';
import P2PNetwork from './p2p.mjs';

/**
 * @typedef {import("./p2p.mjs").P2PNetwork} P2PNetwork
 * @typedef {import("./blockchain.mjs").Blockchain} Blockchain
 */

const MAX_BLOCKS_PER_REQUEST = 2000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000; // 1 second
const BATCH_SIZE = 100; // For batch processing

export class SyncHandler {
    /**
     * @param {Blockchain} blockchain - The blockchain instance.
     */
    constructor(blockchain) {
        this.blockchain = blockchain;
        this.p2pNetworkMaxMessageSize = 0;
        this.logger = pino({
            level: process.env.LOG_LEVEL || 'info',
            transport: {
                target: 'pino-pretty',
            },
        });
    }

    /**
     * Starts the sync handler.
     * @param {P2PNetwork} p2pNetwork - The P2P network instance.
     */
    async start(p2pNetwork) {
        this.p2pNetworkMaxMessageSize = p2pNetwork.maxMessageSize;
        try {
            p2pNetwork.p2pNode.handle(P2PNetwork.SYNC_PROTOCOL, this.handleIncomingStream.bind(this));
            this.logger.info({ protocol: P2PNetwork.SYNC_PROTOCOL }, 'Sync node started');
        } catch (error) {
            this.logger.error({ error: error.message }, 'Failed to start sync node');
            throw error;
        }
    }

    /**
     * Stops the sync handler.
     */
    async stop() {
        // Implement any necessary cleanup here if required
        this.logger.info('Sync node stopped');
    }

    /**
     * Handles incoming streams from peers.
     * @param {Object} param0 - The stream object.
     * @param {import('libp2p').Stream} param0.stream - The libp2p stream.
     */
    async handleIncomingStream({ stream }) {
        const lp = lpStream(stream);
        try {
            const req = await lp.read({ maxSize: this.p2pNetworkMaxMessageSize });
            const message = utils.serializer.rawData.fromBinary_v1(req.subarray());

            if (!message || typeof message.type !== 'string') {
                throw new Error('Invalid message format');
            }

            const response = await this.#handleMessage(message);
            await lp.write(utils.serializer.rawData.toBinary_v1(response));
        } catch (err) {
            this.logger.error({ error: err.message }, 'Error handling incoming stream');
            try {
                await lp.write(utils.serializer.rawData.toBinary_v1({ status: 'error', message: err.message }));
            } catch (writeErr) {
                this.logger.error({ error: writeErr.message }, 'Failed to send error response');
            }
        } finally {
            try {
                await stream.close();
            } catch (closeErr) {
                this.logger.error({ error: closeErr.message }, 'Failed to close stream');
            }
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
                    latestBlockHash: this.blockchain.getLatestBlockHash(),
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

        if (
            typeof startIndex !== 'number' ||
            typeof endIndex !== 'number' ||
            startIndex > endIndex ||
            startIndex < 0
        ) {
            throw new Error('Invalid block range');
        }

        const blocks = await this.#getBlocks(startIndex, endIndex);
        this.logger.debug({ count: blocks.length }, 'Sending blocks in response');
        return { status: 'success', blocks };
    }

    /**
     * Gets blocks within a specified range efficiently.
     * @param {number} startIndex - The starting block index.
     * @param {number} endIndex - The ending block index.
     * @returns {Promise<Array>} An array of blocks.
     */
    async #getBlocks(startIndex, endIndex) {
        const maxIndex = Math.min(endIndex, this.blockchain.currentHeight);
        if (startIndex > maxIndex) {
            return [];
        }

        if (typeof this.blockchain.getBlocksByRange === 'function') {
            // Efficient bulk fetch if supported
            return await this.blockchain.getBlocksByRange(startIndex, maxIndex);
        } else {
            // Fallback to batch processing
            const blocks = [];
            for (let i = startIndex; i <= maxIndex; i += BATCH_SIZE) {
                const batchEnd = Math.min(i + BATCH_SIZE - 1, maxIndex);
                const batchIndices = Array.from({ length: batchEnd - i + 1 }, (_, idx) => i + idx);

                const batchBlocks = await Promise.all(
                    batchIndices.map(async (index) => {
                        try {
                            const block = await this.blockchain.getBlockByIndex(index);
                            if (!block) {
                                this.logger.warn({ height: index }, 'Block not found');
                            }
                            return block;
                        } catch (error) {
                            this.logger.error({ height: index, error: error.message }, 'Error fetching block');
                            return null;
                        }
                    })
                );
                blocks.push(...batchBlocks.filter(Boolean));
            }
            return blocks;
        }
    }

    /**
     * Synchronizes missing blocks from a peer efficiently.
     * @param {P2PNetwork} p2pNetwork - The P2P network instance.
     * @param {string} peerMultiaddr - The multiaddress of the peer to sync with.
     * @param {Function} processBlock - Callback to process each block.
     */
    async getMissingBlocks(p2pNetwork, peerMultiaddr, processBlock) {
        try {
            let peerStatus = await this.#getPeerStatus(p2pNetwork, peerMultiaddr);

            if (!peerStatus || peerStatus.status !== 'success') {
                throw new Error('Failed to get peer status');
            }

            let currentHeight = this.blockchain.currentHeight + 1;

            if (currentHeight > peerStatus.currentHeight) {
                this.logger.info('No sync needed, local blockchain is up-to-date');
                return;
            }

            this.logger.info(
                { peerHeight: peerStatus.currentHeight },
                'Starting block synchronization from peer'
            );

            while (currentHeight <= peerStatus.currentHeight) {
                const endIndex = Math.min(currentHeight + MAX_BLOCKS_PER_REQUEST - 1, peerStatus.currentHeight);
                const blocks = await this.#requestBlocksFromPeer(
                    p2pNetwork,
                    peerMultiaddr,
                    currentHeight,
                    endIndex
                );

                if (!blocks || blocks.length === 0) {
                    this.logger.warn('No blocks received during sync');
                    break;
                }

                for (const block of blocks) {
                    try {
                        await processBlock(block);
                    } catch (blockError) {
                        this.logger.error({ error: blockError.message }, 'Error processing block');
                        // Depending on the criticality, you might want to throw here
                    }
                }

                this.logger.info({ count: blocks.length }, 'Synchronized blocks from peer');
                currentHeight = endIndex + 1;

                // Optionally refresh peer status in case the peer has new blocks
                peerStatus = await this.#getPeerStatus(p2pNetwork, peerMultiaddr);
                if (!peerStatus || peerStatus.status !== 'success') { throw new Error('Failed to refresh peer status during sync'); }
            }
        } catch (error) {
            this.logger.error({ error: error.message }, 'Error during sync');
            throw error;
        }
    }

    /**
     * Gets the status of a peer.
     * @param {P2PNetwork} p2pNetwork - The P2P network instance.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @returns {Promise<Object>} The peer's status.
     */
    async #getPeerStatus(p2pNetwork, peerMultiaddr) {
        const peerStatusMessage = { type: 'getStatus' };
        const response = await this.#retryOperation(() =>
            p2pNetwork.sendMessage(peerMultiaddr, peerStatusMessage)
        );

        if (response.status !== 'success' || typeof response.currentHeight !== 'number') {
            throw new Error('Invalid peer status response');
        }

        return response;
    }

    /**
     * Requests blocks from a peer.
     * @param {P2PNetwork} p2pNetwork - The P2P network instance.
     * @param {string} peerMultiaddr - The multiaddress of the peer.
     * @param {number} startIndex - The starting block index.
     * @param {number} endIndex - The ending block index.
     * @returns {Promise<Array>} An array of blocks.
     */
    async #requestBlocksFromPeer(p2pNetwork, peerMultiaddr, startIndex, endIndex) {
        const message = { type: 'getBlocks', startIndex, endIndex };
        this.logger.debug({ startIndex, endIndex }, 'Requesting blocks from peer');

        const response = await this.#retryOperation(() =>
            p2pNetwork.sendMessage(peerMultiaddr, message)
        );

        if (response.status === 'success' && Array.isArray(response.blocks)) {
            return response.blocks;
        } else {
            this.logger.warn({ status: response.status }, 'Failed to get blocks from peer');
            return [];
        }
    }

    /**
     * Retries an operation with exponential backoff.
     * @param {Function} operation - The operation to retry.
     * @returns {Promise<any>} The result of the operation.
     */
    async #retryOperation(operation) {
        let attempt = 0;
        let delay = RETRY_DELAY;

        while (attempt < RETRY_ATTEMPTS) {
            try {
                const result = await operation();
                return result;
            } catch (error) {
                attempt++;
                if (attempt >= RETRY_ATTEMPTS) {
                    this.logger.error(
                        { attempt, error: error.message },
                        'Operation failed after maximum retries'
                    );
                    throw error;
                } else {
                    this.logger.warn(
                        { attempt, error: error.message },
                        `Operation failed, retrying in ${delay}ms`
                    );
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                }
            }
        }
    }
}
