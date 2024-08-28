import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { mplex } from '@libp2p/mplex';
import { noise } from '@chainsafe/libp2p-noise';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { multiaddr } from 'multiaddr';
import { Wallet } from './wallet.mjs';

export class BlockchainNode {
	constructor(options = {}, pubSubManager, blockManager, eventBus) {
		this.options = options;
		this.pubSubManager = pubSubManager;
		this.blockManager = blockManager;
		this.node = null;
		this.role = options.role || 'full';
		this.eventBus = eventBus;
		this.bootstrapNodes = options.bootstrapNodes || [];
		this.wallet = new Wallet(this.node);
		this.wallet.deriveNewAccount();
	}

	async start() {
		this.node = await createLibp2p({
			addresses: {
				listen: [this.options.listenAddress || '/ip4/0.0.0.0/tcp/0']
			},
			transports: [tcp()],
			streamMuxers: [mplex()],
			connectionEncryption: [noise()],
			services: {
				identify: identify(),
				pubsub: gossipsub({
					emitSelf: false,
					gossipIncoming: true,
					fallbackToFloodsub: true,
					floodPublish: true,
					allowPublishToZeroPeers: true,
				})
			},
			peerDiscovery: [],
			connectionManager: {
				autoDial: true,
			},
		});	

		await this.node.start();

		this.pubSubManager.setNode(this.node);
		console.log(`${this.role} node started with ID: ${this.node.peerId.toString()}`);

		// Connect to bootstrap nodes
		for (const addr of this.bootstrapNodes) {
			console.log(`Connecting to bootstrap node: ${addr}`);
			try {
				const ma = multiaddr(addr);
				await this.node.dial(ma);
				console.log(`Connected to bootstrap node: ${addr}`);
			} catch (err) {
				console.error(`Failed to connect to bootstrap node ${addr}:`, err);
			}
		}
	}


	async stop() {
		if (this.node) {
			// TODO: remove 
			this.blockManager.latestBlockNumber = 0;
			await this.node.stop();
			console.log(`${this.role} node stopped`);
		}

	}

	setupEventListeners() {
	}

	getPubSubManager() {
		return this.pubSubManager;
	}

	getBlockManager() {
		return this.blockManager;
	}

	getRole() {
		return this.role;
	}

	emitEvent(eventName, data) {
		this.eventBus.emit(eventName, data);
	}

	addEventListener(eventName, listener) {
		this.eventBus.on(eventName, listener);
	}
}