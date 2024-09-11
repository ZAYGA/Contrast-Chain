import utils from './utils.mjs';
import { HashFunctions } from './conCrypto.mjs';
import { Transaction_Builder } from './transaction.mjs';
import { TxValidation } from './validation.mjs';

/**
* @typedef {Object} BlockMiningData
* @property {number} index - The block height
* @property {number} difficulty - The difficulty of the block
* @property {number} timestamp - The timestamp of the block
* @property {number} posTimestamp - The timestamp of the block's creation
*/
/**
* @param {number} index - The block height
* @param {number} difficulty - The difficulty of the block
* @param {number} timestamp - The timestamp of the block
* @param {number} posTimestamp - The timestamp of the block's creation
* @returns {BlockMiningData}
 */
export const BlockMiningData = (index, difficulty, timestamp, posTimestamp) => {
    return {
        index,
        difficulty,
        timestamp,
        posTimestamp
    };
}

/**
* @typedef {Object} BlockData
* @property {number} index - The index of the block
* @property {number} supply - The total supply before the coinbase reward
* @property {number} coinBase - The coinbase reward
* @property {number} difficulty - The difficulty of the block
* @property {number} legitimacy - The legitimacy of the validator who created the block candidate
* @property {string} prevHash - The hash of the previous block
* @property {Transaction[]} Txs - The transactions in the block
* @property {number} posTimestamp - The timestamp of the block creation
* @property {number | undefined} timestamp - The timestamp of the block
* @property {string | undefined} hash - The hash of the block
* @property {number | undefined} nonce - The nonce of the block
* @property {number | undefined} powReward - The reward for the proof of work (only in candidate)
*/
/**
 * @param {number} index - The index of the block
 * @param {number} supply - The total supply before the coinbase reward
 * @param {number} coinBase - The coinbase reward
 * @param {number} difficulty - The difficulty of the block
 * @param {string} prevHash - The hash of the previous block
 * @param {Transaction[]} Txs - The transactions in the block
 * @param {number | undefined} timestamp - The timestamp of the block
 * @param {string | undefined} hash - The hash of the block
 * @param {number | undefined} nonce - The nonce of the block
 * @returns {BlockData}
 */
