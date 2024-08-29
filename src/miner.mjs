import { BlockData, Block } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import utils from './utils.mjs';

/**
 * @typedef {import("./account.mjs").Account} Account
 */

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

        const nonce = `${headerNonce.Hex}${coinbaseNonce.Hex}`;
        const coinbaseTx = await Transaction_Builder.createCoinbaseTransaction(nonce, minerAddress, blockCandidate.coinBase);

        blockCandidate.timestamp = Date.now();
        blockCandidate.nonce = headerNonce.Hex;
        Block.setCoinbaseTransaction(blockCandidate, coinbaseTx);

        const { hex, bitsArrayAsString } = await Block.getMinerHash(blockCandidate);
        utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, blockCandidate); // trhow error if not conform

        blockCandidate.hash = hex;
        //console.log(`[MINER] POW -> (Height: ${blockCandidate.index}) | Diff = ${blockCandidate.difficulty} | coinBase = ${utils.convert.number.formatNumberAsCurrency(blockCandidate.coinBase)}`);

        return { validBlockCandidate: blockCandidate};
    }
}