import utils from './utils.mjs';
import { BlockData, Block, Account, Transaction_Builder } from './index.mjs';

export class Miner {
    /** @param {Account} minerAccount */
    constructor(minerAccount) {
        /** @type {Account} */
        this.minerAccount = minerAccount;
    }

    /** @param {BlockData} blockCandidate */
    async minePow(blockCandidate) {
        const headerNonce = utils.mining.generateRandomNonce();
        const coinbaseNonce = utils.mining.generateRandomNonce();
        const minerAddress = this.minerAccount.address;

        const coinbaseTx = Transaction_Builder.createCoinbaseTransaction(coinbaseNonce.Hex, minerAddress, blockCandidate.coinBase);
        coinbaseTx.id = await Transaction_Builder.hashTxToGetID(coinbaseTx);

        blockCandidate.timestamp = Date.now();
        blockCandidate.nonce = headerNonce.Hex;
        Block.setCoinbaseTransaction(blockCandidate, coinbaseTx);

        const { hex, bitsArrayAsString } = await Block.calculateHash(blockCandidate);
        utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, blockCandidate.difficulty);

        blockCandidate.hash = hex;
        console.log(`POW -> [index:${blockCandidate.index}] | Diff = ${blockCandidate.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(blockCandidate.coinBase)}`);

        return { validBlockCandidate: blockCandidate};
    }
}