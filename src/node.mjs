import localStorage_v1 from '../storage/local-storage-management.mjs';
import { TxValidation, BlockValidation } from './validation.mjs';
import { TaskQueue } from './taskQueue.mjs';
import { Vss } from './vss.mjs';
import { MemPool } from './memPool.mjs';
import { UtxoCache } from './utxoCache.mjs';
import { BlockData, BlockUtils } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import { Miner } from './miner.mjs';
import P2PNetwork from './p2p.mjs';
import utils from './utils.mjs';
import { Blockchain } from './blockchain.mjs';
import { SyncHandler } from './sync.mjs';
/**
* @typedef {import("./account.mjs").Account} Account
* @typedef {import("./transaction.mjs").Transaction} Transaction
* @typedef {import("./websocketCallback.mjs").WebSocketCallBack} WebSocketCallBack
* @typedef {import("./block.mjs").BlockHeader} BlockHeader
* @typedef {import("./block.mjs").BlockInfo} BlockInfo
*/

export class Node {
    /** @param {Account} account */
    constructor(account, roles = ['validator'], p2pOptions = {}) {
        /** @type {string} */
        this.id = account.address;
        /** @type {string[]} */
        this.roles = roles; // 'miner', 'validator', ...
        /** @type {TaskQueue} */
        this.taskQueue = null;
        /** @type {P2PNetwork} */
        this.p2pNetwork = new P2PNetwork({
            role: this.roles.join('_'),
            ...p2pOptions
        });

        /** @type {Account} */
        this.account = account;
        /** @type {BlockData} */
        this.blockCandidate = null;

        /** @type {Vss} */
        this.vss = new Vss();
        /** @type {MemPool} */
        this.memPool = new MemPool();
        /** @type {UtxoCache} */
        this.utxoCache = new UtxoCache();
        this.utxoCacheSnapshots = [];
        /** @type {Miner} */
        this.miner = null;
        /** @type {string} */
        this.minerAddress = null;
        this.useDevArgon2 = false;
        /** @type {Blockchain} */
        this.blockchain = new Blockchain(this.id);
        /** @type {SyncHandler} */
        this.syncHandler = new SyncHandler(this.blockchain);

        /** @type {Object<string, WebSocketCallBack>} */
        this.wsCallbacks = {};
    }

    async start() {
        await this.blockchain.init();
        this.taskQueue = TaskQueue.buildNewStack(this, ['Conflicting UTXOs', 'Invalid block index:']); // , 'Invalid transaction']);
        this.miner = new Miner(this.minerAddress || this.account.address, this.p2pNetwork, this.roles, this.taskQueue);
        this.miner.useDevArgon2 = this.useDevArgon2;

        // load the blocks from storage
        const loadedBlocks = this.roles.includes('validator') ? await this.blockchain.recoverBlocksFromStorage() : [];
        for (const block of loadedBlocks) {
            await this.digestFinalizedBlock(block, { skipValidation: true, broadcastNewCandidate: false, persistToDisk: false });
        }

        // start the libp2p network
        await this.p2pNetwork.start();

        const rolesTopics = {
            validator: ['new_transaction', 'new_block_finalized', 'test'],
            miner: ['new_block_candidate', 'test']
        }
        const topicsToSubscribe = [];
        for (const role of this.roles) { topicsToSubscribe.push(...rolesTopics[role]); }
        const uniqueTopics = [...new Set(topicsToSubscribe)];

        // subscribe to the topics
        //await this.p2pNetwork.subscribeMultipleTopics(uniqueTopics, this.p2pHandler.bind(this)); // MOVED BELOW
        await this.syncHandler.start(this.p2pNetwork);
        // miners start their workers, we dont await here
        if (this.roles.includes('miner')) { this.miner.startWithWorker(); }

        // wait for the p2p network to be ready
        console.info(`Node ${this.id.toString()}, ${this.roles.join('_')} started - ${loadedBlocks.length} blocks loaded`);
        if (!await this.#waitSomePeers()) { this.stop(); return; }

        console.log('P2P network is ready - we are connected baby!');

        if (this.roles.includes('validator')) {
            //await this.syncWithKnownPeers(); // validators start the sync process with known peers
            this.taskQueue.push('createBlockCandidateAndBroadcast', null, true);
            this.taskQueue.push('syncWithKnownPeers', null, true); // will be placed first in the queue
        }
        setTimeout(async () => { // will handle event after the sync
            await this.p2pNetwork.subscribeMultipleTopics(uniqueTopics, this.p2pHandler.bind(this));
            console.log('Subscribed to topics');
        }, 1000);

        // control the peers connection to avoid being a lone peer
        //this.#controlPeersConnection();
    }
    async stop() {


        console.log(`Node ${this.id} (${this.roles.join('_')}) => stopped`);
    }
    async #waitSomePeers(nbOfPeers = 1, maxAttempts = 120, interval = 1000) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval));
            const peersIds = this.p2pNetwork.getConnectedPeers();
            let peerCount = peersIds.length;

            const myPeerId = this.p2pNetwork.p2pNode.peerId.toString();
            if (peersIds.includes(myPeerId)) { peerCount--; }

            if (peerCount >= nbOfPeers) { return true; }
            console.log(`Waiting for ${nbOfPeers} peers, currently connected to ${peerCount} peers`);
        }

