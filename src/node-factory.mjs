//import pkg from 'bloom-filters';
//const { BloomFilter } = pkg;
import { BloomFilter } from 'bloom-filters'; // working ?
import { Node } from "./node.mjs";
import { PubSubManager } from './pubsub-manager.mjs';
import { BlockSerializer } from './serializers/block-serializer.mjs';
import { TransactionSerializer } from './serializers/transaction-serializer.mjs';
import { VSSShareSerializer } from './vrf/vss-share-serializer.mjs';
import { AnnouncementSerializer } from './serializers/announcement-serializer.mjs';
import { EventBus } from './event-bus.mjs';

import {
	BlockMessageHandler,
	TransactionMessageHandler,
	BlockCandidateMessageHandler,
	MinedBlockMessageHandler,
	VSSShareMessageHandler,
	AnnouncementMessageHandler
} from './messages-handlers.mjs';

export class NodeFactory {
    static async createNode(bootstrapNodes, nodeConfig) {
        try {
			const bloomFilter = new BloomFilter(1024, 4);
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

			options.bootstrapNodes = bootstrapNodes;

			const node = await Node.load(nodeConfig, pubSubManager, eventBus);
			/*switch (options.role) {
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
			}*/

			return node;
		} catch (error) {
			console.error(`Error creating node ${nodeId}:`, error);
			throw error;
		}
    }
}