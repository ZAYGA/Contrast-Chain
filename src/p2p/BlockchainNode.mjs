const libp2p = require('libp2p')
const TCP = require('libp2p-tcp')
const MPLEX = require('libp2p-mplex')
const { NOISE } = require('libp2p-noise')
const MDNS = require('libp2p-mdns')
const KadDHT = require('libp2p-kad-dht')
const GossipSub = require('libp2p-gossipsub')
const LevelStore = require('datastore-level')
const BlockchainDB = require('level')
const crypto = require('crypto')

class BlockchainNode {
  constructor(config) {
    this.config = config
    this.blockchain = []
    this.mempool = new Set()
  }

  async start() {
    // Initialize libp2p node
    this.node = await libp2p.create({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0']
      },
      modules: {
        transport: [TCP],
        streamMuxer: [MPLEX],
        connEncryption: [NOISE],
        peerDiscovery: [MDNS],
        dht: KadDHT,
        pubsub: GossipSub
      },
      config: {
        dht: {
          enabled: true,
          randomWalk: {
            enabled: true
          }
        },
        pubsub: {
          enabled: true,
          emitSelf: false
        }
      },
      datastore: new LevelStore('libp2p')
    })

    // Initialize blockchain database
    this.db = new BlockchainDB('./blockchain-db')

    // Set up event handlers
    this.node.on('peer:discovery', this.handlePeerDiscovery.bind(this))
    this.node.pubsub.on('block', this.handleNewBlock.bind(this))
    this.node.pubsub.on('transaction', this.handleNewTransaction.bind(this))

    // Start libp2p node
    await this.node.start()
    console.log('Node started with ID:', this.node.peerId.toB58String())

    // Subscribe to relevant topics
    await this.node.pubsub.subscribe('block')
    await this.node.pubsub.subscribe('transaction')
  }

  async stop() {
    await this.node.stop()
    await this.db.close()
  }

  handlePeerDiscovery(peer) {
    console.log('Discovered:', peer.id.toB58String())
    this.node.dial(peer).catch(err => console.error('Failed to dial:', err))
  }

  async handleNewBlock(msg) {
    const block = JSON.parse(msg.data.toString())
    if (this.isValidBlock(block)) {
      await this.addBlock(block)
      this.propagateBlock(block)
    }
  }

  handleNewTransaction(msg) {
    const tx = JSON.parse(msg.data.toString())
    if (this.isValidTransaction(tx)) {
      this.mempool.add(tx)
    }
  }

  isValidBlock(block) {
    // Implement block validation logic
    return true
  }

  isValidTransaction(tx) {
    // Implement transaction validation logic
    return true
  }

  async addBlock(block) {
    this.blockchain.push(block)
    await this.db.put(`block-${block.height}`, JSON.stringify(block))
    // Remove transactions in the block from mempool
    block.transactions.forEach(tx => this.mempool.delete(tx))
  }

  propagateBlock(block) {
    this.node.pubsub.publish('block', Buffer.from(JSON.stringify(block)))
  }

  broadcastTransaction(tx) {
    this.node.pubsub.publish('transaction', Buffer.from(JSON.stringify(tx)))
  }

  async mineBlock() {
    const previousBlock = this.blockchain[this.blockchain.length - 1]
    const newBlock = {
      height: previousBlock ? previousBlock.height + 1 : 0,
      previousHash: previousBlock ? this.calculateHash(previousBlock) : null,
      timestamp: Date.now(),
      transactions: Array.from(this.mempool).slice(0, 100), // Limit to 100 transactions per block
      nonce: 0
    }

    // Implement Proof of Work or other consensus mechanism
    while (!this.isValidBlockHash(this.calculateHash(newBlock))) {
      newBlock.nonce++
    }

    await this.addBlock(newBlock)
    this.propagateBlock(newBlock)
  }

  calculateHash(block) {
    return crypto.createHash('sha256').update(JSON.stringify(block)).digest('hex')
  }

  isValidBlockHash(hash) {
    // Implement difficulty check
    return hash.startsWith('0000')
  }
}

module.exports = BlockchainNode