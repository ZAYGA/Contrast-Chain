import { EventEmitter } from 'node:events';
import PeerManager from './PeerManager.mjs';
import MessageHandler from './MessageHandler.mjs';
import NetworkProtocol from './NetworkProtocol.mjs';
import pkg from 'bloom-filters';
const { BloomFilter } = pkg;
import crypto from 'crypto';

class P2PNode extends EventEmitter {
    constructor(port, seeds = [], maxPeers = 100, banThreshold = 10, role = 'Validator') {
        super();
        this.port = port;
        this.role = role;
        this.seeds = seeds;
        this.peerManager = new PeerManager(maxPeers, banThreshold);
        this.networkProtocol = new NetworkProtocol(this.peerManager, this.messageHandler, port, this.fullNode, this);
        this.messageHandler = new MessageHandler(this,this.fullNode, this.peerManager, this.networkProtocol);
        this.networkProtocol.messageHandler = this.messageHandler;
        this.fullNode = null;
        this.syncState = {
            isSyncing: false,
            lastSyncAttempt: 0,
            syncInterval: 30000
        };
        this.bloomFilter = new BloomFilter(10000, 1);
        this.hasStarted = false;
        this.knownPeers = new Set(); 
        this.id = crypto.randomBytes(16).toString('hex');
    }

    /**
     * Starts the P2P node by initializing the network protocol, starting peer discovery,
     * and connecting to seed nodes.
     */
    async start() {
        await this.networkProtocol.start();
        await this.startPeerDiscovery();
        for (const seed of this.seeds) {
            try {
                await this.networkProtocol.connect(seed.host, seed.port);
            } catch (error) {
                console.error(`Failed to connect to seed ${seed.host}:${seed.port}:`, error);
            }
        }

        setInterval(() => {
            this.peerManager.cleanupBannedPeers();  // Remove banned peers after their ban duration
            this.peerManager.cleanupUnresponsivePeers();  // Remove peers that haven't responded for a long time
        }, 60000);  // Run cleanup every 1 minute
        
    }

    setFullNode(fullNode) {
        this.fullNode = fullNode;
        this.fullNode.id = this.id;
        this.messageHandler.fullNode = fullNode;
        this.networkProtocol.fullNode = fullNode;
        console.log(`FullNode set for P2P node on port ${this.port}`);
    }

    async startPeerDiscovery() {
        // Regularly discover new peers and gossip peer lists with connected peers
        const resolvedSeeds = await this.peerManager.resolveDNSSeeds(this.seeds);
        for (const seed of resolvedSeeds) {
            this.networkProtocol.connect(seed.address, seed.port);
        }

        setInterval(() => {
            if (this.peerManager.peers.size < this.peerManager.maxPeers) {
                this.requestPeers();
            }
        }, 60000); // Every minute

        // Automatically share and receive peer lists during consensus
        this.startGossipingPeers();
    }

    requestPeers() {
        const randomPeers = this.peerManager.getRandomPeers(3);
        randomPeers.forEach(peer => {
            this.networkProtocol.sendToPeer(peer.id, { type: 'GET_PEERS' });
        });
    }

    async startGossipingPeers() {
        setInterval(() => {
            this.gossipPeerList();
        }, 30000); // Every 30 seconds, share the peer list with other peers
    }

    gossipPeerList() {
        const peers = this.peerManager.getAllPeers().map(peer => ({
            address: peer.address,
            port: peer.port,
        }));

        if (peers.length > 0) {
            this.networkProtocol.broadcast({
                type: 'PEER_LIST',
                peers
            });
        }
    }

    async handlePeerList(peerId, message) {
        const newPeers = message.peers.filter(peer => !this.knownPeers.has(`${peer.address}:${peer.port}`));
        for (const peer of newPeers) {
            try {
                await this.networkProtocol.connect(peer.address, peer.port);
                this.knownPeers.add(`${peer.address}:${peer.port}`);
            } catch (error) {
                console.error(`Failed to connect to new peer ${peer.address}:${peer.port}:`, error);
            }
        }
    }

    async startConsensusProcess() {
        if (this.role === 'Validator') {
            await this.startValidatorProcess();
        } else if (this.role === 'Miner') {
            await this.startMinerProcess();
        }
    }

    async startValidatorProcess() {
        try {
            if (!await this.ensureNodeIsSynced()) {
                console.log("Node is not synced. Delaying validator process.");
                setTimeout(() => this.startValidatorProcess(), 10000);
                return;
            }
            const blockCandidate = await this.fullNode.createBlockCandidate();
            
            if (!blockCandidate) {
                console.warn("Failed to create block candidate. Skipping this round.");
                setTimeout(() => this.startValidatorProcess(), 5000);
                return;
            }

            console.log(`Block candidate created: ${blockCandidate.index} by validator ${this.fullNode.id}`);

            const message = { 
                type: 'BLOCK_CANDIDATE', 
                blockCandidate: JSON.stringify(blockCandidate),
                validatorId: this.fullNode.id,
            };

            this.networkProtocol.broadcast(message);
            console.log(`Broadcasted block candidate ${blockCandidate.index} to the network`);

        } catch (error) {
            console.error("Error in startValidatorProcess:", error);
            setTimeout(() => this.startValidatorProcess(), 10000);
        }
    }

