import utils from './utils.mjs';
import { HashFunctions } from './conCrypto.mjs';
import {Transaction_Builder, Validation } from './index.mjs';


export const BlockData = (index, supply, coinBase, difficulty, prevHash, Txs, timestamp, hash, nonce) => {
    return {
        index: index,
        supply: supply,
        coinBase: coinBase,
        difficulty: difficulty,
        prevHash: prevHash,
        
        // Proof of work dependent
        timestamp: timestamp,
        hash: hash,
        nonce: nonce,

        Txs: Txs
    };
}
export class Block {
    /** @param {BlockData} blockData */
    static getBlockStringToHash(blockData) {
        const txsIDStrArray = blockData.Txs.map(tx => tx.id).filter(id => id);
        const txsIDStr = txsIDStrArray.join('');

        const signatureStr = `${blockData.prevHash}${blockData.index}${blockData.supply}${blockData.difficulty}${txsIDStr}${blockData.coinBase}`;
        return utils.convert.string.toHex(signatureStr);
    }
    /** @param {BlockData} blockData */
    static async calculateHash(blockData) {
        const blockSignatureHex = Block.getBlockStringToHash(blockData);
        const newBlockHash = await utils.mining.hashBlockSignature(HashFunctions.Argon2, blockSignatureHex, blockData.nonce);
        if (!newBlockHash) { throw new Error('Invalid block hash'); }

        return { hex: newBlockHash.hex, bitsArrayAsString: newBlockHash.bitsArray.join('') };
    }
    /** @param {BlockData} blockData */
    static async calculateValidatorHash(blockData) {
        const txsIDStrArray = blockData.Txs.map(tx => tx.id).filter(id => id);
        const txsIDStr = txsIDStrArray.join('');

        const signatureStr = `${blockData.prevHash}${blockData.index}${blockData.supply}${blockData.difficulty}${txsIDStr}${blockData.coinBase}`;
        const signatureHex = utils.convert.string.toHex(signatureStr);

        const validatorHash = await HashFunctions.SHA256(signatureHex);
        return validatorHash;
    }
    /**
     * @param {BlockData} blockData
     * @param {Transaction} coinbaseTx
     */
    static setCoinbaseTransaction(blockData, coinbaseTx) {
        if (Transaction_Builder.isCoinBaseOrFeeTransaction(coinbaseTx, 0) === false) { console.error('Invalid coinbase transaction'); return false; }

        Block.removeExistingCoinbaseTransaction(blockData);
        blockData.Txs.unshift(coinbaseTx);
    }
    /** @param {BlockData} blockData */
    static removeExistingCoinbaseTransaction(blockData) {
        if (blockData.Txs.length === 0) { return; }

        const secondTx = blockData.Txs[1]; // if second tx isn't fee Tx : there is no coinbase
        if (!secondTx || !Transaction_Builder.isCoinBaseOrFeeTransaction(secondTx, 1)) { return; }

        const firstTx = blockData.Txs[0];
        if (firstTx && Transaction_Builder.isCoinBaseOrFeeTransaction(firstTx, 0)) { blockData.Txs.shift(); }
    }
    /** @param {BlockData} blockData - undefined if genesis block */
    static calculateNextCoinbaseReward(blockData) {
        if (!blockData) { throw new Error('Invalid blockData'); }

        const halvings = Math.floor( (blockData.index + 1) / utils.blockchainSettings.halvingInterval );
        const coinBase = Math.max( utils.blockchainSettings.blockReward / Math.pow(2, halvings), utils.blockchainSettings.minBlockReward );

        const maxSupplyWillBeReached = blockData.supply + coinBase >= utils.blockchainSettings.maxSupply;
        return maxSupplyWillBeReached ? utils.blockchainSettings.maxSupply - blockData.supply : coinBase;
    }
    /** @param {Transaction[]} Txs */
    static calculateTxsTotalFees(Txs) {
        // TODO - calculate the fee
        const fees = [];
        for (let i = 0; i < Txs.length; i++) {
            const Tx = Txs[i];
            const fee = Validation.calculateRemainingAmount(Tx, Transaction_Builder.isCoinBaseOrFeeTransaction(Tx, i));

            fees.push(fee);
        }

        const totalFees = fees.reduce((a, b) => a + b, 0);
        return totalFees;
    }
    /** @param {BlockData} blockData */
    static dataAsJSON(blockData) {
        return JSON.stringify(blockData);
    }
    /** @param {string} blockDataJSON */
    static blockDataFromJSON(blockDataJSON) {
        const parsed = JSON.parse(blockDataJSON);
        //const Txs = Block.TransactionsFromJSON(parsed.Txs);
        /** @type {BlockData} */
        return BlockData(parsed.index, parsed.supply, parsed.coinBase, parsed.difficulty, parsed.prevHash, parsed.Txs, parsed.timestamp, parsed.hash, parsed.nonce);
    }
    /** @param {BlockData} blockData */
    static cloneBlockData(blockData) {
        const JSON = Block.dataAsJSON(blockData);
        return Block.blockDataFromJSON(JSON);
    }
}