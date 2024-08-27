import { EventEmitter } from 'events';
import { pipe } from 'it-pipe';
import * as lp from 'it-length-prefixed';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import pino from 'pino';

const BLOCK_REQUEST_PROTOCOL = '/blockchain/blockrequest/1.0.0';
const STATUS_REQUEST_PROTOCOL = '/blockchain/status/1.0.0';

class SyncManager extends EventEmitter {
    constructor(blockchainNode, networkManager, blockManager) {
        super();
        this.node = blockchainNode;
        this.networkManager = networkManager;
        this.blockManager = blockManager;
        this.isSyncing = false;
        this.syncInterval = 5000; // 30 seconds
        this.maxBlocksPerRequest = 50;
        this.behindThreshold = 5;
        this.syncLoop = null;

        // Initialize pino logger
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

        this.logger.info('SyncManager initialized');
    }

    async start() {
        this.logger.info('Starting SyncManager');
        await this.setupProtocolHandlers();
        this.syncLoop = setInterval(() => this.syncBlockchain(), this.syncInterval);
        this.logger.info(`Sync loop started with interval of ${this.syncInterval}ms`);
    }

    async setupProtocolHandlers() {
        this.logger.debug('Setting up protocol handlers');
        await this.node.handle(BLOCK_REQUEST_PROTOCOL, ({ stream }) => {
            this.logger.debug(`Handling ${BLOCK_REQUEST_PROTOCOL} request`);
            pipe(
                stream,
                lp.decode(),
                async function* (source) {
                    for await (const msg of source) {
                        const request = JSON.parse(uint8ArrayToString(msg.subarray()));
                        this.logger.debug({ request }, 'Received block request');
                        const blocks = await this.handleBlockRequest(request);
                        const response = uint8ArrayFromString(JSON.stringify(blocks));
                        this.logger.debug({ blockCount: blocks.length }, 'Sending block response');
                        yield lp.encode([response]);
                    }
                }.bind(this),
                stream
            );
        });

        await this.node.handle(STATUS_REQUEST_PROTOCOL, ({ stream }) => {
            this.logger.debug(`Handling ${STATUS_REQUEST_PROTOCOL} request`);
            pipe(
                stream,
                lp.decode(),
                async function* (source) {
                    for await (const msg of source) {
                        const status = await this.getNodeStatus();
                        this.logger.debug({ status }, 'Sending node status');
                        const response = uint8ArrayFromString(JSON.stringify(status));
                        yield lp.encode([response]);
                    }
                }.bind(this),
                stream
            );
        });
        this.logger.info('Protocol handlers set up successfully');
    }

    stop() {
        this.logger.info('Stopping SyncManager');
        if (this.syncLoop) {
            clearInterval(this.syncLoop);
            this.syncLoop = null;
            this.logger.info('Sync loop stopped');
        }
    }

    async isNodeBehind() {
        this.logger.debug('Checking if node is behind');
        const peerStatuses = await this.getPeerStatuses();
        if (peerStatuses.length === 0) {
            this.logger.info('No peer statuses available, assuming node is not behind');
            return false;
        }
    
        const localHeight = this.blockManager.getLatestBlockNumber();
        const localHash = this.blockManager.getLatestBlockHash();
        const maxPeerHeight = Math.max(...peerStatuses.map(status => status.height));
    
        this.logger.debug({ localHeight, localHash, maxPeerHeight }, 'Comparing local state with peers');

        // Node is behind if its height is less than max peer height
        if (localHeight < maxPeerHeight) {
            this.logger.info({ localHeight, maxPeerHeight }, 'Node is behind in block height');
            return true;
        }
    
        // If heights are equal, check if hashes match
        const hashCounts = peerStatuses.reduce((counts, status) => {
            if (status.height === localHeight) {
                counts[status.hash] = (counts[status.hash] || 0) + 1;
            }
            return counts;
        }, {});
    
        const majorityHash = Object.entries(hashCounts)
            .reduce((a, b) => a[1] > b[1] ? a : b, [null, 0])[0];
    
        // Node is behind if its hash doesn't match the majority hash at the same height
        const isBehind = localHash !== majorityHash;
        this.logger.info({ localHash, majorityHash, isBehind }, 'Node behind status based on hash comparison');
        return isBehind;
    }

    async getPeerStatuses() {
        this.logger.debug('Getting peer statuses');
        const peers = await this.networkManager.getPeers();
        this.logger.debug({ peerCount: peers.length }, 'Retrieved peers');
        const statuses = await Promise.all(peers.map(peer => this.requestPeerStatus(peer)));
        const validStatuses = statuses.filter(status => status !== null);
        this.logger.debug({ validStatusCount: validStatuses.length }, 'Retrieved valid peer statuses');
        return validStatuses;
    }

