// test/sync.test.js

import { expect } from 'chai'
import { SyncNode } from '../src/sync.mjs'
import { multiaddr } from 'multiaddr'
import sinon from 'sinon'
describe('SyncNode', function () {
    this.timeout(30000) // Increase timeout for longer tests

    let node1, node2

    before(async function () {
        node1 = new SyncNode(10000)
        node2 = new SyncNode(10001)

        await node1.start()
        await node2.start()
    })

    after(async function () {
        await node1.stop()
        await node2.stop()
    })

    it('should connect nodes successfully', async function () {
        await new Promise(resolve => setTimeout(resolve, 1000))
        const node1Addr = node1.node.getMultiaddrs()[0].toString()
        await node2.connect(multiaddr(node1Addr))

        const node1Peers = await node1.peers
        const node2Peers = await node2.peers
    })

    return;

    it('should send and receive small messages', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const testMessage = { type: 'test', content: 'Hello, libp2p!' }

        const response = await node2.sendMessage(node1Addr, testMessage)

        expect(response).to.deep.equal({
            status: 'received',
            echo: testMessage
        })
    })

    it('should handle large messages (simulating a large block)', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const largeBlock = {
            type: 'block',
            index: 1000000,
            data: 'x'.repeat(2000000) // 1MB of data
        }

        const response = await node2.sendMessage(node1Addr, largeBlock)

        expect(response).to.deep.equal({
            status: 'received',
            echo: largeBlock
        })
    })

    it('should handle multiple messages in quick succession (simulating rapid block propagation)', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const blocks = Array.from({ length: 10 }, (_, i) => ({
            type: 'block',
            index: i,
            data: `Block data ${i}`.repeat(1000) // ~10KB per block
        }))

        const responses = await Promise.all(blocks.map(block => node2.sendMessage(node1Addr, block)))

        responses.forEach((response, i) => {
            expect(response).to.deep.equal({
                status: 'received',
                echo: blocks[i]
            })
        })
    })

    it('should handle request for multiple blocks', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const request = {
            type: 'getBlocks',
            startIndex: 1000,
            endIndex: 1010
        }

        // Mock the block data on node1
        node1.mockBlockData = Array.from({ length: 11 }, (_, i) => ({
            index: 1000 + i,
            data: `Block data ${1000 + i}`.repeat(100)
        }))

        const response = await node2.sendMessage(node1Addr, request)

        expect(response.status).to.equal('success')
        expect(response.blocks).to.have.length(11)
        expect(response.blocks[0].index).to.equal(1000)
        expect(response.blocks[10].index).to.equal(1010)
    })

    it('should handle errors gracefully', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const invalidRequest = {
            type: 'invalid',
            data: 'This should cause an error'
        }

        try {
            await node2.sendMessage(node1Addr, invalidRequest)
            expect.fail('Should have thrown an error')
        } catch (error) {
            expect(error.message).to.include('Invalid request type')
        }
    })

    it('should handle very large messages (simulating an extremely large block)', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const veryLargeBlock = {
            type: 'block',
            index: 1000000,
            data: 'x'.repeat(10000000) // 10MB of data
        }

        const response = await node2.sendMessage(node1Addr, veryLargeBlock)

        expect(response).to.deep.equal({
            status: 'received',
            echo: veryLargeBlock
        })
    })

    it('should handle a high number of concurrent requests', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const requests = Array.from({ length: 50 }, (_, i) => ({
            type: 'test',
            content: `Concurrent request ${i}`
        }))

        const responses = await Promise.allSettled(requests.map(req => node2.sendMessage(node1Addr, req)))

        const successfulResponses = responses.filter(r => r.status === 'fulfilled')
        expect(successfulResponses.length).to.be.at.least(1) // At least some requests should succeed

        successfulResponses.forEach((response) => {
            expect(response.value).to.have.property('status', 'received')
            expect(response.value.echo).to.have.property('type', 'test')
        })
    })

    it('should handle requests for non-existent blocks', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const request = {
            type: 'getBlocks',
            startIndex: 10000,
            endIndex: 10010
        }

        // Mock empty block data on node1
        node1.mockBlockData = []

        const response = await node2.sendMessage(node1Addr, request)

        expect(response.status).to.equal('success')
        expect(response.blocks).to.have.length(0)
    })

    it('should handle requests with invalid block range', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const request = {
            type: 'getBlocks',
            startIndex: 1010,
            endIndex: 1000 // End index less than start index
        }

        try {
            await node2.sendMessage(node1Addr, request)
            expect.fail('Should have thrown an error')
        } catch (error) {
            expect(error.message).to.include('Invalid block range')
        }
    })

    it('should handle requests with extremely large block ranges', async function () {
        const node1Addr = node1.node.getMultiaddrs()[0]
        const request = {
            type: 'getBlocks',
            startIndex: 1,
            endIndex: 1000000 // Requesting a million blocks
        }

        // Mock some block data on node1
        node1.mockBlockData = Array.from({ length: 1000000 }, (_, i) => ({
            index: i + 1,
            data: `Block data ${i + 1}`
        }))

        const response = await node2.sendMessage(node1Addr, request)

        expect(response.status).to.equal('success')
        expect(response.blocks.length).to.be.at.most(10000) // Assuming we've implemented a limit
        expect(response.blocks[0].index).to.equal(1)
    })
})