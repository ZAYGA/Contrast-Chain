import localStorage_v1 from '../storage/local-storage-management.mjs';
import { Validation } from './validation.mjs';
import { TaskStack } from './taskstack.mjs';
import { Vss } from './vss.mjs';
import { MemPool } from './memPool.mjs';
import { UtxoCache } from './utxoCache.mjs';
import { BlockData, Block } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import { Miner } from './miner.mjs';
import P2PNetwork from './p2p.mjs';
import utils from './utils.mjs';
import { Blockchain } from './blockchain.mjs';
import { SyncNode } from './sync.mjs';
/**
* @typedef {import("./account.mjs").Account} Account
* @typedef {import("./transaction.mjs").Transaction} Transaction
*/

export class Node {
    /** @param {Account} account */
    constructor(account, role = 'validator', p2pOptions = {}) {
        /** @type {string} */
        this.id = account.address;
        /** @type {string} */
        this.role = role; // 'miner' or 'validator'
        /** @type {TaskStack} */
        this.taskStack = TaskStack.buildNewStack(this, ['Conflicting UTXOs', 'Invalid block index:', 'UTXOs(one at least) are spent']);
        /** @type {P2PNetwork} */
        this.p2pNetwork = new P2PNetwork({
            role: this.role,
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
        this.miner = new Miner(account, this.p2pNetwork);

        this.useDevArgon2 = false;
        this.lastBlockData = null;

        /** @type {Blockchain} */
        this.blockchain = new Blockchain(this.id);
        /** @type {SyncNode} */
        this.syncNode = new SyncNode(this.blockchain);
    }

    async start() {
        await this.blockchain.init();
        const loadedBlocks = await this.blockchain.recoverBlocksFromStorage();
        for (const block of loadedBlocks) {
            await this.digestFinalizedBlock(block, false, false);
        }

        await this.p2pNetwork.start();
        // Set the event listeners
        const validatorsTopics = ['new_transaction', 'new_block_pow', 'test'];
        const minersTopics = ['new_block_proposal', 'test'];
        const topicsToSubscribe = this.role === 'validator' ? validatorsTopics : minersTopics;

        await this.syncNode.start(this.p2pNetwork);
        await this.p2pNetwork.subscribeMultipleTopics(topicsToSubscribe, this.p2pHandler.bind(this));

        console.info(`Node ${this.id.toString()}, ${this.role.toString()} started - ${loadedBlocks.length} blocks loaded`);
    }
    async stop() {
        await this.p2pNetwork.stop();
        if (this.miner) { this.miner.terminate(); }
        await this.blockchain.close();

        console.log(`Node ${this.id} (${this.role}) => stopped`);
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
                    const blocks = await this.syncNode.getMissingBlocks(this.p2pNetwork, fullAddr);
                    if (!blocks) { continue; }

                    for (const block of blocks) {
                        await this.digestFinalizedBlock(block, false);
                    }

                    break; // If successful, move to next peer
                } catch (error) {
                    console.error(`Failed to sync with peer ${fullAddr.toString()}:`, error);
                }
            }
        }
    }

    async createBlockCandidateAndBroadcast() {
        if (this.role === 'validator') {
            this.blockCandidate = await this.#createBlockCandidate();
            await this.p2pBroadcast('new_block_proposal', this.blockCandidate);
        }
    } // Work as a "init"

    /** @param {BlockData} finalizedBlock */
    async #validateBlockProposal(finalizedBlock) {
        try {
            // verify the height
            const lastBlockIndex = this.lastBlockData ? this.lastBlockData.index : -1;

            if (finalizedBlock.index > lastBlockIndex + 1) {
                console.log(`Rejected block proposal, higher index: ${finalizedBlock.index} > ${lastBlockIndex + 1}`); return false;

            }
            if (finalizedBlock.index <= lastBlockIndex) { console.log(`Rejected block proposal, older index: ${finalizedBlock.index} <= ${lastBlockIndex}`); return false; }

            // verify the hash
            const { hex, bitsArrayAsString } = await Block.getMinerHash(finalizedBlock, this.useDevArgon2);
            if (finalizedBlock.hash !== hex) { return 'Hash invalid!'; }
            const hashConfInfo = utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, finalizedBlock);
            if (!hashConfInfo.conform) { return 'Hash not conform!'; }

            // control coinBase Amount
            const coinBaseAmount = finalizedBlock.Txs[0].outputs[0].amount;
            const expectedCoinBase = Block.calculateNextCoinbaseReward(finalizedBlock);
            if (coinBaseAmount !== expectedCoinBase) { return `Invalid coinbase amount: ${coinBaseAmount} - expected: ${expectedCoinBase}`; }

            // double spend control
            Validation.isFinalizedBlockDoubleSpending(this.utxoCache.utxosByAnchor, finalizedBlock);

            // verify the transactions
            for (let i = 0; i < finalizedBlock.Txs.length; i++) {
                const tx = finalizedBlock.Txs[i];
                const isCoinBase = Transaction_Builder.isCoinBaseOrFeeTransaction(tx, i);
                const txValidation = await Validation.fullTransactionValidation(this.utxoCache.utxosByAnchor, this.memPool.knownPubKeysAddresses, tx, isCoinBase, this.useDevArgon2);
                if (!txValidation.success) {
                    const error = txValidation;
                    return `Invalid transaction: ${tx.id} - ${error}`;
                }
            }

            return hashConfInfo;
        } catch (error) {
            console.error(error);
            return false;
        }
    }
    /** @param {BlockData} finalizedBlock */
    async digestFinalizedBlock(finalizedBlock, broadcastNewCandidate = true, persistToDisk = true) {
        if (!finalizedBlock) { throw new Error('Invalid block candidate'); }
        if (this.role !== 'validator') { throw new Error('Only validator can process PoW block'); }

        //console.log(`[NODE] Processing PoW block: ${finalizedBlock.index} | ${finalizedBlock.hash}`);
        const startTime = Date.now();

        const hashConfInfo = await this.#validateBlockProposal(finalizedBlock);
        if (!hashConfInfo.conform) { return false; }

        const blockDataCloneToDigest = Block.cloneBlockData(finalizedBlock); // clone to avoid modification
        try {
            const newStakesOutputs = await this.utxoCache.digestFinalizedBlocks([blockDataCloneToDigest]);
            //console.log(`[NODE -- VALIDATOR] digestPowProposal accepted: blockIndex: ${finalizedBlock.index} | legitimacy: ${finalizedBlock.legitimacy}`);
            if (newStakesOutputs.length > 0) { this.vss.newStakes(newStakesOutputs); }
        } catch (error) {
            if (error.message !== "Invalid total of balances") { throw error; }
            console.warn(`[NODE-${this.id.slice(0, 6)}] digestPowProposal rejected: blockIndex: ${finalizedBlock.index} | legitimacy: ${finalizedBlock.legitimacy}
----------------------
|| ${error.message} || ==> Rollback UTXO cache
----------------------`);
            return false;
        }

        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.utxoCache.utxosByAnchor);
        this.memPool.digestFinalizedBlockTransactions(blockDataCloneToDigest.Txs);

        this.lastBlockData = Block.cloneBlockData(finalizedBlock);
        this.#storeConfirmedBlock(finalizedBlock); // Used by developer to check the block data manually

        await this.blockchain.addConfirmedBlocks(this.utxoCache, [finalizedBlock], persistToDisk);
        await this.blockchain.checkAndHandleReorg(this.utxoCache);

        const timeBetweenPosPow = ((finalizedBlock.timestamp - finalizedBlock.posTimestamp) / 1000).toFixed(2);
        console.info(`[NODE-${this.id.slice(0, 6)}] #${finalizedBlock.index} -> ( diff: ${hashConfInfo.difficulty} + timeAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} ) = finalDiff: ${hashConfInfo.finalDifficulty} | z: ${hashConfInfo.zeros} | a: ${hashConfInfo.adjust} | timeBetweenPosPow: ${timeBetweenPosPow}s | processProposal: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

        if (!broadcastNewCandidate) { return true; }

        this.blockCandidate = await this.#createBlockCandidate();
        await this.p2pBroadcast('new_block_proposal', this.blockCandidate);

        return true;
    }
    /** @param {BlockData} blockData */
    #storeConfirmedBlock(blockData) {
        if (blockData.index >= 1000) { return; }
        // save the block in local storage definitively
        const clone = Block.cloneBlockData(blockData); // clone to avoid modification
        localStorage_v1.saveBlockDataLocally(this.id, clone, 'json');
        localStorage_v1.saveBlockDataLocally(this.id, clone, 'bin');
    }
    async #createBlockCandidate() {
        const startTime = Date.now();
        const Txs = this.memPool.getMostLucrativeTransactionsBatch();

        // Create the block candidate, genesis block if no lastBlockData
        let blockCandidate = BlockData(0, 0, utils.blockchainSettings.blockReward, 1, 0, 'ContrastGenesisBlock', Txs, Date.now());
        if (this.lastBlockData) {
            await this.vss.calculateRoundLegitimacies(this.lastBlockData.hash);
            const myLegitimacy = this.vss.getAddressLegitimacy(this.account.address);
            if (myLegitimacy === undefined) { throw new Error(`No legitimacy for ${this.account.address}, can't create a candidate`); }

            const newDifficulty = utils.mining.difficultyAdjustment(this.utxoCache.blockMiningData);
            const clone = Block.cloneBlockData(this.lastBlockData);
            const coinBaseReward = Block.calculateNextCoinbaseReward(clone);
            blockCandidate = BlockData(this.lastBlockData.index + 1, clone.supply + clone.coinBase, coinBaseReward, newDifficulty, myLegitimacy, clone.hash, Txs, Date.now());
        }

        const posFeeTx = await Transaction_Builder.createPosRewardTransaction(blockCandidate, this.account.address, this.account.address);
        const signedPosFeeTx = await this.account.signTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);

        if (blockCandidate.Txs.length > 3) console.info(`(Height:${blockCandidate.index}) => ${blockCandidate.Txs.length} txs, block candidate created in ${(Date.now() - startTime)}ms`);

        return blockCandidate;
    }

    /**
     * @param {string} topic
     * @param {object} message
     */
    async p2pHandler(topic, message) { // TODO: optimize this by using specific compression serialization
        const data = message;
        try {
            switch (topic) {
                case 'new_transaction':
                    if (this.role !== 'validator') { break; }
                    this.taskStack.push('pushTransaction', {
                        utxosByAnchor: this.utxoCache.utxosByAnchor,
                        transaction: data // signedTransaction
                    });
                    break;
                case 'new_block_proposal':
                    if (this.role !== 'miner') { break; }
                    this.miner.pushCandidate(data);
                    break;
                case 'new_block_pow':
                    if (this.role !== 'validator') { break; }
                    /*const rnd = Math.floor(Math.random() * 51);
                    if (rnd === 50) { console.warn(`[NODE-${this.id.slice(0,6)}] incomming new_block_pow rejected`); break; }*/
                    const lastBlockIndex = this.lastBlockData === null ? 0 : this.lastBlockData.index;
                    if (data.index === 0 || lastBlockIndex + 1 >= data.index) { this.taskStack.push('digestPowProposal', data); break; }

                    // if we are late, we ask for the missing blocks by p2p streaming
                    this.taskStack.push('syncWithKnownPeers', null, true);
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
            role: this.role,
            currentBlockHeight: this.blockchain.currentHeight,
            memPoolSize: Object.keys(this.memPool.transactionsByID).length,
            peerCount: this.p2pNetwork.getConnectedPeers().length,
        };
    }
}