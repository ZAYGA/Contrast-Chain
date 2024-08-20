'use strict';

import { HashFunctions, AsymetricFunctions } from './conCrypto.mjs';
import storage from "./storage.mjs";
import utils from './utils.mjs';

export class AddressTypeInfo {
    name = '';
    description = '';
    zeroBits = 0;
    nbOfSigners = 1;
}

/**
* @typedef {Object} BlockData
* @property {number} index - The index of the block
* @property {number} supply - The total supply before the coinbase reward
* @property {number} coinBase - The coinbase reward
* @property {number} difficulty - The difficulty of the block
* @property {string} prevHash - The hash of the previous block
* @property {Transaction[]} Txs - The transactions in the block
* @property {number | undefined} timestamp - The timestamp of the block
* @property {string | undefined} hash - The hash of the block
* @property {number | undefined} nonce - The nonce of the block
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

class TxIO_Scripts {
    static lock = {
        signature: {
            /**
             * @param {string} signature
             * @param {string} message
             * @param {string} pubKeyHex
             */
            v1: (signature, message, pubKeyHex) => {
                return AsymetricFunctions.verifySignature(signature, message, pubKeyHex);
            }
        }
    }

    static arrayIncludeDuplicates(array) { // is it used ? - preferable to delete
        return (new Set(array)).size !== array.length;
    }

    static decomposeScriptString(script) {
    }
}

/**
 * @typedef {Object} TransactionIO
 * @property {number} amount
 * @property {string} address - output only
 * @property {string} script
 * @property {number} version
 * @property {string | undefined} TxID - input only
 * @property {number | undefined} blockIndex - input only
 */
/** Transaction Input/Output data structure
 * @param {number} amount
 * @param {string} address - output only
 * @param {string} script
 * @param {number} version  
 * @param {string | undefined} TxID - input only
 * @param {number | undefined} blockIndex - input only
 * @returns {TransactionIO}
 **/
const TransactionIO = (amount, script, version, address = undefined, TxID = undefined, blockIndex = undefined) => {
    return {
        amount,
        script,
        version,
        address,
        TxID,
        blockIndex
    };
}
export class TxIO_Builder {
    /**
     * @param {"input" | "output"} type
     * @param {number} amount
     * @param {string} address - output only
     * @param {string} script
     * @param {number} version
     * @param {string | undefined} TxID - input only
     * @param {number | undefined} blockIndex - input only
     */
    static newIO(type, amount, script, version, address, TxID, blockIndex) {
        const TxIO_Script = TxIO_Builder.getAssociatedScript(script);
        if (!TxIO_Script) { 
            throw new Error('Invalid script'); }

        const newTxIO = TransactionIO(amount, script, version, address, TxID, blockIndex);
        Validation.isValidTransactionIO(newTxIO, type);
        
        return newTxIO;
    }
    /**
     * @param {string} script
     * @param {string} type - 'lock' or 'unlock'
     */
    static getAssociatedScript(script) {
        const scriptName = script.split('_')[0];
        const scriptVersion = script.split('_')[1];

        if (TxIO_Scripts.lock[scriptName] === undefined) {
            throw new Error('Invalid script name'); }
        if (TxIO_Scripts.lock[scriptName][scriptVersion] === undefined) { throw new Error('Invalid script version'); }

        return TxIO_Scripts.lock[scriptName][scriptVersion];
    }
    /** @param {TransactionIO[]} TxIOs */
    static checkMissingTxID(TxIOs) {
        if (TxIOs.length === 0) { throw new Error('No UTXO to check'); }

        const txIDs = TxIOs.map(TxIO => TxIO.TxID);
        if (txIDs.includes(undefined)) { throw new Error('One UTXO has no TxID'); }
        if (TxIO_Scripts.arrayIncludeDuplicates(txIDs)) { throw new Error('Duplicate TxID in UTXOs'); }
    }
    /** @param {TransactionIO[]} TxIOs */
    static cloneTxIO(TxIO) {
        const TxIOJSON = JSON.stringify(TxIO);
        return JSON.parse(TxIOJSON);
    }
}

/**
 * @typedef {Object} Transaction
 * @property {TransactionIO[]} inputs
 * @property {TransactionIO[]} outputs
 * @property {string} id
 * @property {string[]} witnesses
 */
/** Transaction data structure
 * @param {TransactionIO[]} inputs
 * @param {TransactionIO[]} outputs
 * @param {string} id
 * @param {string[]} witnesses
 * @returns {Transaction}
 */