        console.warn('P2P network failed to initialize within the expected time');
        return false;
    }
    async syncWithKnownPeers_OLD() {
        const peerInfo = await this.p2pNetwork.p2pNode.peerStore.all();
        if (peerInfo.length === 0) { console.warn('No peers found'); return; }

        const myPeerId = this.p2pNetwork.p2pNode.peerId.toString();

        for (const peer of peerInfo) {
            const peerId = peer.id.toString();
            const peerAddresses = peer.addresses;

            if (peerId === myPeerId) { console.warn(`Skipping own peer ID: ${myPeerId}`); continue; }
            if (peerAddresses.length === 0) { console.warn(`No addresses found for peer ${peerId}`); continue; }

            for (const addr of peerAddresses) {
                const fullAddr = addr.multiaddr.encapsulate(`/p2p/${peerId}`);

                // Check if this address belongs to the current node
                if (fullAddr.toString().includes(myPeerId)) { console.warn(`Skipping own address: ${fullAddr.toString()}`); continue; }

                try {
                    await this.syncHandler.getMissingBlocks(
                        this.p2pNetwork,
                        fullAddr,
                        async (block) => {
                            try {
                                await this.digestFinalizedBlock(block, { skipValidation: false, broadcastNewCandidate: false, persistToDisk: true });
                            } catch (error) {
                                console.error(`Failed to digest block from peer ${fullAddr.toString()}:`, error);
                            }
                        }
                    );
                    // Sync successful with this peer, move to the next one
                    break;
                } catch (error) { console.error(`Failed to sync with peer ${fullAddr.toString()}:`, error); }
            }
        }
    }
    async syncWithKnownPeers() {
        const peerInfo = await this.p2pNetwork.p2pNode.peerStore.all();
        if (peerInfo.length === 0) { console.warn('No peers found'); return; }

        const myPeerId = this.p2pNetwork.p2pNode.peerId.toString();

        const peersToSync = peerInfo.filter(peer => { return peer.id.toString() !== myPeerId && peer.addresses.length > 0; });
        if (peersToSync.length === 0) { console.warn('No peers found'); return; }

        const peerIdByAddress = {};
        const addresses = [];
        for (const peer of peersToSync) {
            for (const addr of peer.addresses) {
                const fullAddr = addr.multiaddr.encapsulate(`/p2p/${peer.id.toString()}`);
                addresses.push(fullAddr);
                peerIdByAddress[fullAddr.toString()] = peer.id.toString();
            }
        }

        const processBlock = async (block, peerId) => {
            try {
                await this.digestFinalizedBlock(block, { skipValidation: false, broadcastNewCandidate: false, persistToDisk: true });
            } catch (error) {
                console.error(`Failed to digest block from peer ${peerId}:`, error);
            }
        };

        const successfulSyncs = {};
        for (const fullAddr of addresses) {
            const peerId = peerIdByAddress[fullAddr.toString()];
            if (successfulSyncs[peerId]) { continue; }
            try {
                await this.syncHandler.getMissingBlocks(
                    this.p2pNetwork,
                    fullAddr,
                    block => processBlock(block, peerId)
                );
                successfulSyncs[peerId] = true;
            } catch (error) { console.error(`Failed to sync with peer ${fullAddr.toString()}:`, error); }
        }
    }

    async createBlockCandidateAndBroadcast() {
        try {
            if (!this.roles.includes('validator')) { throw new Error('Only validator can create a block candidate'); }

            this.blockCandidate = await this.#createBlockCandidate();
            if (this.roles.includes('miner')) { this.miner.pushCandidate(this.blockCandidate); }
            await this.p2pBroadcast('new_block_candidate', this.blockCandidate);
            return true;
        } catch (error) {
            console.error(error);
            return false;
        }
    } // Work as a "init"

    /** @param {BlockData} finalizedBlock */
    async #validateBlockProposal(finalizedBlock, timeDrift = 500) {
        try {
            // verify the height
            const lastBlockIndex = this.blockchain.currentHeight;
            if (finalizedBlock.index > lastBlockIndex + 1) {
                console.log(`[NODE-${this.id.slice(0, 6)}] Rejected finalized block, higher index: ${finalizedBlock.index} > ${lastBlockIndex + 1} | from: ${finalizedBlock.Txs[0].outputs[0].address.slice(0, 6)}`); return false;
            }
            if (finalizedBlock.index <= lastBlockIndex) {
                console.log(`[NODE-${this.id.slice(0, 6)}] Rejected finalized block, older index: ${finalizedBlock.index} <= ${lastBlockIndex} | from: ${finalizedBlock.Txs[0].outputs[0].address.slice(0, 6)}`); return false;
            }

            // verify the timestamp
            const timeDiff = this.blockchain.lastBlock === null ? 0 : this.blockchain.lastBlock.timestamp - finalizedBlock.posTimestamp;
            if (timeDiff > timeDrift) { return `Invalid lastBlock.timestamp - finalizedBlock.posTimestamp: ${timeDiff}ms`; }

            // verify the hash
            const { hex, bitsArrayAsString } = await BlockUtils.getMinerHash(finalizedBlock, this.useDevArgon2);
            if (finalizedBlock.hash !== hex) { return 'Hash invalid!'; }
            const hashConfInfo = utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, finalizedBlock);
            if (!hashConfInfo.conform) { return 'Hash not conform!'; }

            // verify the legitimacy
            await this.vss.calculateRoundLegitimacies(finalizedBlock.hash);
            const validatorAddress = finalizedBlock.Txs[1].inputs[0].split(':')[0];
            const validatorLegitimacy = this.vss.getAddressLegitimacy(validatorAddress);
            if (validatorLegitimacy !== finalizedBlock.legitimacy) { return 'Invalid legitimacy!'; }

            // control coinbase amount
            const expectedCoinBase = utils.mining.calculateNextCoinbaseReward(this.blockchain.lastBlock || finalizedBlock);
            if (finalizedBlock.coinBase !== expectedCoinBase) { return `Invalid coinbase amount: ${finalizedBlock.coinBase} - expected: ${expectedCoinBase}`; }

            // control mining rewards
            BlockValidation.areExpectedRewards(this.utxoCache.utxosByAnchor, finalizedBlock);

            // double spend control
            BlockValidation.isFinalizedBlockDoubleSpending(this.utxoCache.utxosByAnchor, finalizedBlock);

            // verify the transactions
            for (const tx of finalizedBlock.Txs) {
                const specialTx = Transaction_Builder.isMinerOrValidatorTx(tx);
                const { fee, success } = await TxValidation.fullTransactionValidation(this.utxoCache.utxosByAnchor, this.memPool.knownPubKeysAddresses, tx, specialTx, this.useDevArgon2);
                if (!success) { return `Invalid transaction: ${tx.id} - ${TxValidation}`; }
            }

            return hashConfInfo;
        } catch (error) {
            console.error(error);
            return false;
        }
    }
    /**
     * @param {BlockData} finalizedBlock
     * @param {Object} [options] - Configuration options for the blockchain.
     * @param {boolean} [options.skipValidation] - default: false
     * @param {boolean} [options.broadcastNewCandidate] - default: true
     * @param {boolean} [options.persistToDisk] - default: true
     * @param {boolean} [options.storeAsFiles] - default: false
     */
    async digestFinalizedBlock(finalizedBlock, options = {}) {
        const {
            skipValidation = false,
            broadcastNewCandidate = true,
            persistToDisk = true,
            storeAsFiles = false
        } = options;

        const startTime = Date.now();
        if (!finalizedBlock) { throw new Error('Invalid block candidate'); }
        if (!this.roles.includes('validator')) { throw new Error('Only validator can process PoW block'); }

        const hashConfInfo = skipValidation ? false : await this.#validateBlockProposal(finalizedBlock);
        if (!skipValidation && (!hashConfInfo || !hashConfInfo.conform)) { return false; }

        const {block, blockInfo} = await this.blockchain.addConfirmedBlocks(this.utxoCache, [finalizedBlock], persistToDisk);
        const blocksData = await this.blockchain.checkAndHandleReorg(this.utxoCache);
        if (!blocksData) { throw new Error('Failed to handle reorg'); }
        await this.blockchain.applyChainReorg(this.utxoCache, this.vss, blocksData);

        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.utxoCache.utxosByAnchor);
        this.memPool.digestFinalizedBlocksTransactions(blocksData);

        if (!skipValidation && this.wsCallbacks.onBlockConfirmed) { this.wsCallbacks.onBlockConfirmed.execute(blockInfo); }
        if (storeAsFiles) this.#storeConfirmedBlock(finalizedBlock); // Used by developer to check the block data manually

        //#region - log
        const timeBetweenPosPow = ((finalizedBlock.timestamp - finalizedBlock.posTimestamp) / 1000).toFixed(2);
        const isSynchronization = !broadcastNewCandidate && !skipValidation;
        const minerId = finalizedBlock.Txs[0].outputs[0].address.slice(0, 6);
        if (skipValidation) {
            console.info(`[NODE-${this.id.slice(0, 6)}] #${finalizedBlock.index} -> loaded block from storage | processProposal: ${(Date.now() - startTime)}ms`);
        } else if (isSynchronization) {
            console.info(`[NODE-${this.id.slice(0, 6)}] #${finalizedBlock.index} (sync) -> ( diff: ${hashConfInfo.difficulty} + timeAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} ) = finalDiff: ${hashConfInfo.finalDifficulty} | z: ${hashConfInfo.zeros} | a: ${hashConfInfo.adjust} | timeBetweenPosPow: ${timeBetweenPosPow}s | processProposal: ${(Date.now() - startTime)}ms`);
        } else {
            console.info(`[NODE-${this.id.slice(0, 6)}] #${finalizedBlock.index} -> [MINER-${minerId}] ( diff: ${hashConfInfo.difficulty} + timeAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} ) = finalDiff: ${hashConfInfo.finalDifficulty} | z: ${hashConfInfo.zeros} | a: ${hashConfInfo.adjust} | gap_PosPow: ${timeBetweenPosPow}s | digest: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
        }
        //#endregion

        if (!broadcastNewCandidate) { return true; }

        this.blockCandidate = await this.#createBlockCandidate();
        if (this.roles.includes('miner')) { this.miner.pushCandidate(this.blockCandidate); }
        try {
            await this.p2pBroadcast('new_block_candidate', this.blockCandidate);
            if (this.wsCallbacks.onBroadcastNewCandidate) { this.wsCallbacks.onBroadcastNewCandidate.execute(BlockUtils.getBlockHeader(this.blockCandidate)); }
        } catch (error) {
            console.error(`Failed to broadcast new block candidate: ${error}`);
        }
        return true;
    }
    /** Aggregates transactions from mempool, creates a new block candidate, signs it and returns it */
    async #createBlockCandidate() {
        const startTime = Date.now();
        const Txs = this.memPool.getMostLucrativeTransactionsBatch();
        const posTimestamp = this.blockchain.lastBlock ? this.blockchain.lastBlock.timestamp + 1 : Date.now();

        // Create the block candidate, genesis block if no lastBlockData
        let blockCandidate = BlockData(0, 0, utils.SETTINGS.blockReward, 100, 0, '0000000000000000000000000000000000000000000000000000000000000000', Txs, posTimestamp);
        if (this.blockchain.lastBlock) {
            await this.vss.calculateRoundLegitimacies(this.blockchain.lastBlock.hash);
            const myLegitimacy = this.vss.getAddressLegitimacy(this.account.address);
            if (myLegitimacy === undefined) { throw new Error(`No legitimacy for ${this.account.address}, can't create a candidate`); }

            const newDifficulty = utils.mining.difficultyAdjustment(this.utxoCache.blockMiningData);
            const coinBaseReward = utils.mining.calculateNextCoinbaseReward(this.blockchain.lastBlock);
            blockCandidate = BlockData(this.blockchain.lastBlock.index + 1, this.blockchain.lastBlock.supply + this.blockchain.lastBlock.coinBase, coinBaseReward, newDifficulty, myLegitimacy, this.blockchain.lastBlock.hash, Txs, posTimestamp);
        }

        // Sign the block candidate
        const { powReward, posReward } = BlockUtils.calculateBlockReward(this.utxoCache.utxosByAnchor, blockCandidate);
        const posFeeTx = await Transaction_Builder.createPosReward(posReward, blockCandidate, this.account.address, this.account.address);
        const signedPosFeeTx = await this.account.signTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);
        blockCandidate.powReward = powReward; // for the miner

        if (blockCandidate.Txs.length > 3)
            console.warn(`(Height:${blockCandidate.index}) => ${blockCandidate.Txs.length} txs, block candidate created in ${(Date.now() - startTime)}ms`);

        return blockCandidate;
    }
    /** @param {BlockData} blockData */
    #storeConfirmedBlock(blockData) {
        if (blockData.index >= 1000) { return; }
        // save the block in local storage definitively
        const clone = BlockUtils.cloneBlockData(blockData); // clone to avoid modification
        localStorage_v1.saveBlockDataLocally(this.id, clone, 'json');
        localStorage_v1.saveBlockDataLocally(this.id, clone, 'bin');
    } // Used by developer to check the block data manually

    /**
     * @param {string} topic
     * @param {object} message
     */
    async p2pHandler(topic, message) {
        const data = message;
        try {
            switch (topic) {
                case 'new_transaction':
                    if (!this.roles.includes('validator')) { break; }
                    this.taskQueue.push('pushTransaction', {
                        utxosByAnchor: this.utxoCache.utxosByAnchor,
                        transaction: data // signedTransaction
                    });
                    break;
                case 'new_block_candidate':
                    if (!this.roles.includes('miner')) { break; }
                    if (this.roles.includes('validator')) { // check legitimacy
                        await this.vss.calculateRoundLegitimacies(data.hash);
                        const validatorAddress = data.Txs[0].inputs[0].split(':')[0];
                        const validatorLegitimacy = this.vss.getAddressLegitimacy(validatorAddress);
                        if (validatorLegitimacy !== data.legitimacy) { return 'Invalid legitimacy!'; }
                    }
                    this.miner.pushCandidate(data);
                    break;
                case 'new_block_finalized':
                    if (!this.roles.includes('validator')) { break; }
                    const lastBlockIndex = this.blockchain.currentHeight;
                    const isSynchronized = data.index === 0 || lastBlockIndex + 1 >= data.index;
                    if (isSynchronized) { this.taskQueue.push('digestPowProposal', data); break; }

                    // if we are late, we ask for the missing blocks by p2p streaming
                    this.taskQueue.push('syncWithKnownPeers', null, true);
                    break;
                case 'test':
                    console.warn(`[TEST] heavy msg bytes: ${new Uint8Array(Object.values(data)).length}`);
                    break;
                default:
                    console.error(`[P2P-HANDLER] ${topic} -> Unknown topic`);
            }
        } catch (error) {
            console.error(`[P2P-HANDLER] ${topic} -> Failed! `, error);
        }
    }
    /**
     * @param {string} topic
     * @param {any} message
     */
    async p2pBroadcast(topic, message) {
        return await this.p2pNetwork.broadcast(topic, message);
    }

    getStatus() {
        return {
            id: this.id,
            role: this.roles.join('_'),
            currentBlockHeight: this.blockchain.currentHeight,
            memPoolSize: Object.keys(this.memPool.transactionsByID).length,
            peerCount: this.p2pNetwork.getConnectedPeers().length,
        };
    }

    // -----------------------------------------------------------------------------
    async pushTransaction(transaction) {
        try {
            const pushedInLocalMempool = await this.memPool.pushTransaction(this.utxoCache.utxosByAnchor, transaction);
            const broadcasted = await this.p2pBroadcast('new_transaction', transaction);
            return { broadcasted, pushedInLocalMempool, error: null };
        } catch (error) {
            console.error(error);
            return { broadcasted: false, pushedInLocalMempool: false, error: error.message };
        }
    }
    async getBlocksInfo(fromHeight = 0, toHeight = 10) {
        try {
            if (fromHeight > toHeight) { throw new Error(`Invalid range: ${fromHeight} > ${toHeight}`); }
            if (toHeight - fromHeight > 10) { throw new Error('Cannot retrieve more than 10 blocks at once'); }
    
            /** @type {BlockInfo[]} */
            const blocksInfo = [];
            for (let i = fromHeight; i < toHeight; i++) {
                //const block = await this.blockchain.getBlockByIndex(i);
                //if (!block) { throw new Error(`Block not found at height: ${i}`); }
                //const blockInfo = BlockUtils.getFinalizedBlockInfo(this.utxoCache.utxosByAnchor, block);
                const blockInfo = await this.blockchain.getBlockInfoFromDiskByHeight(i);
                blocksInfo.push(blockInfo);
            }
    
            return blocksInfo;
        } catch (error) {
            console.error(error);
            return [];
        }
    }
}