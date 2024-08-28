import { ValidatorNode } from './nodes/validator-node.mjs';
import { MinerNode } from './nodes/miner-node.mjs';
import { BlockchainNode } from './blockchain-node.mjs';
import { PubSubManager } from './pubsub-manager.mjs';
import { BlockManager } from './block-manager.mjs';
import pkg from 'bloom-filters';
const { BloomFilter } = pkg;
import { BlockSerializer } from './serializers/block-serializer.mjs';
import { TransactionSerializer } from './serializers/transaction-serializer.mjs';
import { EventBus } from './event-bus.mjs';
import { VSSShareSerializer } from './vrf/vss-share-serializer.mjs';
import { AnnouncementSerializer } from './serializers/announcement-serializer.mjs';

import {
	BlockMessageHandler,
	TransactionMessageHandler,
	BlockCandidateMessageHandler,
	MinedBlockMessageHandler,
	VSSShareMessageHandler,
	AnnouncementMessageHandler,
	VRFProofMessageHandler
} from './messages-handlers.mjs';

class NodeManager {
	constructor(bootstrapNodes = []) {
		this.nodes = {};
		this.bootstrapNodes = bootstrapNodes;
	}

	async createNode(nodeId, options) {
		try {
			const bloomFilter = new BloomFilter(1024, 4);

			const storage = new LevelDBStorage('./blockchain-db' + nodeId);
			storage.open();

			const blockManager = new BlockManager(storage, nodeId);
			await blockManager.initialize();
			//await blockManager.initialize();
			const pubSubManager = new PubSubManager(bloomFilter, {
				logging: true,
				logLevel: 'info'
			});
			const blockSerializer = new BlockSerializer(1);
			const transactionSerializer = new TransactionSerializer(1);
			const vssShareSerializer = new VSSShareSerializer(1);
			const announcementSerializer = new AnnouncementSerializer(1);


			let eventBus = new EventBus();


			// Register message handlers
			pubSubManager.registerMessageType('blocks', new BlockMessageHandler(eventBus), blockSerializer);
			pubSubManager.registerMessageType('transactions', new TransactionMessageHandler(eventBus), transactionSerializer);
			pubSubManager.registerMessageType('block_candidate', new BlockCandidateMessageHandler(eventBus), blockSerializer);
			pubSubManager.registerMessageType('mined_block', new MinedBlockMessageHandler(eventBus), blockSerializer);
			pubSubManager.registerMessageType('vssShare', new VSSShareMessageHandler(eventBus), vssShareSerializer);
			pubSubManager.registerMessageType('validator-announce', new AnnouncementMessageHandler(eventBus), announcementSerializer);

			options.bootstrapNodes = this.bootstrapNodes;

			let node;
			switch (options.role) {
				case 'validator':
					options.totalValidators = 2;
					options.validatorIndex = 0;
					node = new ValidatorNode(options, pubSubManager, blockManager, eventBus);
					break;
				case 'miner':
					node = new MinerNode(options, pubSubManager, blockManager, eventBus);
					break;

				default:
					node = new BlockchainNode(options, pubSubManager, blockManager, eventBus);
			}

			await node.start();
			this.nodes[nodeId] = node;
			return node;
		} catch (error) {
			console.error(`Error creating node ${nodeId}:`, error);
			throw error;
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

export { NodeManager };