const Transaction = (inputs, outputs, id = '', witnesses = []) => {
    return {
        id,
        witnesses,
        inputs,
        outputs
    };
}
export class Transaction_Builder {
    /**
     * @param {string} nonceHex
     * @param {string} address 
     * @param {number} amount
     */
    static createCoinbaseTransaction(nonceHex, address, amount) {
        if (typeof nonceHex !== 'string') { throw new Error('Invalid nonceHex'); }
        if (typeof address !== 'string') { throw new Error('Invalid address'); }
        if (typeof amount !== 'number') { throw new Error('Invalid amount'); }

        const coinbaseOutput = TxIO_Builder.newIO('output', amount, 'signature_v1', 1, address);
        const inputs = [ nonceHex ];
        const outputs = [ coinbaseOutput ];

        return Transaction(inputs, outputs);
    }
    /**
     * @param {BlockData} blockCandidate
     * @param {string} address
     */
    static async createPosRewardTransaction(blockCandidate, address) {
        if (typeof address !== 'string') { throw new Error('Invalid address'); }

        const blockFees = Block.calculateTxsTotalFees(blockCandidate.Txs);
        if (typeof blockFees !== 'number') { throw new Error('Invalid blockFees'); }

        const posInput = await Block.calculateValidatorHash(blockCandidate);
        const inputs = [ posInput ];
        const posOutput = TxIO_Builder.newIO('output', blockFees, 'signature_v1', 1, address);
        const outputs = [ posOutput ];

        return Transaction(inputs, outputs);
    }
    /** @param {Account} senderAccount */
    static createTransferTransaction(
        senderAccount,
        transfers = [ { recipientAddress: 'recipientAddress', amount: 1 } ]
    ) {
        const senderAddress = senderAccount.address;
        const UTXOs = senderAccount.UTXOs;
        if (UTXOs.length === 0) { throw new Error('No UTXO to spend'); }
        if (transfers.length === 0) { throw new Error('No transfer to make'); }
        
        TxIO_Builder.checkMissingTxID(UTXOs);

        const { outputs, totalSpent } = Transaction_Builder.buildOutputsFrom(transfers, 'signature_v1', 1);
        const totalInputAmount = UTXOs.reduce((a, b) => a + b.amount, 0);

        const fee = 1_000_000; // TODO: calculate the fee
        const change = totalInputAmount - totalSpent - fee;
        if (change < 0) { 
            throw new Error('Negative change => not enough funds'); 
        } else if (change > 0) {
            const changeOutput = TxIO_Builder.newIO("output", change, 'signature_v1', 1, senderAddress);
            outputs.push(changeOutput);
        }

        if (TxIO_Scripts.arrayIncludeDuplicates(outputs)) { throw new Error('Duplicate outputs'); }
        
        return Transaction(UTXOs, outputs);
    }
    /**
     * @param {{recipientAddress: string, amount: number}[]} transfers
     * @param {string} script
     * @param {number} version
     */
    static buildOutputsFrom(transfers = [{recipientAddress: 'recipientAddress', amount: 1,}], script = 'signature_v1', version = 1) {
        const outputs = [];
        const totalAmount = [];

        for (let i = 0; i < transfers.length; i++) {
            const { recipientAddress, amount} = transfers[i];
            const output = TxIO_Builder.newIO('output', amount, script, version, recipientAddress);
            outputs.push(output);
            totalAmount.push(amount);
        }

        const totalSpent = totalAmount.reduce((a, b) => a + b, 0);

        return { outputs, totalSpent };
    }
    /** @param {Transaction} transaction */
    static async hashTxToGetID(transaction, hashHexLength = 8) {
        const message = Transaction_Builder.getTransactionStringToHash(transaction);
        const hashHex = await HashFunctions.SHA256(message);
        return hashHex.slice(0, hashHexLength);
    }
    /** @param {Transaction} transaction */
    static getTransactionStringToHash(transaction) {
        const inputsStr = JSON.stringify(transaction.inputs);
        const outputsStr = JSON.stringify(transaction.outputs);
        
        const stringHex = utils.convert.string.toHex(`${inputsStr}${outputsStr}`);
        return stringHex;
    }
    /** 
     * @param {Transaction} transaction
     * @param {number} TxIndexInTheBlock
     */
    static isCoinBaseOrFeeTransaction(transaction, TxIndexInTheBlock) {
        if (transaction.inputs.length !== 1) { return false; }
        if (TxIndexInTheBlock !== 0 && TxIndexInTheBlock !== 1) { return false; }
        return typeof transaction.inputs[0] === 'string';
    }
    /** @param {Transaction} transaction */
    static isIncriptionTransaction(transaction) {
        if (transaction.outputs.length !== 1) { return false; }
        return typeof transaction.outputs[0] === 'string';
    }
    /** @param {Transaction} transaction */
    static getTransactionJSON(transaction) {
        return JSON.stringify(transaction)
    }
    static transactionFromJSON(transactionJSON) {
        return JSON.parse(transactionJSON);
    }

    /**
     * @param {Account} senderAccount
     * @param {number} amount
     * @param {string} recipientAddress
     * @returns promise {{signedTxJSON: string | false, error: false | string}}
     */
    static async createAndSignTransferTransaction(senderAccount, amount, recipientAddress) {
        try {
            const transfer = { recipientAddress, amount };
            const transaction = Transaction_Builder.createTransferTransaction(senderAccount, [transfer]);
            const signedTx = await senderAccount.signAndReturnTransaction(transaction);
            signedTx.id = await Transaction_Builder.hashTxToGetID(signedTx);
    
            return { signedTxJSON: Transaction_Builder.getTransactionJSON(signedTx), error: false };
        } catch (error) {
            /** @type {string} */
            const errorMessage = error.stack;
            return { signedTxJSON: false, error: errorMessage };
        }
    }
}