    async ensureNodeIsSynced() {
        const localHeight = this.fullNode.getBlockchainHeight();
        const networkHeight = await this.getNetworkHeight();
    
        if (localHeight < networkHeight) {
            console.log(`Node is behind. Local height: ${localHeight}, Network height: ${networkHeight}`);
            await this.synchronizeWithPeers();
            return false;
        }
    
        return true;
    }

    async synchronizeWithPeers() {
        console.log("Synchronizing blockchain height with peers...");
        const peers = this.peerManager.getAllPeers();
        
        for (const peer of peers) {
            this.networkProtocol.requestBlocks(peer.peerId, this.fullNode.getBlockchainHeight());
        }
        
    }
    async getNetworkHeight() {
        const peerHeights = await Promise.all(
            this.peerManager.getAllPeers().map(peer => 
                new Promise(resolve => {
                    this.networkProtocol.sendToPeer(peer.id, { type: 'GET_HEIGHT' });
                    setTimeout(() => resolve(peer.bestHeight), 2000);
                })
            )
        );
        return Math.max(...peerHeights, 0);
    }

    async handleGetBlockCandidate(peerId) {
        if (this.fullNode.role !== 'Validator') {
            console.log("Not a validator, ignoring GET_BLOCK_CANDIDATE request");
            return;
        }

        try {
            const blockCandidate = await this.fullNode.createBlockCandidate();
            if (blockCandidate) {
                this.networkProtocol.sendToPeer(peerId, {
                    type: 'BLOCK_CANDIDATE',
                    blockCandidate: JSON.stringify(blockCandidate),
                    validatorId: this.fullNode.id
                });
                console.log(`Sent block candidate to peer ${peerId}`);
            } else {
                console.log(`Failed to create block candidate for peer ${peerId}`);
            }
        } catch (error) {
            console.error("Error creating block candidate:", error);
        }
    }

    async synchronizeWithPeers() {
        const localHeight = this.fullNode.getBlockchainHeight();
        const networkHeight = await this.getNetworkHeight();
        
        if (localHeight < networkHeight) {
            const bestPeer = this.peerManager.getAllPeers().reduce((best, peer) => 
                peer.bestHeight > (best?.bestHeight || 0) ? peer : best, null);
            
            if (bestPeer) {
                console.log(`Requesting blocks from height ${localHeight + 1} to ${networkHeight}`);
                this.networkProtocol.requestBlocks(bestPeer.id, localHeight + 1, networkHeight);
            }
        }
    }
    
    handleHeightResponse(peerId, height) {
        const peer = this.peerManager.getPeer(peerId);
        if (peer) {
            peer.bestHeight = height;
        }
    }
    
    async startMinerProcess() {
        if (this.role !== 'Miner') {
            throw new Error('Only Miner nodes can start the mining process');
        }
        if (this.hasStarted) {
            throw new Error('Miner process already started');
        }

        this.hasStarted = true;
        // Set up a listener for BLOCK_CANDIDATE messages
        console.log('Starting miner process' + this.fullNode.chain.length + this.role);
        this.on('BLOCK_CANDIDATE', async (blockCandidate) => {
            console.log(`Miner received block candidate: ${blockCandidate.index}`);
            try {
                // Attempt to mine the block
                const minedBlock = await this.fullNode.mineBlock(blockCandidate);
                console.log(`Block mined: ${minedBlock.index}, nonce: ${minedBlock.nonce}`);
                
                // Broadcast the mined block
                this.networkProtocol.broadcast({
                    type: 'MINED_BLOCK',
                    minedBlock: JSON.stringify(minedBlock)
                });
            } catch (error) {
                console.error('Error mining block:', error);
            }
        });
    
        // Optionally, request the latest block candidate if we don't have one
        if (!this.fullNode.blockCandidate) {
            this.requestLatestBlockCandidate();
        }
    
        console.log('Miner process started, waiting for block candidates...');
    }
    
    requestLatestBlockCandidate() {
        this.networkProtocol.broadcast({
            type: 'GET_BLOCK_CANDIDATE'
        });
    }

    async handleMinedBlock(minedBlock) {
        if (this.role === 'Validator') {
            const isValid = await this.fullNode.validateMinedBlock(minedBlock);
            if (isValid) {
                await this.fullNode.blockProposal(minedBlock);
                this.networkProtocol.broadcast({ type: 'BLOCK', block: JSON.stringify(minedBlock) });
            }
        }
    }



    startSyncProcess() {
        setInterval(() => {
            this.trySync();
        }, this.syncState.syncInterval);
    }

    async trySync() {
        if (this.syncState.isSyncing) return;
        if (Date.now() - this.syncState.lastSyncAttempt < this.syncState.syncInterval) return;

        this.syncState.isSyncing = true;
        this.syncState.lastSyncAttempt = Date.now();

        try {
            const bestPeer = this.findBestPeer();
            if (bestPeer && bestPeer.bestHeight > this.fullNode.chain.length - 1) {
                await this.syncWithPeer(bestPeer);
            }
        } catch (error) {
            console.error('Sync process failed:', error);
        } finally {
            this.syncState.isSyncing = false;
        }
    }

