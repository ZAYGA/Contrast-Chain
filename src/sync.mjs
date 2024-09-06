// src/sync.mjs
import { lpStream } from 'it-length-prefixed-stream';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import utils from './utils.mjs';
import P2PNetwork from './p2p.mjs';

const MAX_BLOCKS_PER_REQUEST = 10000;


export class SyncNode {
    /**
     * Creates a new SyncNode instance.
     * @param {number} port - The port number to listen on.
     */
    constructor(p2p, blockchain) {
        this.node = null;
        this.p2p = p2p;
        this.blockchain = blockchain;
    }

    /**
     * Starts the synchronization node.
     * @returns {Promise<void>}
     */
    async start() {
        this.node = this.p2p.node;
        console.log(`Node started with ID: ${this.node.peerId.toString()}`);
        console.log(this.p2p.syncProtocol);
        this.node.handle(this.p2p.syncProtocol, this.handleIncomingStream.bind(this));

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
            let message;
            message = utils.compression.msgpack_Zlib.rawData.fromBinary_v1(req.subarray());
            let response;
            switch (message.type.toString()) {
                case 'getBlocks':
                    response = await this.handleGetBlocks(message);
                    break;
                case 'getStatus':
                    response = this.handleGetStatus();
                    break;
                case 'test':
                    response = message;
                    break;
                case 'block':
                    response = { status: 'received', echo: message };
                    break;
                default:
                    console.error('Invalid request type ' + message.type);
            }

            await lp.write(utils.compression.msgpack_Zlib.rawData.toBinary_v1(response));
        } catch (err) {
            console.error('Error handling incoming stream:', err);
            await lp.write(utils.compression.msgpack_Zlib.rawData.toBinary_v1({ status: 'error', message: err.message }));
        } finally {
            await stream.close();
        }
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
            // First, get the peer's current height
            const peerStatusMessage = { type: 'getStatus' };
            const peerStatus = await this.p2p.sendMessage(peerMultiaddr, peerStatusMessage);
            const peerHeight = peerStatus.currentHeight;

            console.log(`Peer height: ${peerHeight}, Our height: ${this.blockchain.currentHeight}`);

            if (peerHeight <= this.blockchain.currentHeight) {
                // console.log('We are up to date or ahead of the peer. No sync needed.');
                return;
            }

            // Sync missing blocks

            let currentHeight = this.blockchain.currentHeight + 1;
            if (this.blockchain.currentHeight === 0) {
                currentHeight = 0;
            }
            while (currentHeight <= peerHeight) {
                const endIndex = Math.min(currentHeight + MAX_BLOCKS_PER_REQUEST - 1, peerHeight);
                const message = {
                    type: 'getBlocks',
                    startIndex: currentHeight,
                    endIndex: endIndex
                };

                console.log(`Requesting blocks from ${currentHeight} to ${endIndex}`);
                const response = await this.p2p.sendMessage(peerMultiaddr, message);

                if (response.status === 'success' && response.blocks.length > 0) {
                    for (const block of response.blocks) {
                        try {
                            await this.blockchain.addConfirmedBlock(block);
                            console.log(`Added block at height ${block.index}`);
                        } catch (error) {
                            console.error(`Failed to add block at height ${block.index}:`, error);
                            // If we fail to add a block, we should stop syncing to prevent potential issues
                            return;
                        }
                    }
                    currentHeight = endIndex + 1;
                } else {
                    console.log('No more blocks received from peer. Ending sync.');
                    break;
                }
            }

            console.log('Sync completed successfully.');
        } catch (error) {
            console.error('Error during sync:', error);
        }
    }

    /**
     * Handles the getBlocks request.
     * @param {Object} message - The getBlocks message.
     * @param {number} message.startIndex - The starting block index.
     * @param {number} message.endIndex - The ending block index.
     * @returns {Object} The response containing the requested blocks.
     */

    async handleGetBlocks(message) {
        console.log('Received getBlocks request:', message);
        const { startIndex, endIndex } = message;
        if (startIndex > endIndex) {
            throw new Error('Invalid block range');
        }
        console.log(`Getting blocks from ${startIndex} to ${endIndex}`);
        const blocks = [];
        for (let i = startIndex; i <= endIndex && i <= this.blockchain.currentHeight; i++) {
            const block = await this.blockchain.getBlockByIndex(i);
            if (block) {
                blocks.push(block);
            } else {
                console.warn(`Block at height ${i} not found`);
                break;
            }
        }

        console.log(`Sending ${blocks.length} blocks in response`);
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

}