export class Wallet {
    constructor(masterHex) {
        /** @type {string} */
        this.masterHex = masterHex; // 30 bytes - 60 chars
        /** @type {Object<string, Account[]>} */
        this.accounts = { // max accounts per type = 65 536
            W: [],
            C: [],
            S: [],
            P: [],
            U: []
        };
        /** @type {Object<string, number[]>} */
        this.accountsGenerationSequences = {
            W: [],
            C: [],
            S: [],
            P: [],
            U: []
        };
    }
    static async restore(mnemonicHex = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") {
        const argon2HashResult = await HashFunctions.Argon2(mnemonicHex, "Contrast's Salt Isnt Pepper But It Is Tasty", 27, 1024, 1, 2, 26);
        if (!argon2HashResult) { return false; }

        return new Wallet(argon2HashResult.hex);
    }
    saveAccountsGenerationSequences() {
        storage.saveJSON('accountsGenerationSequences', this.accountsGenerationSequences);
    }
    loadAccountsGenerationSequences() {
        const accountsGenerationSequences = storage.loadJSON('accountsGenerationSequences');
        if (!accountsGenerationSequences) { return false; }

        this.accountsGenerationSequences = accountsGenerationSequences;
        return true;
    }
    async deriveAccounts(nbOfAccounts = 1, addressPrefix = "C") {
        const nbOfExistingAccounts = this.accounts[addressPrefix].length;
        const iterationsPerAccount = []; // used for control

        for (let i = nbOfExistingAccounts; i < nbOfAccounts; i++) {
            const seedModifierHex = this.accountsGenerationSequences[addressPrefix][i];
            if (seedModifierHex) {
                const account = await this.#deriveAccount(seedModifierHex, addressPrefix);
                if (!account) { console.error(`accountsGenerationSequences is probably corrupted at index: ${i}`); return false; }

                iterationsPerAccount.push(1);
                this.accounts[addressPrefix].push(account);
                continue;
            }

            const { account, iterations } = await this.tryDerivationUntilValidAccount(i, addressPrefix);
            if (!account) { console.error('deriveAccounts interrupted!'); return false; }

            iterationsPerAccount.push(iterations);
            this.accounts[addressPrefix].push(account);
        }
        
        const derivedAccounts = this.accounts[addressPrefix].slice(nbOfExistingAccounts);
        if (derivedAccounts.length !== nbOfAccounts) { console.error('Failed to derive all accounts'); return false; }
        return { derivedAccounts, avgIterations: (iterationsPerAccount.reduce((a, b) => a + b, 0) / nbOfAccounts).toFixed(2) };
    }
    async tryDerivationUntilValidAccount(accountIndex = 0, desiredPrefix = "C") {
        /** @type {AddressTypeInfo} */
        const addressTypeInfo = utils.addressUtils.glossary[desiredPrefix];
        if (addressTypeInfo === undefined) { throw new Error(`Invalid desiredPrefix: ${desiredPrefix}`); }

        // To be sure we have enough iterations, but avoid infinite loop
        const maxIterations = 65_536 * (2 ** addressTypeInfo.zeroBits); // max with zeroBits(16): 65 536 * (2^16) => 4 294 967 296
        const seedModifierStart = accountIndex * maxIterations; // max with accountIndex: 65 535 * 4 294 967 296 => 281 470 681 743 360
        for (let i = 0; i < maxIterations; i++) {
            const seedModifier = seedModifierStart + i;
            const seedModifierHex = seedModifier.toString(16).padStart(12, '0'); // padStart(12, '0') => 48 bits (6 bytes), maxValue = 281 474 976 710 655
            
            try {
                const account = await this.#deriveAccount(seedModifierHex, desiredPrefix);
                if (account) {
                    this.accountsGenerationSequences[desiredPrefix].push(seedModifierHex);
                    return { account, iterations: i }; 
                }
            } catch (error) {
                const errorSkippingLog = ['Address does not meet the security level'];
                if (!errorSkippingLog.includes(error.message.slice(0,40))) { console.error(error.stack); }
            }
        }

        return false;
    }
    async #deriveAccount(seedModifierHex, desiredPrefix = "C") {
        const seedHex = await HashFunctions.SHA256(this.masterHex + seedModifierHex);

        const keyPair = await AsymetricFunctions.generateKeyPairFromHash(seedHex);
        if (!keyPair) { throw new Error('Failed to generate key pair'); }

        const addressBase58 = await utils.addressUtils.deriveAddress(HashFunctions.Argon2, keyPair.pubKeyHex);
        if (!addressBase58) { throw new Error('Failed to derive address'); }

        if (addressBase58.substring(0, 1) !== desiredPrefix) { return false; }
        
        utils.addressUtils.conformityCheck(addressBase58);
        await utils.addressUtils.securityCheck(addressBase58, keyPair.pubKeyHex);

        return new Account(keyPair.pubKeyHex, keyPair.privKeyHex, addressBase58);
    }
}
export class Account {
     /** @type {string} */
    #privKey = '';
    /** @type {string} */
    #pubKey = '';

    constructor(pubKey = '', privKey = '', address = '') {
        this.#pubKey = pubKey;
        this.#privKey = privKey;

        /** @type {string} */
        this.address = address;
        /** @type {TransactionIO[]} */
        this.UTXOs = [];
        /** @type {number} */
        this.balance = 0;
    }

