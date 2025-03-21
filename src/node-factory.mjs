import { Node } from './node.mjs';
import { Account } from './account.mjs';
import { Wallet } from './wallet.mjs';

export class NodeFactory {
    constructor() {
        /** @type {Map<string, Node>} */
        this.nodes = new Map();
    }

    /**
     * @param {Account} account
     * @param {string[]} roles
     * @param {Object<string, string>}
     */
    async createNode(account, roles = ['validator'], p2pOptions = {}) {
        const rolesArray = Array.isArray(roles) ? roles : [roles];
        const node = new Node(account, rolesArray, p2pOptions);
        this.nodes.set(node.id, node);
        console.log(`Node ${node.id} created`);
        return node;
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
            // log all nodes
            console.log(`Nodes: ${Array.from(this.nodes.keys()).join(', ')}`);


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