import { Wallet } from '../src/wallet.mjs';
import { Node } from '../src/node.mjs';
import { Account } from '../src/account.mjs';
import utils from '../src/utils.mjs';

export class BlockchainHelpers {
    constructor(useDevArgon2 = true) {
        this.wallet = new Wallet(utils.devParams.masterHex, useDevArgon2);
        this.useDevArgon2 = useDevArgon2;
    }

    /**
     * Create a random account with the specified address prefix
     * @param {string} addressPrefix - The prefix for the account address (e.g., 'W' or 'C')
     * @returns {Promise<Account>} A promise that resolves to the created account
     */
    async createRandomAccount(addressPrefix = 'W') {
        const maxAttempts = 1000; // Limit the number of attempts to prevent infinite loops
        for (let attempt = 0; attempt < maxAttempts; attempt++) {

            try {
                let randomAccountIndex = Math.floor(Math.random() * 65536);
                const result = await this.wallet.tryDerivationUntilValidAccount(randomAccountIndex, addressPrefix);
                if (result && result.account) {
                    return result.account;
                }
            } catch (error) {
                console.error(`Attempt ${attempt + 1} failed: ${error.message}`);
                // Continue to the next iteration
            }
        }

        console.error(`Failed to create random account after ${maxAttempts} attempts`);
        return null;
    }

    /**
     * Create multiple random accounts with the specified address prefix
     * @param {number} count - The number of accounts to create
     * @param {string} addressPrefix - The prefix for the account addresses
     * @returns {Promise<Account[]>} A promise that resolves to an array of created accounts
     */
    async createMultipleRandomAccounts(count, addressPrefix = 'W') {
        const accounts = [];
        for (let i = 0; i < count; i++) {
            const account = await this.createRandomAccount(addressPrefix);
            if (account) {
                accounts.push(account);
            }
        }
        return accounts;
    }

    /**
     * Create a new node with the specified roles
     * @param {Account} account - The account to associate with the node
     * @param {string[]} roles - The roles for the node (e.g., ['validator', 'miner'])
     * @param {Object} p2pOptions - Options for the P2P network
     * @returns {Promise<Node>} A promise that resolves to the created node
     */
    async createNode(account, roles = ['validator'], p2pOptions = {}) {
        const node = new Node(account, roles, p2pOptions);
        await node.start();
        return node;
    }

    /**
     * Create multiple nodes with random accounts
     * @param {number} count - The number of nodes to create
     * @param {string[]} roles - The roles for the nodes
     * @param {Object} p2pOptions - Options for the P2P network
     * @returns {Promise<Node[]>} A promise that resolves to an array of created nodes
     */
    async createMultipleNodes(count, roles = ['validator'], p2pOptions = {}) {
        const nodes = [];
        for (let i = 0; i < count; i++) {
            const account = await this.createRandomAccount('W');
            if (account) {
                const node = await this.createNode(account, roles, p2pOptions);
                nodes.push(node);
            }
        }
        return nodes;
    }
}