    /** @param {Transaction} transaction */
    async signAndReturnTransaction(transaction) {
        if (typeof this.#privKey !== 'string') { throw new Error('Invalid private key'); }

        const message = Transaction_Builder.getTransactionStringToHash(transaction);
        const { signatureHex } = await AsymetricFunctions.signMessage(message, this.#privKey, this.#pubKey);
        if (transaction.witnesses.includes(signatureHex)) { throw new Error('Signature already included'); }

        transaction.witnesses.push(`${signatureHex}:${this.#pubKey}`);

        return transaction;
    }
    /**
     * @param {number} balance
     * @param {TransactionIO[]} UTXOs
     */
    setBalanceAndUTXOs(balance, UTXOs) {
        if (typeof balance !== 'number') { throw new Error('Invalid balance'); }
        if (!Array.isArray(UTXOs)) { throw new Error('Invalid UTXOs'); }

        this.balance = balance;
        this.UTXOs = UTXOs;
    }
}

class Validation {
    /** ==> First validation, low computation cost.
     * 
     * - control format of : amount, address, script, version, TxID
     * @param {Transaction} transaction
     * @param {boolean} isCoinBase
     */
    static isConformTransaction(transaction, isCoinBase) {
        if (!transaction) { throw new Error('Invalid transaction'); }
        if (typeof transaction.id !== 'string') { throw new Error('Invalid transaction ID'); }
        if (!Array.isArray(transaction.inputs)) { throw new Error('Invalid transaction inputs'); }
        if (!Array.isArray(transaction.outputs)) { throw new Error('Invalid transaction outputs'); }
        if (!Array.isArray(transaction.witnesses)) { throw new Error('Invalid transaction witnesses'); }

        for (let i = 0; i < transaction.inputs.length; i++) {
            if (isCoinBase && typeof transaction.inputs[i] !== 'string') { throw new Error('Invalid coinbase input'); }
            if (isCoinBase) { continue; }
            Validation.isValidTransactionIO(transaction.inputs[i], 'input');
        }

        for (let i = 0; i < transaction.outputs.length; i++) {
            Validation.isValidTransactionIO(transaction.outputs[i], 'output');
        }
    }
    /** Used by isConformTransaction()
     * @param {TransactionIO} TxIO - transaction input/output
     * @param {string} type - 'input' | 'output'
     */
    static isValidTransactionIO(TxIO, type) { // type: 'input' | 'output'
        if (typeof TxIO.amount !== 'number') { throw new Error('Invalid amount !== number'); }

        if (TxIO.amount < 0) { throw new Error('Invalid amount value: < 0'); }
        if (type === 'input' && TxIO.amount === 0) { throw new Error('Invalid amount value: = 0'); }
        if (TxIO.amount % 1 !== 0) { throw new Error('Invalid amount value: not integer'); }

        if (typeof TxIO.script !== 'string') { throw new Error('Invalid script !== string'); }
        if (typeof TxIO.version !== 'number') { throw new Error('Invalid version !== number'); }
        if (TxIO.version <= 0) { throw new Error('Invalid version value: <= 0'); }

        if (type === 'input' && typeof TxIO.blockIndex !== 'number') { throw new Error('Invalid blockIndex !== number'); }
        if (type === 'input' && TxIO.blockIndex < 0) { throw new Error('Invalid blockIndex value: < 0'); }
        if (type === 'input' && TxIO.blockIndex % 1 !== 0) { throw new Error('Invalid blockIndex value: not integer'); }
        if (type === 'input' && typeof TxIO.TxID !== 'string') { throw new Error('Invalid TxID !== string'); }
        if (type === 'input' && TxIO.TxID.length !== 8) { throw new Error('Invalid TxID length !== 8'); }

        if (type === 'output' && typeof TxIO.address !== 'string') { throw new Error('Invalid address !== string'); }
        if (type === 'output') { utils.addressUtils.conformityCheck(TxIO.address) }
    }

    /** ==> Second validation, low computation cost.
     * 
     * - control : input > output
     * 
     * - control the fee > 0 or = 0 for coinbase
     * @param {Transaction} transaction
     * @param {boolean} isCoinbaseTx
     * @returns {number} - the fee
     */
    static calculateRemainingAmount(transaction, isCoinbaseTx) {
        const inputsAmount = transaction.inputs.reduce((a, b) => a + b.amount, 0);
        const outputsAmount = transaction.outputs.reduce((a, b) => a + b.amount, 0);
        const fee = inputsAmount - outputsAmount;
        if (fee < 0) { throw new Error('Negative transaction'); }
        if (isCoinbaseTx && fee !== 0) { throw new Error('Invalid coinbase transaction'); }
        if (!isCoinbaseTx && fee === 0) { throw new Error('Invalid transaction: fee = 0'); }

        return fee;
    }

    /** ==> Third validation, medium computation cost.
     * 
     * - control the transaction hash (SHA256)
     * @param {Transaction} transaction
     */
    static async controlTransactionHash(transaction) {
        const expectedID = await Transaction_Builder.hashTxToGetID(transaction);
        if (expectedID !== transaction.id) { throw new Error('Invalid transaction hash'); }
    }

    /** ==> Fourth validation, medium computation cost.
     * 
     * - control the signature of the inputs
     * @param {Object<string, TransactionIO>} referencedUTXOs
     * @param {Transaction} transaction
     */
    static async executeTransactionInputsScripts(referencedUTXOs, transaction) {
        // TODO: ADAPT THE LOGIC FOR MULTI WITNESS
        const opAlreadyPassed = [];
        const witnessParts = transaction.witnesses[0].split(':');
        const signature = witnessParts[0];
        const pubKeyHex = witnessParts[1];

        for (let i = 0; i < transaction.inputs.length; i++) {
            const { TxID, blockIndex, script } = transaction.inputs[i];
            const reference = `${blockIndex}:${TxID}`;
            const referencedUTXO = referencedUTXOs[reference];
            if (!referencedUTXO) { throw new Error('referencedUTXO not found'); }

            const operation = `${referencedUTXO.address}${script}`;
            if (opAlreadyPassed.includes(operation)) {
                continue; }

            utils.addressUtils.conformityCheck(referencedUTXO.address);
            await utils.addressUtils.securityCheck(referencedUTXO.address, pubKeyHex);
            
            const message = Transaction_Builder.getTransactionStringToHash(transaction);
            Validation.executeTransactionInputScripts(script, signature, message, pubKeyHex);

            opAlreadyPassed.push(operation);
        }
    }
    /** // TODO: TRANSFORM SCRIPT LOGIC TO HUMAN READABLE LOGIC -> INPUT LOOKS LIKE : BY:ADDRESS-SIG:SIGNATURE-PUB:pubKeyHex ?
     * @param {string} script
     * @param {string} address
     * @param {string} signature
     * @param {string} pubKeyHex
     */
    static executeTransactionInputScripts(script, signature, message, pubKeyHex) {
        const scriptFunction = TxIO_Builder.getAssociatedScript(script);
        if (!scriptFunction) { throw new Error('Invalid script'); }

        const addressOwnedByPubKey = scriptFunction(signature, message, pubKeyHex);
        if (!addressOwnedByPubKey) { throw new Error('Invalid signature<->pubKey correspancy'); }
    }

    /** ==> Fifth validation, high computation cost.
     * 
     * - control the address/pubKey correspondence
     * @param {Object<string, TransactionIO>} referencedUTXOs
     * @param {Transaction} transaction
     */
    static async addressOwnershipConfirmation(referencedUTXOs, transaction) {
        const witnessesAddresses = [];

        // derive witnesses addresses
        for (let i = 0; i < transaction.witnesses.length; i++) {
            const witnessParts = transaction.witnesses[i].split(':');
            const pubKeyHex = witnessParts[1];
            const derivedAddressBase58 = await utils.addressUtils.deriveAddress(HashFunctions.Argon2, pubKeyHex);
            if (witnessesAddresses.includes(derivedAddressBase58)) { throw new Error('Duplicate witness'); }

            witnessesAddresses.push(derivedAddressBase58);
        }

        // control the input's(UTXOs) addresses presence in the witnesses
        for (let i = 0; i < transaction.inputs.length; i++) {
            const { blockIndex, TxID } = transaction.inputs[i];
            const reference = `${blockIndex}:${TxID}`;
            const referencedUTXO = referencedUTXOs[reference];
            if (!referencedUTXO) { throw new Error('referencedUTXO not found'); }
            if (witnessesAddresses.includes(referencedUTXO.address) === false) { throw new Error(`Witness missing for address: ${utils.addressUtils.formatAddress(referencedUTXO.address)}`); }
        }
    }
}
class MemPool {
    constructor() {
        /** @type {Transaction[]} */
        this.transactions = [];
        /** @type {function[]} */
        this.callStack = [];
        /** @type {string = 'idle' | 'active' | 'pausing' | 'paused'} */
        this.state = 'idle';
    }

    async stackLoop(delayMS = 20) {
        this.state = 'active';

        while (true) {
            await new Promise(resolve => setTimeout(resolve, delayMS));

            if (this.state === 'idle' && this.callStack.length === 0) { continue; }
            if (this.state === 'paused') { continue; }
            if (this.state === 'pausing') { this.state = 'paused'; continue; }
            if (this.state === 'idle') { this.state = 'active'; }

            const functionToCall = this.callStack.shift();
            if (!functionToCall) { this.state = 'idle'; continue; }
            try {
                await functionToCall();
            } catch (error) {
                const errorSkippingLog = ['Conflicting UTXOs'];
                if (!errorSkippingLog.includes(error.message)) { console.error(error.stack); }
            }
        }
    }
    async pauseStackAndAwaitPaused() {
        if (this.state === 'paused') { return; }

        this.pauseStackLoop();
        while (this.state !== 'paused') {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }
    pauseStackLoop() {
        this.state = 'pausing';
    }
    resumeStackLoop() {
        this.state = 'active';
    }
    /** Add a function to the stack
     * @param {function} func
     * @param {boolean} firstPlace
     */
    addFunctionToStack(func, firstPlace = false) {
        if (firstPlace) { 
            this.callStack.unshift(func);
        } else {
            this.callStack.push(func);
        }
    }

    getMostLucrativeTransactions(maxTxs = 1000) { //TODO: selection - use fee/byte instead of maxTx
        /*const sortedTxs = this.transactions.sort((a, b) => {
            const aFee = a.fee;
            const bFee = b.fee;

            if (aFee === bFee) { return 0; }
            return aFee > bFee ? -1 : 1;
        });*/

        return this.transactions.slice(0, maxTxs);
    }
    /**
     * Remove the transactions included in the block from the mempool
     * @param {Transaction[]} Txs
     */
    digestBlockTransactions(Txs) {
        if (!Array.isArray(Txs)) { throw new Error('Txs is not an array'); }

        const txIDs = Txs.map(tx => tx.id);
        const filteredTxs = this.transactions.filter(tx => !txIDs.includes(tx.id));
        this.transactions = filteredTxs;
    }
    /**
     * @param {Transaction} transactionA
     * @param {Transaction} transactionB
     */
    #isTransactionsUsingTheSameInput(transactionA, transactionB) {
        const inputsReferencesA = transactionA.inputs.map(input => `${input.blockIndex}:${input.TxID}`);
        for (let i = 0; i < transactionB.inputs.length; i++) {
            const reference = `${transactionB.inputs[i].blockIndex}:${transactionB.inputs[i].TxID}`;
            if (!inputsReferencesA.includes(reference)) { continue; }

            return true;
        }

        return false;
    }
    /** 
     * @param {string} memPoolTxIndex
     * @param {Transaction} transaction
     * @param {string} TxidToReplace
     */
    #getReplacementFunction(memPoolTxIndex, transaction, TxidToReplace) {
        const memPoolTx = this.transactions[memPoolTxIndex];
        if (TxidToReplace !== memPoolTx.id) { throw new Error('Transaction already in mempool but ID does not match replaceExistingTxID'); }
        
        const newFee = Validation.calculateRemainingAmount(transaction, false);
        const oldFee = Validation.calculateRemainingAmount(memPoolTx, false);
        if (newFee <= oldFee) { throw new Error('New transaction fee is not higher than the existing one'); }

        return () => {
            this.transactions.splice(i, 1);
            this.transactions.push(transaction);
        }
    }
    /**
     * @param {Object<string, TransactionIO>} referencedUTXOs
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    async pushTransaction(referencedUTXOs, transaction, replaceExistingTxID) {
        const startTime = Date.now();

        let txInclusionFunction = () => { this.transactions.push(transaction); };
        for (let i = 0; i < this.transactions.length; i++) {
            if (this.transactions[i].id !== transaction.id) { continue; }
            if (!this.#isTransactionsUsingTheSameInput(this.transactions[i], transaction)) { continue; }

            if (!replaceExistingTxID) { throw new Error('Conflicting UTXOs'); }

            txInclusionFunction = this.#getReplacementFunction(i, transaction, replaceExistingTxID);
        }

        const isCoinBase = false;

        // First control format of : amount, address, script, version, TxID
        Validation.isConformTransaction(transaction, isCoinBase);

        // Second control : input > output
        const fee = Validation.calculateRemainingAmount(transaction, isCoinBase);

        // Third validation: medium computation cost.
        await Validation.controlTransactionHash(transaction);

        // Fourth validation: medium computation cost.
        await Validation.executeTransactionInputsScripts(referencedUTXOs, transaction);

        // Fifth validation: high computation cost.
        await Validation.addressOwnershipConfirmation(referencedUTXOs, transaction);

        txInclusionFunction();
        console.log(`Transaction pushed in mempool in ${Date.now() - startTime}ms`);
    }
}
class HotData { // Used to store, addresses's UTXOs and balance.
    constructor() {
        /** @type {Object<string, TransactionIO[]>} */
        this.addressUTXOs = {};
        /** @type {Object<string, number>} */
        this.addressBalances = {};
        /** @type {Object<string, TransactionIO>} */
        this.referencedUTXOs = {};
    }

