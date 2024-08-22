import { EventEmitter } from 'events';
import pkg from 'bloom-filters';
const { BloomFilter } = pkg;

export class MessageHandler extends EventEmitter {
    constructor(p2pNode, fullNode, peerManager, networkProtocol) {
        super();
        this.p2pNode = p2pNode;
        this.fullNode = fullNode;
        this.peerManager = peerManager;
        this.networkProtocol = networkProtocol;
        this.handlers = new Map();
        this.blockValidationLock = false;

        this.setupHandlers();
    }

    setupHandlers() {
        const handlerMapping = {
            'HANDSHAKE': this.handleHandshake,
            'GET_PEERS': this.handleGetPeers,
            'PEERS': this.handlePeers,
            'PEER_LIST': this.handlePeerList,
            'BLOCK': this.handleBlock,
            'TRANSACTION': this.handleTransaction,
            'GET_BLOCKS': this.handleGetBlocks,
            'INV': this.handleInv,
            'GETDATA': this.handleGetData,
            'FILTERLOAD': this.handleFilterload,
            'MEMPOOL': this.handleMempool,
            'BLOCK_CANDIDATE': this.handleBlockCandidate,
            'MINED_BLOCK': this.handleMinedBlock,
            'GET_BLOCK_CANDIDATE': this.handleGetBlockCandidate,
            'COMPACT_BLOCK': this.handleCompactBlock,
            'GET_BLOCK': this.handleGetBlock,
            'GET_TRANSACTIONS': this.handleGetTransactions,
            'HEIGHT_RESPONSE': this.handleHeightResponse,
            'GET_HEIGHT': this.handleGetHeight,
        };

        for (const [type, handler] of Object.entries(handlerMapping)) {
            this.addHandler(type, handler.bind(this));
        }
    }

    async handle(peerId, message) {
        const handler = this.handlers.get(message.type);
        if (handler) {
            try {
                await handler(peerId, message);
            } catch (error) {
                console.error(`Error handling message ${message.type} from peer ${peerId}:`, error);
                this.emit('error', error);
            }
        } else {
            console.warn(`Unknown message type: ${message.type} from peer ${peerId}`);
        }
    }

    async handleGetHeight(peerId) {
        const height = this.fullNode.getBlockchainHeight();
        this.networkProtocol.sendToPeer(peerId, { type: 'HEIGHT_RESPONSE', height });
    }
    
    async handleStakingUpdate(peerId, message) {
        const update = StakingContractUpdate.deserialize(message.update);
        try {
          if (update.action === 'stake') {
            await this.fullNode.stakingContract.stake(update.validatorAddress, update.amount);
          } else if (update.action === 'unstake') {
            await this.fullNode.stakingContract.unstake(update.validatorAddress, update.amount);
          }
          console.log(`Staking update applied: ${update.action} ${update.amount} for ${update.validatorAddress}`);
        } catch (error) {
          console.error('Error applying staking update:', error);
        }
      }
    
    // Also add a handler for the height response
    async handleHeightResponse(peerId, message) {
        this.p2pNode.handleHeightResponse(peerId, message.height);
    }

    addHandler(type, handler) {
        this.handlers.set(type, handler);
    }



    // Reusable Helper Methods

    sendToPeer(peerId, message) {
        this.networkProtocol.sendToPeer(peerId, message);
    }

    broadcast(message, excludePeerId = null) {
        this.networkProtocol.broadcast(message, excludePeerId);
    }

    parseJSON(data, fallbackValue = {}) {
        try {
            return JSON.parse(data);
        } catch (error) {
            console.error("Failed to parse JSON:", error);
            return fallbackValue;
        }
    }

    // Core Message Handlers

    async handleGetPeers(peerId) {
        // Get all peers that have completed the handshake
        const peerList = this.peerManager.getAllPeers()
            .filter(peer => peer.handshakeCompleted)
            .map(peer => ({ address: peer.address, port: peer.port }));
    
        console.log(`Sending ${peerList.length} peers to ${peerId}`);
        
        // Send the peer list to the requesting peer
        const message = { type: 'PEERS', peers: peerList };
        this.sendToPeer(peerId, message);
    }

    
    async handleHandshake(peerId, message) {
        const peer = this.peerManager.getPeer(peerId);
        if (peer) {
            peer.handshakeCompleted = true;
            peer.version = message.version;
            peer.nodeId = message.nodeId;
            peer.bestHeight = message.bestHeight;

            console.log(`Handshake completed with peer ${peerId}. Version: ${peer.version}, Best Height: ${peer.bestHeight}`);

            if (message.bestHeight > this.fullNode.getBlockchainHeight()) {
                this.requestBlocks(peerId, this.fullNode.getBlockchainHeight());
            }
        } else {
            console.warn(`Received handshake from unknown peer ${peerId}`);
        }
    }

