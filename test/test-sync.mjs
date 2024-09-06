import { expect } from 'chai'
import { SyncNode } from '../src/sync.mjs'
import { multiaddr } from 'multiaddr'
import sinon from 'sinon'
import { NodeFactory } from '../src/node-factory.mjs'
import { Wallet } from '../src/wallet.mjs'

describe('SyncNode', function () {
    this.timeout(60000) // Increase timeout for longer tests

    const NUM_NODES = 3
    let factory
    let nodes = []
    let wallet
    let accounts = []

    before(async function () {
        console.info('Initializing test environment...')
        factory = new NodeFactory()
        wallet = new Wallet()

        const derivedAccounts = await wallet.loadOrCreateAccounts()
        accounts = derivedAccounts
        if (!derivedAccounts) throw new Error('Failed to derive accounts.')

        console.info(`Derived ${derivedAccounts.length} accounts.`)

        // Create and start nodes
        for (let i = 0; i < NUM_NODES; i++) {
            const role = i === 0 ? 'miner' : 'validator'
            const node = await factory.createNode(derivedAccounts[i], role)
            nodes.push(node)
            await node.start()
        }

        await waitForP2PNetworkReady(nodes)
    })

    after(async function () {
        console.info('Cleaning up test environment...')
        for (const node of nodes) {
            await factory.stopNode(node.id)
        }
    })

    it('should connect nodes successfully', async function () {
        const connectedPeers = nodes.map(node => node.p2pNetwork.getConnectedPeers().length)
        connectedPeers.forEach((peerCount, index) => {
            expect(peerCount).to.be.at.least(NUM_NODES - 1, `Node ${index} should be connected to at least ${NUM_NODES - 1} peers`)
        })
    })

    it('should send and receive small messages', async function () {
        const testMessage = { type: 'test', content: 'Hello, libp2p!' }
        const sender = nodes[0]
        const receiver = nodes[1]

        const response = await sender.p2pNetwork.sendMessage(receiver.p2pNetwork.node.getMultiaddrs()[0], testMessage)

        expect(response).to.deep.equal(testMessage)
    })

    it('should handle large messages (simulating a large block)', async function () {
        const largeBlock = {
            type: 'block',
            index: 1000000,
            data: 'x'.repeat(2000000) // 2MB of data
        }
        const sender = nodes[1]
        const receiver = nodes[2]

        const response = await sender.p2pNetwork.sendMessage(receiver.p2pNetwork.node.getMultiaddrs()[0], largeBlock)

        expect(response).to.deep.equal({
            status: 'received',
            echo: largeBlock
        })
    })

    it('should handle multiple messages in quick succession', async function () {
        const blocks = Array.from({ length: 10 }, (_, i) => ({
            type: 'block',
            index: i,
            data: `Block data ${i}`.repeat(1000) // ~10KB per block
        }))
        const sender = nodes[0]
        const receiver = nodes[1]

        const responses = await Promise.all(blocks.map(block =>
            sender.p2pNetwork.sendMessage(receiver.p2pNetwork.node.getMultiaddrs()[0], block)
        ))

        responses.forEach((response, i) => {
            expect(response).to.deep.equal({
                status: 'received',
                echo: blocks[i]
            })
        })
    })

    // Helper function
    async function waitForP2PNetworkReady(nodes, maxAttempts = 30, interval = 1000) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const allNodesConnected = nodes.every(node => {
                const peerCount = node.p2pNetwork.getConnectedPeers().length
                return peerCount >= NUM_NODES - 1
            })

            if (allNodesConnected) {
                console.info('P2P network is ready')
                return
            }

            await new Promise(resolve => setTimeout(resolve, interval))
        }

        throw new Error('P2P network failed to initialize within the expected time')
    }
})