    /** @param {BlockData[]} chain */
    digestChain(chain) {
        for (let i = 0; i < chain.length; i++) {
            const blockData = chain[i];
            //const Txs = blockData.Txs;
            //this.digestBlockTransactions(blockData.index, Txs);
            this.digestBlock(blockData);
        }
    }
    /** @param {BlockData} blockData */
    digestBlock(blockData) {
        const Txs = blockData.Txs;
        this.digestBlockTransactions(blockData.index, Txs);

        const supplyFromBlock = blockData.supply;
        const coinBase = blockData.coinBase;
        const totalSupply = supplyFromBlock + coinBase;
        const totalOfBalances = this.#calculateTotalOfBalances();

        const currencySupply = utils.convert.number.formatNumberAsCurrency(totalSupply);
        const currencyBalances = utils.convert.number.formatNumberAsCurrency(totalOfBalances);
        //console.log(`supplyFromBlock+coinBase: ${readableSupply} - totalOfBalances: ${readableBalances}`);
        if (totalOfBalances !== totalSupply) { 
            console.info(`supplyFromBlock+coinBase: ${currencySupply} - totalOfBalances: ${currencyBalances}`);
            throw new Error('Invalid total of balances'); 
        }
    }
    #calculateTotalOfBalances() {
        const addresses = Object.keys(this.addressBalances);
        return addresses.reduce((a, b) => a + this.addressBalances[b], 0);
    }
    /**
     * @param {number} blockIndex
     * @param {Transaction[]} Txs
     */
    digestBlockTransactions(blockIndex, Txs) {
        if (!Array.isArray(Txs)) { throw new Error('Txs is not an array'); }
        //console.log(`Digesting block ${blockIndex} with ${Txs.length} transactions`);

        for (let i = 0; i < Txs.length; i++) {
            const transaction = Txs[i];
            this.#digestTransactionInputs(transaction, i); // Reverse function's call ?
            this.#digestTransactionOutputs(blockIndex, transaction);
        }
    }
    /**
     * Will add or remove the amount from the address balance
     * @param {string} address 
     * @param {number} amount 
     */
    #changeBalance(address, amount) {
        if (typeof amount !== 'number') { throw new Error('Invalid amount'); }
        if (amount === 0) { return; }
        if (this.addressBalances[address] === undefined) { this.addressBalances[address] = 0; }

        this.addressBalances[address] += amount;
        // console.log(`Balance of ${address} changed by ${amount} => ${this.addressBalances[address]}`);
    }
    /**
     * @param {Transaction} transaction 
     * @param {number} TxIndexInTheBlock
     */
    #digestTransactionInputs(transaction, TxIndexInTheBlock) {
        if ( Transaction_Builder.isCoinBaseOrFeeTransaction(transaction, TxIndexInTheBlock) ) { return } // coinbase -> no input

        const TxInputs = transaction.inputs;
        for (let i = 0; i < TxInputs.length; i++) {
            
            TxIO_Builder.checkMissingTxID(TxInputs);
            
            const usedUTXO = this.#getCorrespondingUTXO(TxInputs[i]);
            const { address, amount } = usedUTXO;
            this.#removeUTXO(address, TxInputs[i]);
            this.#changeBalance(address, -amount);
        }

        return true;
    }
    /** @param {TransactionIO} inputUtxo */
    #getCorrespondingUTXO(inputUtxo) {
        const reference = `${inputUtxo.blockIndex}:${inputUtxo.TxID}`;
        if (this.referencedUTXOs[reference] === undefined) {
            throw new Error('Fatal error : UTXO used in input not found in HotData!'); }

        return this.referencedUTXOs[reference];
    }
    /**
     * @param {string} address
     * @param {TransactionIO} utxo
     */
    #removeUTXO(address, utxo) {
        if (this.addressUTXOs[address] === undefined) { throw new Error(`${address} has no UTXOs`); }

        const addressUtxoIndex = this.addressUTXOs[address].findIndex(utxoInArray =>
            utxoInArray.TxID === utxo.TxID && utxoInArray.blockIndex === utxo.blockIndex);
        if (addressUtxoIndex === -1) { 
            throw new Error(`${address} isn't owning UTXO: ${utxo.TxID}`); }

        if (this.referencedUTXOs[`${utxo.blockIndex}:${utxo.TxID}`] === undefined) { throw new Error('UTXO not found in referencedUTXOs'); }

        this.addressUTXOs[address].splice(addressUtxoIndex, 1);
        if (this.addressUTXOs[address].length === 0) { delete this.addressUTXOs[address]; }
        delete this.referencedUTXOs[`${utxo.blockIndex}:${utxo.TxID}`];
    }
    /**
     * @param {number} blockIndex
     * @param {Transaction} transaction
     */
    #digestTransactionOutputs(blockIndex, transaction) {
        const TxID = transaction.id;
        const TxOutputs = transaction.outputs;
        for (let i = 0; i < TxOutputs.length; i++) {
            // UXTO would be used as input, then we add TxID and blockIndex
            TxOutputs[i].TxID = TxID;
            TxOutputs[i].blockIndex = blockIndex;
            const reference = `${blockIndex}:${TxID}`;
            const clonedOutput = TxIO_Builder.cloneTxIO(TxOutputs[i]);
            this.referencedUTXOs[reference] = clonedOutput;
            
            const { address, amount } = TxOutputs[i];
            if (amount === 0) { continue; } // no need to add UTXO with 0 amount
            delete TxOutputs[i].address; // not included in UTXO input

            if (this.addressUTXOs[address] === undefined) { this.addressUTXOs[address] = []; }
            this.addressUTXOs[address].push(TxOutputs[i]);
            this.#changeBalance(address, amount);
        }
    }
    /** @param {string} address */
    getBalanceAndUTXOs(address) {
        // clone values to avoid modification
        const balance = this.addressBalances[address] ? JSON.parse(JSON.stringify(this.addressBalances[address])) : 0;
        const UTXOs = [];
        if (this.addressUTXOs[address]) {
            for (let i = 0; i < this.addressUTXOs[address].length; i++) {
                UTXOs.push(TxIO_Builder.cloneTxIO(this.addressUTXOs[address][i]));
            }
        }
        return { balance, UTXOs };
    }
}
export class FullNode {
    /** @param {Account} validatorAccount */
    constructor(validatorAccount, chain) {
        /** @type {Account} */
        this.validatorAccount = validatorAccount;
        /** @type {BlockData[]} */
        this.chain = chain || [];
        /** @type {BlockData} */
        this.blockCandidate = null;

        this.memPool = new MemPool();
        this.hotData = new HotData();
    }
    /** @param {Account} validatorAccount */
    static async load(validatorAccount, saveBlocksInfo = true) {
        const chain = storage.loadBlockchainLocally('bin');
        const controlChain = storage.loadBlockchainLocally('json');
        FullNode.controlChainIntegrity(chain, controlChain);

        const node = new FullNode(validatorAccount, chain);
        node.hotData.digestChain(chain);
        // TODO: mempool digest mempool from other validator node
        node.memPool.stackLoop(20);

        if (saveBlocksInfo) { // basic informations .csv
            const blocksInfo = node.#getBlocksMiningInfo();
            storage.saveBlockchainInfoLocally(blocksInfo);
        }

        // TODO: Get the Txs from the mempool and add them
        // TODO: Verify the Txs

        const lastBlockData = chain[chain.length - 1] ? chain[chain.length - 1] : undefined;
        node.blockCandidate = await node.#createBlockCandidate(lastBlockData);

        return node;
    }
    /**
     * @param {BlockData[]} chain
     * @param {BlockData[]} controlChain
     */
    static controlChainIntegrity(chain, controlChain) {
        // Control the chain integrity
        for (let i = 0; i < controlChain.length; i++) {
            const controlBlock = controlChain[i];
            const block = chain[i];
            FullNode.controlObjectEqualValues(controlBlock, block);
        }
    }
    /**
     * @param {object} object1
     * @param {object} object2
     */
    static controlObjectEqualValues(object1, object2) {
        for (const key in object1) {
            const value1 = object1[key];
            const value2 = object2[key];
            if (typeof value1 === 'object') {
                FullNode.controlObjectEqualValues(value1, value2);
            } else if (value1 !== value2) {
                throw new Error(`Control failed - key: ${key}`);
            }
        }
    }
    
