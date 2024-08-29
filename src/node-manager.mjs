import { Account } from "./account.mjs";
import { NodeFactory } from './node-factory.mjs';

/**
 * @typedef {import("./node.mjs").Node} Node
 */

export class NodeManager {
    /**
     * @param {Account[]} accounts
     * @param {string[]} bootstrapNodes ?
     */
	constructor(accounts, bootstrapNodes = []) {
        /** @type {Account[]} */
        this.accounts = accounts;
		/** @type {Object.<string, Node>} */
		this.nodes = {};
		this.bootstrapNodes = bootstrapNodes; // merci de déclarer le type =)
	}

    async createsNodes(nbOfNodes = 1) {
        const nodesToCreate = Math.min(nbOfNodes, this.accounts.length);
        for (let i = 0; i < nodesToCreate; i++) {
			const nodeId = this.accounts[i].address;
            const node = await NodeFactory.createNode(this.bootstrapNodes, nodeConfig);
            this.nodes[nodeId] = node;
        }
    }

    getNode(nodeId) {
		return this.nodes[nodeId];
	}

	async shutdownNode(nodeId) {
		const node = this.nodes[nodeId];
		if (node) {
			await node.stop();
			delete this.nodes[nodeId];
		}
	}

	async shutdownAllNodes() {
		const shutdownPromises = Object.values(this.nodes).map(node => node.stop());
		await Promise.all(shutdownPromises);
		this.nodes = {};
	}

	async subscribeAll(topic, callback) {
		const subscribePromises = Object.values(this.nodes).map(node =>
			node.getPubSubManager().subscribe(topic, callback)
		);
		await Promise.all(subscribePromises);
	}

	async connectAllNodes() {
		const nodeIds = Object.keys(this.nodes);
		for (let i = 0; i < nodeIds.length; i++) {
			for (let j = i + 1; j < nodeIds.length; j++) {
				const node1 = this.nodes[nodeIds[i]];
				const node2 = this.nodes[nodeIds[j]];
				try {
					await node1.node.dial(node2.node.getMultiaddrs()[0]);
				} catch (error) {
					console.error(`Error connecting ${nodeIds[i]} to ${nodeIds[j]}:`, error);
				}
			}
		}
		console.log('All nodes connected');
	}
}