    async handleBlock(peerId, message) {
        const blockData = this.parseJSON(message.block);
        if (this.fullNode.hasBlock(blockData.hash)) {
            console.log(`Block ${blockData.index} already exists. Ignoring.`);
            return;
        }

        const isValid = await this.fullNode.verifyLastBlock(blockData);
        if (isValid) {
            console.log(`Block ${blockData.index} added to chain.`);
            this.gossipBlock(blockData, peerId);
        } else {
            console.warn(`Invalid block ${blockData.index} received from peer ${peerId}`);
        }
    }

    gossipBlock(block, excludePeerId = null) {
        console.log(`Gossiping block ${block.index} to peers`);
        this.broadcast({ type: 'BLOCK', block: JSON.stringify(block) }, excludePeerId);
    }
    
    async handleGetBlockCandidate(peerId, message) {
        await this.p2pNode.handleGetBlockCandidate(peerId);
    }

    async handleTransaction(peerId, message) {
        const transaction = this.parseJSON(message.transaction);

        if (!this.fullNode.hasTransaction(transaction.id)) {
            const success = await this.fullNode.addTransactionJSONToMemPool(transaction);
            if (success) {
                this.broadcast({ type: 'TRANSACTION', transaction: message.transaction }, peerId);
            }
        }
    }

    async handleGetBlocks(peerId, message) {
        const { startHeight, endHeight = startHeight } = message;
        const actualEndHeight = Math.min(endHeight, this.fullNode.getBlockchainHeight());

        for (let i = startHeight; i <= actualEndHeight; i++) {
            const block = this.fullNode.getBlockByIndex(i);
            if (block) {
                this.sendToPeer(peerId, { type: 'BLOCK', block: JSON.stringify(block) });
            } else {
                console.warn(`Block ${i} not found.`);
            }
        }
    }

    async handleMinedBlock(peerId, message) {
        if (this.fullNode.role !== 'Validator') return;

        if (this.blockValidationLock) {
            console.log(`Block validation in progress, ignoring block ${message} from peer ${peerId}`);
            return;
        }

        this.blockValidationLock = true;
        try {
            const minedBlock = this.parseJSON(message.minedBlock);
            const isValid = await this.fullNode.validatePowMinedBlock(minedBlock);
            if (isValid) {
                this.gossipBlock(minedBlock, peerId);
                this.p2pNode.startConsensusProcess();
            } else {
                console.warn(`Invalid block ${minedBlock.index} received from peer ${peerId}`);
            }
        } catch (error) {
            console.error('Error during block validation:', error);
        } finally {
            this.blockValidationLock = false;
        }
    }

    async handleCompactBlock(peerId, message) {
        const compactBlock = this.parseJSON(message.block);
        const fullBlock = await this.reconstructBlockFromCompact(compactBlock);

        if (fullBlock) {
            const isValid = await this.fullNode.blockProposal(fullBlock);
            if (isValid) {
                this.gossipBlock(fullBlock, peerId);
            }
        } else {
            this.requestMissingTransactions(peerId, compactBlock);
        }
    }

    async reconstructBlockFromCompact(compactBlock) {
        const fullBlock = { header: compactBlock.header, transactions: [] };

        for (const shortId of compactBlock.txShortIds) {
            const tx = this.fullNode.getTransactionByShortId(shortId);
            if (tx) {
                fullBlock.transactions.push(tx);
            } else {
                return null;
            }
        }

        return fullBlock;
    }

    async handleGetTransactions(peerId, message) {
        const requestedTxIds = message.txIds;
        const transactions = requestedTxIds.map(id => this.fullNode.getTransactionById(id)).filter(tx => tx);

        if (transactions.length > 0) {
            this.sendToPeer(peerId, {
                type: 'TRANSACTIONS',
                transactions: transactions.map(tx => JSON.stringify(tx))
            });
        } else {
            console.warn(`No transactions found for requested IDs from peer ${peerId}`);
        }
    }

