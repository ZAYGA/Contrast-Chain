import { hash } from 'argon2';
import { BlockData, BlockUtils } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import utils from './utils.mjs';

/**
 * @typedef {import("./account.mjs").Account} Account
 * @typedef {import("./p2p.mjs").P2PNetwork} P2PNetwork
 * @typedef {import("./taskQueue.mjs").TaskQueue} TaskQueue
 * @typedef {import("./websocketCallback.mjs").WebSocketCallBack} WebSocketCallBack
 */

export class Miner {
    /**
     * @param {Account} address
     * @param {P2PNetwork} p2pNetwork
     */
    constructor(address, p2pNetwork, roles = ['miner'], taskQueue = null) {
        /** @type {string} */
        this.address = address;
        /** @type {BlockData[]} */
        this.candidates = [];
        /** @type {P2PNetwork} */
        this.p2pNetwork = p2pNetwork;

        this.highestBlockIndex = -1;
        this.useDevArgon2 = false;
        /** @type {Worker[]} */
        this.workers = [];
        this.nbOfWorkers = 1;

        /** @type {Object<string, number>} */
        this.bets = {};
        /** @type {{min: number, max: number}} */
        this.betRange = { min: .4, max: .8 }; // will bet between 40% and 80% of the expected blockTime
        /** @type {BlockData | null} */
        this.preshotedPowBlock = null;

        this.roles = roles;
        this.canProceedMining = true;
        this.hashTimings = [];
        this.hashRate = 0; // hash rate in H/s
        /** @type {TaskQueue} */
        this.taskQueue = taskQueue; // only for multiNode (validator + miner)

        /** @type {Object<string, WebSocketCallBack>} */
        this.wsCallbacks = {};
    }
    /** @param {BlockData} blockCandidate */
    async #prepareBlockCandidateBeforeMining(blockCandidate) {
        const clonedCandidate = BlockUtils.cloneBlockData(blockCandidate);

        const headerNonce = utils.mining.generateRandomNonce().Hex;
        const coinbaseNonce = utils.mining.generateRandomNonce().Hex;
        clonedCandidate.nonce = headerNonce;
        clonedCandidate.timestamp = Math.max(clonedCandidate.posTimestamp + 1 + this.bets[clonedCandidate.index], Date.now());

        const powReward = blockCandidate.powReward;
        delete clonedCandidate.powReward;
        const coinbaseTx = await Transaction_Builder.createCoinbase(coinbaseNonce, this.address, powReward);
        BlockUtils.setCoinbaseTransaction(clonedCandidate, coinbaseTx);

        const signatureHex = await BlockUtils.getBlockSignature(clonedCandidate);
        const nonce = `${headerNonce}${coinbaseNonce}`;

