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

        this.highestBlockIndex = 0;
        this.useDevArgon2 = false;
        /** @type {Worker[]} */
        this.workers = [];
    }

    /** @param {BlockData} blockCandidate */
    async minePow(blockCandidate) { // Will probably DEPRECATE
        await this.prepareBlockCandidateBeforeMining(blockCandidate);
        const { hex, bitsArrayAsString } = await Block.getMinerHash(blockCandidate, this.useDevArgon2);
        const { conform } = utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, blockCandidate);
        if (!conform) { throw new Error('Block hash does not conform to difficulty'); }

        blockCandidate.hash = hex;
        //console.log(`[MINER] POW -> (Height: ${blockCandidate.index}) | Diff = ${blockCandidate.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(blockCandidate.coinBase)}`);

        return { validBlockCandidate: blockCandidate };
    }

    async prepareBlockCandidateBeforeMining(blockCandidate) {
        const headerNonce = utils.mining.generateRandomNonce().Hex;
        const coinbaseNonce = utils.mining.generateRandomNonce().Hex;
        blockCandidate.nonce = headerNonce;
        blockCandidate.timestamp = Date.now();

        const coinbaseTx = await Transaction_Builder.createCoinbaseTransaction(coinbaseNonce, this.minerAccount.address, blockCandidate.coinBase);
        Block.setCoinbaseTransaction(blockCandidate, coinbaseTx);

        const signatureHex = await Block.getBlockSignature(blockCandidate);
        const nonce = `${headerNonce}${coinbaseNonce}`;

        return { signatureHex, nonce };
    }
    /** @param {BlockData} blockCandidate */
    pushCandidate(blockCandidate) {
        const index = this.candidates.findIndex(candidate => candidate.index === blockCandidate.index && candidate.legitimacy === blockCandidate.legitimacy);
        if (index !== -1) { return; }

        if (blockCandidate.index > this.highestBlockIndex) {
            this.highestBlockIndex = blockCandidate.index;
            this.cleanupCandidates();
        }
        //console.warn(`[MINER] New block candidate pushed (Height: ${blockCandidateClone.index}) | Diff = ${blockCandidateClone.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(blockCandidateClone.coinBase)}`);
        const blockCandidateClone = Block.cloneBlockData(blockCandidate);
        this.candidates.push(blockCandidateClone);
    }
    cleanupCandidates(heightTolerance = 6) {
        // remove candidates with height tolerance, to avoid memory leak
        this.candidates = this.candidates.filter(candidate => this.highestBlockIndex - candidate.index <= heightTolerance);
    }
    getMostLegitimateBlockCandidate() {
        if (this.candidates.length === 0) { return null; }

        const filteredCandidates = this.candidates.filter(candidate => candidate.index === this.highestBlockIndex);
        // the lower the legitimacy, the more legitimate the block is, 0 is the most legitimate
        const sortedCandidates = filteredCandidates.sort((a, b) => a.legitimacy - b.legitimacy);
        return sortedCandidates[0];
    }

    async startWithWorker(nbOfWorkers = 1) {
        const workersStatus = [];
        for (let i = 0; i < nbOfWorkers; i++) {

            const worker = utils.newWorker('../workers/miner-worker-nodejs.mjs');
            worker.on('message', (message) => {
                try {
                    if (message.error) { throw new Error(message.error); }
                    const { conform } = utils.mining.verifyBlockHashConformToDifficulty(message.bitsArrayAsString, message.blockCandidate);
            
                    if (conform) { 
                        this.p2pNetwork.broadcast('new_block_pow', message.blockCandidate); }
                    workersStatus[message.id] = 'free';
                } catch (err) {
                    console.error(err);
                }
            });
            worker.on('exit', (code) => { console.log(`Worker stopped with exit code ${code}`); });

            this.workers.push(worker);
            workersStatus.push('free');
            console.log('Worker started');
        }

        while (true) {
            await new Promise((resolve) => setTimeout(resolve, 1));
            const id = workersStatus.indexOf('free');

            if (id === -1) { continue; }

            const blockCandidate = this.getMostLegitimateBlockCandidate();
            if (!blockCandidate) { continue; }

            workersStatus[id] = 'busy';

            const { signatureHex, nonce } = await this.prepareBlockCandidateBeforeMining(blockCandidate);
            this.workers[id].postMessage({ type: 'mine', blockCandidate, signatureHex, nonce, id, useDevArgon2: this.useDevArgon2 });
        }
    }
    terminate() {
        for (let i = 0; i < this.workers.length; i++) {
            this.workers[i].terminate();
        }
    }
}