    /** @param {BlockData} minerBlockCandidate */
    async blockProposal(minerBlockCandidate) {
        if (!minerBlockCandidate) { throw new Error('Invalid block candidate'); }
        
        //TODO : VALIDATE THE BLOCK
        // TODO verify if coinBase Tx release the correct amount of coins
        const { hex, bitsArrayAsString } = await Block.calculateHash(minerBlockCandidate);
        utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, minerBlockCandidate.difficulty);

        if (minerBlockCandidate.hash !== hex) { throw new Error('Invalid hash'); }
        
        const blockDataCloneToSave = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        if (this.chain.length < 20) { storage.saveBlockDataLocally(blockDataCloneToSave, 'json'); }
        const saveResult = storage.saveBlockDataLocally(blockDataCloneToSave, 'bin');
        if (!saveResult.success) { throw new Error(saveResult.message); }

        const blockDataCloneToDigest = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        this.chain.push(blockDataCloneToDigest);
        this.hotData.digestBlock(blockDataCloneToDigest);

        await this.memPool.pauseStackAndAwaitPaused();
        this.memPool.digestBlockTransactions(blockDataCloneToDigest.Txs);
        this.memPool.resumeStackLoop();

        // simple log for debug ----------------------
        const powMinerTx = minerBlockCandidate.Txs[0];
        const address = powMinerTx.outputs[0].address;
        const { balance, UTXOs } = this.hotData.getBalanceAndUTXOs(address);
        console.log(`remaining UTXOs for [ ${utils.addressUtils.formatAddress(address, ' ')} ] ${UTXOs.length} utxos - balance: ${utils.convert.number.formatNumberAsCurrency(balance)}`);
        // -------------------------------------------

