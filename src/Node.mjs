
import storage from './storage.mjs';
import { BlockData, Block, Transaction_Builder, Validation, TxIO_Builder } from './index.mjs';
import utils from './utils.mjs';


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