import { Node } from './node.mjs';
import { Account } from './account.mjs';
import { Wallet } from './wallet.mjs';

export class NodeFactory {
    constructor() {
        /** @type {Map<string, Node>} */
        this.nodes = new Map();
        this.wallet = null;
    }

    /**
     * @param {string} mnemonicHex
     * @param {number} nbOfAccounts
     * @param {string} addressType
     * @returns {Promise<Account[]>}
     */
    async initialize(mnemonicHex, nbOfAccounts = 100, addressType = 'W') {
        const startTime = Date.now();
        const timings = { walletRestore: 0, deriveAccounts: 0 };

        this.wallet = await Wallet.restore(mnemonicHex);
        if (!this.wallet) {
            throw new Error("Failed to restore wallet");
        }
        timings.walletRestore = Date.now() - startTime;

        this.wallet.loadAccounts();
        const { derivedAccounts, avgIterations } = await this.wallet.deriveAccounts(nbOfAccounts, addressType);
        if (!derivedAccounts) {
            throw new Error("Failed to derive accounts");
        }
        timings.deriveAccounts = Date.now() - (startTime + timings.walletRestore);

        this.wallet.saveAccounts();

        console.log(`
__Timings -----------------------
| -- walletRestore: ${timings.walletRestore}ms
| -- deriveAccounts(${nbOfAccounts}): ${timings.deriveAccounts}ms
| -- deriveAccountsAvg: ~${(timings.deriveAccounts / nbOfAccounts).toFixed(2)}ms
| -- deriveAccountAvgIterations: ${avgIterations}
| -- total: ${Date.now() - startTime}ms
---------------------------------`);

        return derivedAccounts;
    }

    /**
     * @param {Account} account
     * @param {Object<string, string>}
     */
    async createNode(account, p2pOptions = {}) {
        const node = await Node.load(account, p2pOptions);
        const nodeId = account.address;
        this.nodes.set(nodeId, node);
        return { node, nodeId };
    }
    /** @param {string} nodeId */
    async startNode(nodeId) {
        const node = this.getNode(nodeId);
        await node.start();
    }
    /** @param {string} nodeId */
    async stopNode(nodeId) {
        const node = this.getNode(nodeId);
        await node.stop();
    }
    /** @param {string} nodeId */
    getNode(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node) {
            throw new Error(`Node with ID ${nodeId} not found`);
        }
        return node;
    }

    getAllNodes() {
        return Array.from(this.nodes.values());
    }
    /** @param {Account[]} accounts */
    refreshAllBalances(accounts) {
        for (const node of this.nodes.values()) {
            for (const account of accounts) {
                const { spendableBalance, balance, UTXOs } = node.utxoCache.getBalanceSpendableAndUTXOs(account.address);
                account.setBalanceAndUTXOs(balance, UTXOs);
            }
        }
    }
}