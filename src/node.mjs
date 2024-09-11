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
*/

export class Node {
    /** @param {Account} account */
    constructor(account, roles = ['validator'], p2pOptions = {}) {
        /** @type {string} */
        this.id = account.address;
        /** @type {string[]} */
        this.roles = roles; // 'miner', 'validator', ...
        /** @type {TaskQueue} */
        this.taskQueue = TaskQueue.buildNewStack(this, ['Conflicting UTXOs', 'Invalid block index:', 'Invalid transaction']);
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
        this.miner = new Miner(account, this.p2pNetwork, this.roles, this.taskQueue);
        this.useDevArgon2 = false;
        /** @type {Blockchain} */
        this.blockchain = new Blockchain(this.id);
        /** @type {SyncHandler} */
        this.syncHandler = new SyncHandler(this.blockchain);
    }

    async start() {
        await this.blockchain.init();
        const loadedBlocks = await this.blockchain.recoverBlocksFromStorage();
        for (const block of loadedBlocks) {
            await this.digestFinalizedBlock(block, { skipValidation: true, broadcastNewCandidate: false, persistToDisk: false });
        }

        await this.p2pNetwork.start();
        // Set the event listeners
        const rolesTopics = { 
            validator: ['new_transaction', 'new_block_pow', 'test'],
            miner: ['new_block_proposal', 'test']
        }
        const topicsToSubscribe = [];
        for (const role of this.roles) { topicsToSubscribe.push(...rolesTopics[role]); }
        const uniqueTopics = [...new Set(topicsToSubscribe)];

        await this.syncHandler.start(this.p2pNetwork);
        await this.p2pNetwork.subscribeMultipleTopics(uniqueTopics, this.p2pHandler.bind(this));
        
        if (this.roles.includes('miner')) { this.miner.startWithWorker(); }

        console.info(`Node ${this.id.toString()}, ${this.roles.join('_')} started - ${loadedBlocks.length} blocks loaded`);
        if (!await this.#waitSomePeers(1, 60)) { this.stop(); return; }
        console.log('P2P network is ready - we are connected baby!');
        await this.syncWithKnownPeers();

        if (this.roles.includes('validator')) { await this.createBlockCandidateAndBroadcast(); }
        this.#controlPeersConnection();
    }
    async stop() {
        await this.p2pNetwork.stop();
        await this.syncHandler.stop(); // That do nothing lol!
        if (this.miner) { this.miner.terminate(); }
        await this.blockchain.close();

        console.log(`Node ${this.id} (${this.roles.join('_')}) => stopped`);
    }
    async #waitSomePeers(nbOfPeers = 1, maxAttempts = 30, interval = 1000) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval));
            const peerCount = this.p2pNetwork.getConnectedPeers().length;
            if (peerCount > nbOfPeers) { return true; }
        }
    
