import { BlockData, Block } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import utils from './utils.mjs';

/**
 * @typedef {import("./account.mjs").Account} Account
 * @typedef {import("./p2p.mjs").P2PNetwork} P2PNetwork
 */

export class Miner {
    /**
     * @param {Account} minerAccount
     * @param {P2PNetwork} p2pNetwork
     */
    constructor(minerAccount, p2pNetwork) {
        /** @type {Account} */
        this.minerAccount = minerAccount;
        /** @type {BlockData[]} */
        this.candidates = [];
        /** @type {P2PNetwork} */
        this.p2pNetwork = p2pNetwork;

        this.highestBlockIndex = -1;
        this.useDevArgon2 = false;
        /** @type {Worker[]} */
        this.workers = [];

        /** @type {Object<string, number>} */
        this.bets = {};
        /** @type {{min: number, max: number}} */
        this.betRange = {min: .4, max: .8}; // will bet between 40% and 80% of the expected blockTime
        /** @type {BlockData | null} */
        this.preshotedPowBlock = null;
    }
    /** @param {BlockData} blockCandidate */
    async #prepareBlockCandidateBeforeMining(blockCandidate) {
        const headerNonce = utils.mining.generateRandomNonce().Hex;
        const coinbaseNonce = utils.mining.generateRandomNonce().Hex;
        blockCandidate.nonce = headerNonce;
        blockCandidate.timestamp = Math.max(blockCandidate.posTimestamp + 1 + this.bets[blockCandidate.index], Date.now());

        const { powReward, posReward } = Block.calculateBlockReward(blockCandidate);
        const coinbaseTx = await Transaction_Builder.createCoinbaseTransaction(coinbaseNonce, this.minerAccount.address, powReward);
        Block.setCoinbaseTransaction(blockCandidate, coinbaseTx);

        const signatureHex = await Block.getBlockSignature(blockCandidate);
        const nonce = `${headerNonce}${coinbaseNonce}`;

        return { signatureHex, nonce };
    }
    /** 
     * @param {BlockData} blockCandidate
     * @param {boolean} useBetTimestamp
     */
    pushCandidate(blockCandidate, useBetTimestamp = true) {
        const index = this.candidates.findIndex(candidate => candidate.index === blockCandidate.index && candidate.legitimacy === blockCandidate.legitimacy);
        if (index !== -1) { return; }

        if (blockCandidate.index > this.highestBlockIndex) {
            this.preshotedPowBlock = null; // reset preshoted block
            this.bets[blockCandidate.index] = useBetTimestamp ? this.#betOnTimeToPow(blockCandidate.index) : 0; // bet on time to pow
            this.highestBlockIndex = blockCandidate.index;
            this.#cleanupCandidates();
        }
        //console.warn(`[MINER] New block candidate pushed (Height: ${blockCandidateClone.index}) | Diff = ${blockCandidateClone.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(blockCandidateClone.coinBase)}`);
        //const blockCandidateClone = Block.cloneBlockData(blockCandidate);
        this.candidates.push(blockCandidate);
    }
    #betOnTimeToPow() {
        const targetBlockTime = utils.blockchainSettings.targetBlockTime;
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
    /** DON'T AWAIT THIS FUNCTION */
    async startWithWorker(nbOfWorkers = 1) {
        const workersStatus = [];
        for (let i = 0; i < nbOfWorkers; i++) {
            const worker = utils.newWorker('../workers/miner-worker-nodejs.mjs');
            worker.on('message', (message) => {
                try {
                    if (message.error) { throw new Error(message.error); }
                    const { conform } = utils.mining.verifyBlockHashConformToDifficulty(message.bitsArrayAsString, message.blockCandidate);
                    if (!conform) { workersStatus[message.id] = 'free'; return; }

                    if (message.blockCandidate.timestamp <= Date.now()) { // if block is ready to be broadcasted
                        this.p2pNetwork.broadcast('new_block_pow', message.blockCandidate);
                    } else { // if block is not ready to be broadcasted (pre-shoted)
                        this.preshotedPowBlock = message.blockCandidate;
                        this.bets[message.blockCandidate.index] = 1; // avoid betting on the same block
                    }
                } catch (err) {
                    console.error(err);
                }
                workersStatus[message.id] = 'free';
            });
            worker.on('exit', (code) => { console.log(`Worker stopped with exit code ${code}`); });

            this.workers.push(worker);
            workersStatus.push('free');
            console.log('Worker started');
        }

        while (true) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            const preshotedPowReadyToSend = this.preshotedPowBlock ? this.preshotedPowBlock.timestamp <= Date.now() : false;
            if (preshotedPowReadyToSend) {
                this.p2pNetwork.broadcast('new_block_pow', this.preshotedPowBlock)
                this.preshotedPowBlock = null;
            }

            const id = workersStatus.indexOf('free');
            if (id === -1) { continue; }

            const blockCandidate = this.#getMostLegitimateBlockCandidate();
            if (!blockCandidate) { continue; }

            workersStatus[id] = 'busy';

            const { signatureHex, nonce } = await this.#prepareBlockCandidateBeforeMining(blockCandidate);
            this.workers[id].postMessage({ type: 'mine', blockCandidate, signatureHex, nonce, id, useDevArgon2: this.useDevArgon2 });
        }
    }
    terminate() {
        for (let i = 0; i < this.workers.length; i++) {
            this.workers[i].terminate();
        }
    }
}