        const newBlockCandidate = await this.#createBlockCandidate(minerBlockCandidate);
        this.blockCandidate = newBlockCandidate; // Can be sent to the network

        return true;
    }
    /** @param {Transaction} signedTxJSON */
    async addTransactionJSONToMemPool(signedTxJSON) {
        if (!signedTxJSON) { throw new Error('Invalid transaction'); }
        const signedTansaction = Transaction_Builder.transactionFromJSON(signedTxJSON);
        this.memPool.addFunctionToStack(async () => {
            await this.memPool.pushTransaction(this.hotData.referencedUTXOs, signedTansaction);
        });
    }

    // TODO: Fork management
    // Private methods
    /** @param {BlockData | undefined} lastBlockData */
    async #createBlockCandidate(lastBlockData) {
        const Txs = this.memPool.getMostLucrativeTransactions(1000);

        let blockCandidate = BlockData(0, 0, utils.blockchainSettings.blockReward, 1, 'ContrastGenesisBlock', Txs);
        if (lastBlockData) {
            const newDifficulty = utils.mining.difficultyAdjustment(this.chain);
            const lastBlockData = this.chain[this.chain.length - 1];
            const clone = Block.cloneBlockData(lastBlockData);
            const supply = clone.supply + clone.coinBase;
            const coinBaseReward = Block.calculateNextCoinbaseReward(clone);
            blockCandidate = BlockData(clone.index + 1, supply, coinBaseReward, newDifficulty, clone.hash, Txs);
        }

        const posFeeTx = await Transaction_Builder.createPosRewardTransaction(blockCandidate, this.validatorAccount.address);
        posFeeTx.id = await Transaction_Builder.hashTxToGetID(posFeeTx);
        const signedPosFeeTx = await this.validatorAccount.signAndReturnTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);

        return blockCandidate;
    }
    #getBlocksMiningInfo() {
        const blocksInfo = [];

        for (let i = 0; i < this.chain.length; i++) {
            const block = this.chain[i];

            blocksInfo.push({ 
                blockIndex: block.index,
                coinbaseReward: block.coinBase,
                timestamp: block.timestamp,
                difficulty: block.difficulty,
                timeBetweenBlocks: i === 0 ? 0 : block.timestamp - this.chain[i - 1].timestamp
            });
        }

        return blocksInfo;
    }
}
export class LightNode {
    
}

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