        console.warn('P2P network failed to initialize within the expected time');
        return false;
    }
    async syncWithKnownPeers() {
        const peerInfo = await this.p2pNetwork.p2pNode.peerStore.all();
        if (peerInfo.length === 0) { console.warn('No peers found'); return; }

        for (const peer of peerInfo) {
            const peerId = peer.id;
            const peerAddresses = peer.addresses;

            if (peerAddresses.length === 0) {
                console.warn(`No addresses found for peer ${peerId.toString()}`);
                continue;
            }

            for (const addr of peerAddresses) {
                const fullAddr = addr.multiaddr.encapsulate(`/p2p/${peerId.toString()}`);

                try {
                    const blocks = await this.syncHandler.getMissingBlocks(this.p2pNetwork, fullAddr);
                    if (!blocks) { continue; }

                    for (const block of blocks) {
                        await this.digestFinalizedBlock(block, { broadcastNewCandidate: false, storeAsFiles: true });
                    }

                    break; // If successful, move to next peer
                } catch (error) {
                    console.error(`Failed to sync with peer ${fullAddr.toString()}:`, error);
                }
            }
        }
    }
    async #controlPeersConnection() {
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const nbOfConnectedPeers = this.p2pNetwork.getConnectedPeers().length;
            if (nbOfConnectedPeers > 1) { continue; }

            await this.stop();
            await this.start();
            return;
        }
    }
    async createBlockCandidateAndBroadcast() {
        if (!this.roles.includes('validator')) { throw new Error('Only validator can create a block candidate'); }

        this.blockCandidate = await this.#createBlockCandidate();
        if (this.roles.includes('miner')) { this.miner.pushCandidate(this.blockCandidate); }
        await this.p2pBroadcast('new_block_proposal', this.blockCandidate);
    } // Work as a "init"

    /** @param {BlockData} finalizedBlock */
    async #validateBlockProposal(finalizedBlock) {
        try {
            // verify the height
            //const lastBlockIndex = this.lastBlockData ? this.lastBlockData.index : -1; / /DEPRECATED
            const lastBlockIndex = this.blockchain.currentHeight;

            if (finalizedBlock.index > lastBlockIndex + 1) {
                console.log(`Rejected block proposal, higher index: ${finalizedBlock.index} > ${lastBlockIndex + 1} | from: ${finalizedBlock.Txs[0].outputs[0].address.slice(0,6)}`); return false;
            }
            if (finalizedBlock.index <= lastBlockIndex) {
                console.log(`Rejected block proposal, older index: ${finalizedBlock.index} <= ${lastBlockIndex} | from: ${finalizedBlock.Txs[0].outputs[0].address.slice(0,6)}`); return false; }
            // verify the hash
            const { hex, bitsArrayAsString } = await BlockUtils.getMinerHash(finalizedBlock, this.useDevArgon2);
            if (finalizedBlock.hash !== hex) { return 'Hash invalid!'; }
            const hashConfInfo = utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, finalizedBlock);
            if (!hashConfInfo.conform) { return 'Hash not conform!'; }

            // control coinbase amount
            const expectedCoinBase = utils.mining.calculateNextCoinbaseReward(this.blockchain.lastBlock || finalizedBlock);
            if (finalizedBlock.coinBase !== expectedCoinBase) { return `Invalid coinbase amount: ${finalizedBlock.coinBase} - expected: ${expectedCoinBase}`; }

            // control mining rewards
            BlockValidation.areExpectedRewards(this.utxoCache.utxosByAnchor, finalizedBlock);

            // double spend control
            BlockValidation.isFinalizedBlockDoubleSpending(this.utxoCache.utxosByAnchor, finalizedBlock);

            // verify the transactions
            for (const tx of finalizedBlock.Txs) {
                const isCoinBase = Transaction_Builder.isMinerOrValidatorTx(tx);
                const { fee, success } = await TxValidation.fullTransactionValidation(this.utxoCache.utxosByAnchor, this.memPool.knownPubKeysAddresses, tx, isCoinBase, this.useDevArgon2);
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

        await this.blockchain.addConfirmedBlocks(this.utxoCache, [finalizedBlock], persistToDisk);
        const blocksData = await this.blockchain.checkAndHandleReorg(this.utxoCache);
        if (!blocksData) { throw new Error('Failed to handle reorg'); }
        await this.blockchain.applyChainReorg(this.utxoCache, this.vss, blocksData);
        
        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.utxoCache.utxosByAnchor);
        this.memPool.digestFinalizedBlocksTransactions(blocksData);

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
        await this.p2pBroadcast('new_block_proposal', this.blockCandidate);

        return true;
    }
    /** Aggregates transactions from mempool, creates a new block candidate, signs it and returns it */
    async #createBlockCandidate() {
        const startTime = Date.now();
        const Txs = this.memPool.getMostLucrativeTransactionsBatch();
        const posTimestamp = this.blockchain.lastBlock ? this.blockchain.lastBlock.timestamp + 1 : Date.now();

        // Create the block candidate, genesis block if no lastBlockData
        let blockCandidate = BlockData(0, 0, utils.SETTINGS.blockReward, 1, 0, 'ContrastGenesisBlock', Txs, posTimestamp);
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
        const posFeeTx = await Transaction_Builder.createPosRewardTransaction(posReward, blockCandidate, this.account.address, this.account.address);
        const signedPosFeeTx = await this.account.signTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);
        blockCandidate.powReward = powReward; // for the miner

        if (blockCandidate.Txs.length > 3) console.info(`(Height:${blockCandidate.index}) => ${blockCandidate.Txs.length} txs, block candidate created in ${(Date.now() - startTime)}ms`);

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
                case 'new_block_proposal':
                    if (!this.roles.includes('miner')) { break; }
                    this.miner.pushCandidate(data);
                    break;
                case 'new_block_pow':
                    if (!this.roles.includes('validator')) { break; }
                    const lastBlockIndex = this.blockchain.currentHeight;
                    const isSynchronized = data.index === 0 || lastBlockIndex + 1 >= data.index;
                    if (isSynchronized) {
                        this.taskQueue.push('digestPowProposal', data); break; }

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
     * @param {Uint8Array} message
     */
    async p2pBroadcast(topic, message) {
        await this.p2pNetwork.broadcast(topic, message);
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
}