    async handleGetBlock(peerId, message) {
        const block = this.fullNode.getBlockByIndex(message.index);
        if (block) {
            this.sendToPeer(peerId, { type: 'BLOCK', block: JSON.stringify(block) });
        } else {
            console.warn(`Requested block ${message.index} not found.`);
        }
    }

    async handleBlockCandidate(peerId, message) {
        const peer = this.peerManager.getPeer(peerId);
        const blockCandidate = JSON.parse(message.blockCandidate);
        const validatorId = message.validatorId;
        const stake = message.stake;

        if (peer.bestHeight < this.fullNode.getBlockchainHeight()) {
            //console.warn(`Received block candidate from peer ${peerId}, but peer is behind in chain.`);
            return;
        }

        if (this.fullNode.role === 'Miner') {
            const minedBlock = await this.fullNode.mineBlock(blockCandidate);
            this.broadcast({ type: 'MINED_BLOCK', minedBlock: JSON.stringify(minedBlock) });
        }
    }

    async handlePeers(peerId, message) {
        for (const peer of message.peers) {
            const peerId = `${peer.address}:${peer.port}`;
            if (!this.peerManager.getPeer(peerId)) {
                this.networkProtocol.connect(peer.address, peer.port)
                    .catch(error => console.error(`Failed to connect to peer ${peerId}:`, error));
            }
        }
    }

    async handlePeerList(peerId, message) {
        await this.p2pNode.handlePeerList(peerId, message);
    }

    async handleInv(peerId, message) {
        const unknownItems = message.inv.filter(item => item.type === 'block' && item.index > this.fullNode.getBlockchainHeight());

        if (unknownItems.length > 0) {
            this.sendToPeer(peerId, {
                type: 'GETDATA',
                items: unknownItems.map(item => ({ type: 'block', index: item.index }))
            });
        }
    }

    async handleGetData(peerId, message) {
        for (const item of message.items) {
            if (item.type === 'block') {
                const block = this.fullNode.getBlock(item.hash) || this.fullNode.getBlockByIndex(item.index);
                if (block) {
                    this.sendToPeer(peerId, { type: 'BLOCK', block: JSON.stringify(block) });
                } else {
                    console.log(`Block ${item.hash || item.index} not found.`);
                }
            }
        }
    }

    async handleMempool(peerId) {
        const mempoolTxs = this.fullNode.getMempoolTransactions();
        const peer = this.peerManager.getPeer(peerId);

        if (peer?.bloomFilter) {
            const filteredTxs = mempoolTxs.filter(tx => tx.outputs.some(output => peer.bloomFilter.has(output.address)));
            this.sendInventory(peerId, filteredTxs);
        } else {
            this.sendInventory(peerId, mempoolTxs);
        }
    }

    sendInventory(peerId, transactions) {
        const inv = transactions.map(tx => ({ type: 'tx', hash: tx.id }));
        this.sendToPeer(peerId, { type: 'INV', inv });
    }

    requestBlocks(peerId, startHeight) {
        this.sendToPeer(peerId, { type: 'GET_BLOCKS', startHeight });
    }

    requestMissingTransactions(peerId, compactBlock) {
        const missingTxIds = compactBlock.txShortIds.filter(id => !this.fullNode.getTransactionByShortId(id));

        if (missingTxIds.length > 0) {
            this.sendToPeer(peerId, { type: 'GET_TRANSACTIONS', txIds: missingTxIds });
        }
    }

    async handleFilterload(peerId, message) {
        const peer = this.peerManager.getPeer(peerId);
        if (!peer) {
            console.warn(`Received FILTERLOAD from unknown peer ${peerId}`);
            return;
        }

        try {
            const { bitArray, nHashFunctions, size } = message.filter;
            const validHashFunctions = Math.max(1, nHashFunctions || 1);
            const validSize = size || bitArray.length * 8;

            peer.bloomFilter = new BloomFilter(validHashFunctions, validSize);
            if (bitArray.length > 0) {
                peer.bloomFilter._filter = new Uint8Array(bitArray);
            }

            console.log(`Updated Bloom filter for peer ${peerId}`);
        } catch (error) {
            console.error(`Error creating Bloom filter for peer ${peerId}:`, error);
        }
    }

    serializeBloomFilter(bloomFilter) {
        return {
            type: 'BloomFilter',
            data: {
                bitArray: Array.from(bloomFilter._filter),
                nHashFunctions: bloomFilter._nbHashes,
                size: bloomFilter._size
            }
        };
    }
}

export default MessageHandler;