        return { signatureHex, nonce, clonedCandidate };
    }
    /**
     * @param {BlockData} blockCandidate
     * @param {boolean} useBetTimestamp
     */
    pushCandidate(blockCandidate, useBetTimestamp = true) {
        const index = this.candidates.findIndex(candidate => candidate.index === blockCandidate.index && candidate.legitimacy === blockCandidate.legitimacy);
        if (index !== -1) { return; }

        // check if powReward is coherent
        const posReward = blockCandidate.Txs[0].outputs[0].amount;
        const powReward = blockCandidate.powReward;
        if (!posReward || !powReward) { console.info(`[MINER] Invalid block candidate pushed (Height: ${blockCandidate.index}) | posReward = ${posReward} | powReward = ${powReward}`); return; }
        if (Math.abs(posReward - powReward) > 1) { console.info(`[MINER] Invalid block candidate pushed (Height: ${blockCandidate.index}) | posReward = ${posReward} | powReward = ${powReward} | Math.abs(posReward - powReward) > 1`); return; }

        // check if block is higher than the highest block
        if (blockCandidate.index > this.highestBlockIndex) {
            this.preshotedPowBlock = null; // reset preshoted block
            this.bets[blockCandidate.index] = useBetTimestamp ? this.#betOnTimeToPow(blockCandidate.index) : 0; // bet on time to pow
            this.highestBlockIndex = blockCandidate.index;
            this.#cleanupCandidates();
        }
        //console.info(`[MINER] New block candidate pushed (Height: ${blockCandidate.index}) | Diff = ${blockCandidate.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(blockCandidate.coinBase)}`);
        this.candidates.push(blockCandidate);
    }
    #betOnTimeToPow() {
        const targetBlockTime = utils.SETTINGS.targetBlockTime;
        const betBasis = targetBlockTime * this.betRange.min;
        const betRandom = Math.random() * (this.betRange.max - this.betRange.min) * targetBlockTime;
        const bet = betBasis + betRandom;

        return Math.floor(bet);
    }
    #cleanupCandidates(heightTolerance = 6) {
        // remove candidates with height tolerance, to avoid memory leak
        this.candidates = this.candidates.filter(candidate => this.highestBlockIndex - candidate.index <= heightTolerance);
    }
    #getMostLegitimateBlockCandidate() {
        if (this.candidates.length === 0) { return null; }

        const filteredCandidates = this.candidates.filter(candidate => candidate.index === this.highestBlockIndex);
        // the lower the legitimacy, the more legitimate the block is, 0 is the most legitimate
        const sortedCandidates = filteredCandidates.sort((a, b) => a.legitimacy - b.legitimacy);
        return sortedCandidates[0];
    }
    /** @param {number} hashTime - ms */
    #hashRateNew(hashTime = 50, hashBeforeAveraging = 20) {
        this.hashTimings.push(hashTime);
        if (this.hashTimings.length < hashBeforeAveraging - 1) { return; } // wait for 10 hash timings to be collected

        const hashRate = 1000 / (this.hashTimings.reduce((acc, timing) => acc + timing, 0) / this.hashTimings.length);
        this.hashRate = hashRate;
        this.hashTimings = [];
        if (this.wsCallbacks.onHashRateUpdated) { this.wsCallbacks.onHashRateUpdated.execute(hashRate); }
    }
    /** @param {BlockData} finalizedBlock */
    async #broadcastBlockCandidate(finalizedBlock) {
        console.info(`[MINER] SENDING: Block finalized (Height: ${finalizedBlock.index}) | Diff = ${finalizedBlock.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(finalizedBlock.coinBase)}`);
        if (this.roles.includes('validator')) { this.taskQueue.push('digestPowProposal', finalizedBlock); };
        await this.p2pNetwork.broadcast('new_block_finalized', finalizedBlock);
        if (this.wsCallbacks.onBroadcastFinalizedBlock) { this.wsCallbacks.onBroadcastFinalizedBlock.execute(BlockUtils.getBlockHeader(finalizedBlock)); }
    }
    #createMissingWorkers(workersStatus = []) {
        const missingWorkers = this.nbOfWorkers - this.workers.length;

        for (let i = 0; i < missingWorkers; i++) {
            const worker = utils.newWorker('../workers/miner-worker-nodejs.mjs');
            worker.on('message', (message) => {
                try {
                    if (message.error) { throw new Error(message.error); }
                    const finalizedBlock = message.blockCandidate;
                    const { conform } = utils.mining.verifyBlockHashConformToDifficulty(message.bitsArrayAsString, finalizedBlock);
                    if (!conform) { workersStatus[message.id] = 'free'; return; }

                    if (finalizedBlock.timestamp <= Date.now()) { // if block is ready to be broadcasted
                        this.#broadcastBlockCandidate(finalizedBlock);
                    } else { // if block is not ready to be broadcasted (pre-shoted)
                        this.preshotedPowBlock = finalizedBlock;
                        this.bets[finalizedBlock.index] = 1; // avoid betting on the same block
                    }
                } catch (err) {
                    console.error(err);
                }
                workersStatus[message.id] = 'free';
            });
            worker.on('exit', (code) => { console.log(`Worker stopped with exit code ${code}`); });

            this.workers.push(worker);
            workersStatus.push('free');
            console.log(`Worker ${this.workers.length} started`);
        }
    }
    /** DON'T AWAIT THIS FUNCTION */
    async startWithWorker() {
        const workersStatus = [];
        let lastHashTime = Date.now();
        while (true) {
            const delayBetweenMining = this.roles.includes('validator') ? 2 : 1;
            await new Promise((resolve) => setTimeout(resolve, delayBetweenMining));

            const preshotedPowReadyToSend = this.preshotedPowBlock ? this.preshotedPowBlock.timestamp <= Date.now() : false;
            if (preshotedPowReadyToSend) {
                this.#broadcastBlockCandidate(this.preshotedPowBlock);
                this.preshotedPowBlock = null;
            }

            if (!this.canProceedMining) { continue; }

            this.#createMissingWorkers(workersStatus);
            const usableWorkersStatus = workersStatus.slice(0, this.nbOfWorkers);
            const id = usableWorkersStatus.indexOf('free');
            if (id === -1) { continue; }

            const blockCandidate = this.#getMostLegitimateBlockCandidate();
            if (!blockCandidate) { continue; }

            this.#hashRateNew(Date.now() - lastHashTime);
            lastHashTime = Date.now();
            workersStatus[id] = 'busy';

            const { signatureHex, nonce, clonedCandidate } = await this.#prepareBlockCandidateBeforeMining(blockCandidate);
            this.workers[id].postMessage({ type: 'mine', blockCandidate: clonedCandidate, signatureHex, nonce, id, useDevArgon2: this.useDevArgon2 });
        }
    }
    terminate() {
        for (let i = 0; i < this.workers.length; i++) {
            this.workers[i].terminate();
        }
    }
}