    findBestPeer() {
        return this.peerManager.getAllPeers().reduce((best, peer) => {
            if (!best || peer.bestHeight > best.bestHeight) {
                return peer;
            }
            return best;
        }, null);
    }

    async syncWithPeer(peer) {
        const startHeight = this.fullNode.chain.length;
        console.log(`Starting sync with peer ${peer.id} from height ${startHeight}`);

        while (startHeight < peer.bestHeight) {
            const endHeight = Math.min(startHeight + 500, peer.bestHeight);
            await this.requestBlockRange(peer, startHeight, endHeight);
            startHeight = endHeight + 1;
        }

        console.log(`Sync completed with peer ${peer.id}`);
    }

    async requestBlockRange(peer, startHeight, endHeight) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Block range request timed out'));
            }, 30000); // 30 seconds timeout

            this.once(`blocksReceived_${startHeight}_${endHeight}`, (blocks) => {
                clearTimeout(timeout);
                this.processReceivedBlocks(blocks).then(resolve).catch(reject);
            });

            this.networkProtocol.sendToPeer(peer.id, {
                type: 'GET_BLOCKS',
                startHeight,
                endHeight
            });
        });
    }

    async processReceivedBlocks(blocks) {
        for (const block of blocks) {
            try {
                await this.fullNode.blockProposal(block);
            } catch (error) {
                console.error(`Error processing block ${block.index}:`, error);
                throw error;
            }
        }
    }

    // UNUSED METHODS

    startBloomFilterMaintenance() {
        setInterval(() => {
            this.updateBloomFilter();
        }, 600000); // Update every 10 minutes
    }

    updateBloomFilter() {
        console.log('Updating Bloom filter...');
        // Recreate the Bloom filter
        const filterSize = 10000; // Adjust as needed
        const falsePositiveRate = 0.01; // Adjust as needed
        this.bloomFilter = BloomFilter.create(filterSize, falsePositiveRate);
        
        // Add all addresses from the wallet to the Bloom filter
        const addresses = this.fullNode.wallet.getAllAddresses();
        addresses.forEach(address => this.bloomFilter.add(address));
    
        // Serialize the filter
        const serializedFilter = this.serializeBloomFilter(this.bloomFilter);
    
        // Broadcast the updated filter to all peers
        this.networkProtocol.broadcast({
            type: 'FILTERLOAD',
            filter: serializedFilter
        });
    }
    
    serializeBloomFilter(bloomFilter) {
        return {
            bitArray: Array.from(bloomFilter._filter),
            nHashFunctions: bloomFilter._nbHashes,
            size: bloomFilter._size
        };
    }
    
    addTransactionToMempool(transaction) {
        if (this.fullNode.addTransactionToMempool(transaction)) {
            this.networkProtocol.broadcast({
                type: 'TRANSACTION',
                transaction: JSON.stringify(transaction)
            });
        }
    }

    announceNewBlock(block) {
        const invMessage = {
            type: 'INV',
            inv: [{ type: 'block', hash: block.hash, index: block.index }]
        };
        this.networkProtocol.broadcast(invMessage);
    }

    handlePeerDisconnect(peerId) {
        console.log(`Peer ${peerId} disconnected`);
        this.peerManager.removePeer(peerId);
        if (this.peerManager.peers.size < this.peerManager.maxPeers / 2) {
            this.requestPeers();
        }
    }

    shutdown() {
        console.log('Shutting down P2P node...');
        this.networkProtocol.server.close();
        this.peerManager.getAllPeers().forEach(peer => peer.disconnect('Node shutting down'));
        // Perform any other necessary cleanup
    }

    initializeBloomFilter = () => {
        this.bloomFilter = new BloomFilter(10000, 1);
    }

    broadcastCompactBlock(block) {
        const compactBlock = {
            header: block.header,  // Only send block header
            txShortIds: block.txShortIds  // Send short IDs of transactions in the block
        };
        
        this.networkProtocol.broadcast({
            type: 'COMPACT_BLOCK',
            block: JSON.stringify(compactBlock)
        });
    }
    
    gossipTransactionsUsingBloomFilter(peer) {
        const bloomFilter = this.createBloomFilter(peer);  // Create a bloom filter for the peer
        const transactionsToSend = this.fullNode.getMempoolTransactions()
            .filter(tx => bloomFilter.has(tx.id));  // Only send transactions that match the peer's bloom filter
    
        if (transactionsToSend.length > 0) {
            this.networkProtocol.sendToPeer(peer.id, {
                type: 'TRANSACTION',
                transactions: transactionsToSend.map(tx => JSON.stringify(tx))
            });
        }
    }
    
    createBloomFilter(peer) {
        // Create and return a bloom filter for the peer based on their interests (e.g., addresses they are tracking)
        const filterSize = 10000;
        const falsePositiveRate = 0.01;
        return BloomFilter.create(filterSize, falsePositiveRate);
    }
}

export default P2PNode;