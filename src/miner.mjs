import { BlockData, Block } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import utils from './utils.mjs';

/**
 * @typedef {import("./account.mjs").Account} Account
 */

export class Miner {
    /** 
     * @param {Account} minerAccount
     * @param {Function} validPowCallback
     */
    constructor(minerAccount, validPowCallback) {
        /** @type {Account} */
        this.minerAccount = minerAccount;
        /** @type {BlockData[]} */
        this.candidates = [];
        /** @type {Function} */
        this.validPowCallback = validPowCallback;

        this.highestBlockIndex = 0;
        this.devmode = false;
    }

    /** @param {BlockData} blockCandidate */
    async minePow(blockCandidate) { // Will probably DEPRECATE
        await this.prepareBlockCandidateBeforeMining(blockCandidate);
        const { hex, bitsArrayAsString } = await Block.getMinerHash(blockCandidate, this.devmode);
        utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, blockCandidate); // throw error if not conform

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
        this.candidates.push(blockCandidate);
    }
    cleanupCandidates(heightTolerance = 3) {
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

    // logic is a bit complex, but it avoid stack overflow
    async startWithWorker(nbOfWorkers = 1) {
        const workers = [];
        const workersStatus = [];
        for (let i = 0; i < nbOfWorkers; i++) {
            const worker = utils.newWorker('./worker-nodejs.mjs');
            worker.on('message', (message) => {
                if (message.error) { throw new Error(message.error); }
                try {
                    utils.mining.verifyBlockHashConformToDifficulty(message.bitsArrayAsString, message.blockCandidate);
                    this.validPowCallback(message.blockCandidate);
                } catch (error) {
                    let errorToSkip = error.message.slice(0, 7) === 'unlucky';
                    if (!errorToSkip) { console.error(error); }
                }
                workersStatus[message.id] = 'free';
            });
            worker.on('exit', (code) => {
                console.log(`Worker stopped with exit code ${code}`);
            });

            workers.push(worker);
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
            workers[id].postMessage({ type: 'mine', blockCandidate, signatureHex, nonce, id, devmode: this.devmode });
        }
    }
}