    async requestPeerStatus(peer) {
        this.logger.debug({ peer }, 'Requesting peer status');
        try {
            const { stream } = await this.node.dialProtocol(peer, STATUS_REQUEST_PROTOCOL);
            return new Promise((resolve, reject) => {
                pipe(
                    [uint8ArrayFromString(JSON.stringify({}))],
                    lp.encode(),
                    stream,
                    lp.decode(),
                    async function (source) {
                        for await (const msg of source) {
                            const status = JSON.parse(uint8ArrayToString(msg.subarray()));
                            this.logger.debug({ peer, status }, 'Received peer status');
                            resolve(status);
                            return;
                        }
                    }.bind(this),
                    (err) => {
                        if (err) {
                            this.logger.error({ peer, error: err.message }, 'Error requesting peer status');
                            reject(err);
                        }
                    }
                );
            });
        } catch (error) {
            this.logger.error({ peer, error: error.message }, 'Failed to get status from peer');
            return null;
        }
    }

    async performSync() {
        this.logger.info('Performing blockchain sync');
        const peerStatuses = await this.getPeerStatuses();
        const maxHeight = Math.max(...peerStatuses.map(status => status.height));
        const currentHeight = this.blockManager.getLatestBlockNumber();

        this.logger.info({ currentHeight, maxHeight }, 'Sync range determined');
        await this.syncBlocks(currentHeight + 1, maxHeight);
    }

    async syncBlocks(startHeight, endHeight) {
        this.logger.info({ startHeight, endHeight }, 'Starting block sync');
        let currentHeight = startHeight;

        while (currentHeight <= endHeight) {
            const batchEndHeight = Math.min(currentHeight + this.maxBlocksPerRequest - 1, endHeight);
            this.logger.debug({ currentHeight, batchEndHeight }, 'Requesting block batch');
            const blockBatch = await this.requestBlockBatch(currentHeight, batchEndHeight);
            
            for (const block of blockBatch) {
                this.logger.debug({ blockHeight: block.index, blockHash: block.hash }, 'Processing synced block');
                if (await this.blockManager.isValidBlock(block)) {
                    await this.blockManager.addBlock(block);
                    this.logger.info({ blockHeight: block.index, blockHash: block.hash }, 'Block synced and added');
                    this.emit('blockSynced', block);
                } else {
                    this.logger.warn({ blockHeight: block.index, blockHash: block.hash }, 'Invalid block received during sync');
                    this.emit('invalidBlockReceived', block);
                }
            }

            currentHeight += blockBatch.length;
            this.logger.info({ currentHeight, targetHeight: endHeight }, 'Sync progress');
            this.emit('syncProgress', {
                currentHeight: currentHeight - 1,
                targetHeight: endHeight
            });
        }
        this.logger.info('Block sync completed');
    }

    async requestBlockBatch(startHeight, endHeight) {
        this.logger.debug({ startHeight, endHeight }, 'Requesting block batch');
        const peers = await this.networkManager.getPeers();
        if (peers.length === 0) {
            this.logger.error('No peers available to request blocks');
            throw new Error('No peers available to request blocks');
        }
    
        const randomPeer = peers[Math.floor(Math.random() * peers.length)];
        const request = { startHeight, endHeight };
    
        try {
            this.logger.debug({ peer: randomPeer, request }, 'Sending block batch request to peer');
            const response = await this.node.dialProtocol(randomPeer, BLOCK_REQUEST_PROTOCOL, JSON.stringify(request));
            const blocks = JSON.parse(response);
            this.logger.debug({ peer: randomPeer, blockCount: blocks.length }, 'Received block batch from peer');
            return blocks;
        } catch (error) {
            this.logger.error({ peer: randomPeer, error: error.message }, 'Error requesting block batch');
            throw error;
        }
    }

    async syncBlockchain() {
        if (this.isSyncing) {
            this.logger.debug('Sync already in progress, skipping');
            return;
        }

        this.isSyncing = true;
        this.logger.info('Starting blockchain sync');
        this.emit('syncStarted');

        try {
            const isBehind = await this.isNodeBehind();
            if (isBehind) {
                this.logger.info('Node is behind, performing sync');
                await this.performSync();
            } else {
                this.logger.info('Node is up to date, no sync needed');
            }
        } catch (error) {
            this.logger.error({ error: error.message }, 'Error during blockchain sync');
        } finally {
            this.isSyncing = false;
            this.logger.info('Blockchain sync finished');
            this.emit('syncFinished');
        }
    }

    async handleBlockRequest(request) {
        const { startHeight, endHeight } = request;
        this.logger.debug({ startHeight, endHeight }, 'Handling block request');
        const blocks = [];
        for (let i = startHeight; i <= endHeight; i++) {
            const block = await this.blockManager.getBlockByHeight(i);
            if (block) {
                blocks.push(block);
                this.logger.trace({ blockHeight: i, blockHash: block.hash }, 'Added block to response');
            } else {
                this.logger.debug({ height: i }, 'Block not found, stopping block retrieval');
                break;
            }
        }
        this.logger.debug({ blockCount: blocks.length }, 'Completed handling block request');
        return blocks;
    }

    async getNodeStatus() {
        const status = {
            height: this.blockManager.getLatestBlockNumber(),
            hash: this.blockManager.getLatestBlockHash(),
            timestamp: Date.now()
        };
        this.logger.debug({ status }, 'Retrieved node status');
        return status;
    }
}

export { SyncManager };