export const BlockData = (index, supply, coinBase, difficulty, legitimacy, prevHash, Txs, posTimestamp, timestamp, hash, nonce) => {
    return {
        index,
        supply,
        coinBase,
        difficulty,
        legitimacy,
        prevHash,

        // Proof of stake dependent
        posTimestamp, // timestamp of the block's creation
        
        // Proof of work dependent
        timestamp, // timestamp of the block's confirmation
        hash,
        nonce,
        
        Txs
    };
}
export class BlockUtils {
    /** 
     * @param {BlockData} blockData
     * @param {boolean} excludeCoinbaseAndPos
     */
    static async getBlockTxsHash(blockData, excludeCoinbaseAndPos = false) {
        const txsIDStrArray = blockData.Txs.map(tx => tx.id).filter(id => id);

        let firstTxIsCoinbase = blockData.Txs[0] ? Transaction_Builder.isMinerOrValidatorTx(blockData.Txs[0]) : false;
        if (excludeCoinbaseAndPos && firstTxIsCoinbase) { txsIDStrArray.shift(); }
        firstTxIsCoinbase = blockData.Txs[0] ? Transaction_Builder.isMinerOrValidatorTx(blockData.Txs[0]) : false;
        if (excludeCoinbaseAndPos && firstTxIsCoinbase) { txsIDStrArray.shift(); }

        const txsIDStr = txsIDStrArray.join('');
        return await HashFunctions.SHA256(txsIDStr);
    };
    /**
     * @param {BlockData} blockData
     * @param {boolean} isPosHash - if true, exclude coinbase/pos Txs and blockTimestamp
     * @returns {Promise<string>} signature Hex
     */
    static async getBlockSignature(blockData, isPosHash = false) {
        const txsHash = await this.getBlockTxsHash(blockData, isPosHash);
        const { index, supply, coinBase, difficulty, legitimacy, prevHash, posTimestamp } = blockData;
        let signatureStr = `${index}${supply}${coinBase}${difficulty}${legitimacy}${prevHash}${posTimestamp}${txsHash}`;
        if (!isPosHash) { signatureStr += blockData.timestamp; }

        return await HashFunctions.SHA256(signatureStr);
    }
    /** @param {BlockData} blockData */
    static async getMinerHash(blockData, useDevArgon2 = false) {
        if (typeof blockData.Txs[0].inputs[0] !== 'string') { throw new Error('Invalid coinbase nonce'); }
        const signatureHex = await this.getBlockSignature(blockData);

        const headerNonce = blockData.nonce;
        const coinbaseNonce = blockData.Txs[0].inputs[0];
        const nonce = `${headerNonce}${coinbaseNonce}`;

        const argon2Fnc = useDevArgon2 ? HashFunctions.devArgon2 : HashFunctions.Argon2;
        const blockHash = await utils.mining.hashBlockSignature(argon2Fnc, signatureHex, nonce);
        if (!blockHash) { throw new Error('Invalid block hash'); }

        return { hex: blockHash.hex, bitsArrayAsString: blockHash.bitsArray.join('') };
    }
    /**
     * @param {BlockData} blockData
     * @param {Transaction} coinbaseTx
     */
    static setCoinbaseTransaction(blockData, coinbaseTx) {
        if (Transaction_Builder.isMinerOrValidatorTx(coinbaseTx) === false) { console.error('Invalid coinbase transaction'); return false; }

        this.removeExistingCoinbaseTransaction(blockData);
        blockData.Txs.unshift(coinbaseTx);
    }
    /** @param {BlockData} blockData */
    static removeExistingCoinbaseTransaction(blockData) {
        if (blockData.Txs.length === 0) { return; }

        const secondTx = blockData.Txs[1]; // if second tx isn't fee Tx : there is no coinbase
        if (!secondTx || !Transaction_Builder.isMinerOrValidatorTx(secondTx)) { return; }

        const firstTx = blockData.Txs[0];
        if (firstTx && Transaction_Builder.isMinerOrValidatorTx(firstTx)) { blockData.Txs.shift(); }
    }
    /**
     * @param {Object<string, UTXO>} utxosByAnchor
     * @param {Transaction[]} Txs 
     */
    static calculateTxsTotalFees(utxosByAnchor, Txs) {
        const fees = [];
        for (let i = 0; i < Txs.length; i++) {
            const Tx = Txs[i];
            if (Transaction_Builder.isMinerOrValidatorTx(Tx)) { continue; }

            const fee = TxValidation.calculateRemainingAmount(utxosByAnchor, Tx);
            fees.push(fee);
        }

        const totalFees = fees.reduce((a, b) => a + b, 0);
        return totalFees;
    }
    /** 
     * @param {Object<string, UTXO>} utxosByAnchor
     * @param {BlockData} blockData
     */
    static calculateBlockReward(utxosByAnchor, blockData) {
        const totalFees = this.calculateTxsTotalFees(utxosByAnchor, blockData.Txs);
        const totalReward = totalFees + blockData.coinBase;
        const powReward = Math.floor(totalReward / 2);
        const posReward = totalReward - powReward;

        return { powReward, posReward };
    }
    /** @param {BlockData} blockData */
    static dataAsJSON(blockData) {
        return JSON.stringify(blockData);
    }
    /** @param {string} blockDataJSON */
    static blockDataFromJSON(blockDataJSON) {
        if (!blockDataJSON) { throw new Error('Invalid blockDataJSON'); }
        if (typeof blockDataJSON !== 'string') { throw new Error('Invalid blockDataJSON'); }

        const parsed = JSON.parse(blockDataJSON);
        const { index, supply, coinBase, difficulty, legitimacy, prevHash, Txs, posTimestamp, timestamp, hash, nonce } = parsed;
        return BlockData(index, supply, coinBase, difficulty, legitimacy, prevHash, Txs, posTimestamp, timestamp, hash, nonce);
    }
    /** @param {BlockData} blockData */
    static cloneBlockData(blockData) {
        const JSON = this.dataAsJSON(blockData);
        return this.blockDataFromJSON(JSON);
    }
}