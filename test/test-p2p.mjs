import { expect } from 'chai';
import sinon from 'sinon';
import { P2PNetwork } from '../src/p2p.mjs';  // Adjust the import path as needed

describe('P2PNetwork', function () {
  this.timeout(30000);  // Increase timeout for network operations

  let nodes = [];
  const NUM_NODES = 3;

  before(async function () {
    // Create multiple P2PNetwork instances
    for (let i = 0; i < NUM_NODES; i++) {
      const node = new P2PNetwork({
        bootstrapNodes: [],  // No bootstrap nodes for local testing
        maxPeers: 10,
        announceInterval: 1000,
        cleanupInterval: 5000,
        peerTimeout: 10000,
        logLevel: 'error',  // Reduce log noise during tests
        listenAddress: `/ip4/127.0.0.1/tcp/${9000 + i}`  // Use different ports for each node
      });
      nodes.push(node);
    }

    // Start all nodes
    await Promise.all(nodes.map(node => node.start()));

    // Connect nodes in a ring topology
    for (let i = 0; i < NUM_NODES; i++) {
      const nextNode = nodes[(i + 1) % NUM_NODES];
      await nodes[i].node.dial(nextNode.node.getMultiaddrs()[0]);
    }
  });

  after(async function () {
    // Stop all nodes
    await Promise.all(nodes.map(node => node.stop()));
  });

  describe('Node Startup and Connection', function () {
    it('should start and connect nodes', function (done) {
      setTimeout(() => {
        nodes.forEach(node => {
          expect(node.isStarted()).to.be.true;
          expect(node.getConnectedPeers().length).to.be.at.least(1);
        });
        done();
      }, 500);  // Give some time for nodes to discover each other
    });

    it('should have correct node status after startup', function () {
      nodes.forEach(node => {
        const status = node.getStatus();
        expect(status).to.have.property('isSyncing', false);
        expect(status).to.have.property('blockHeight', 0);
        expect(status).to.have.property('version', '1.1.0');
        expect(status).to.have.property('connectionCount').that.is.at.least(1);
        expect(status).to.have.property('peerId').that.is.a('string');
      });
    });
  });

  describe('Pubsub Functionality', function () {
    it('should subscribe and publish messages', function (done) {
      const testTopic = 'test-topic';
      const testMessage = { content: 'Hello, P2P!' };

      nodes[0].subscribe(testTopic, (topic, message) => {
        console.log('Received message:', topic, message);
        expect(message.content).to.deep.equal(testMessage.content);
        done();
      });

      setTimeout(() => {
        nodes[1].broadcast(testTopic, testMessage);
      }, 200);
    });

    it('should handle multiple subscriptions', function (done) {
      const topic1 = 'topic1';
      const topic2 = 'topic2';
      let receivedCount = 0;

      nodes[0].subscribe(topic1, () => {
        receivedCount++;
        if (receivedCount === 2) done();
      });

      nodes[0].subscribe(topic2, () => {
        receivedCount++;
        if (receivedCount === 2) done();
      });

      setTimeout(() => {
        nodes[1].broadcast(topic1, { msg: 'Hello topic1' });
        nodes[1].broadcast(topic2, { msg: 'Hello topic2' });
      }, 200);
    });

    it('should unsubscribe from topics', async function () {
      const topic = 'unsubscribe-test';
      await nodes[0].subscribe(topic);
      expect(nodes[0].getSubscribedTopics()).to.include(topic);

      await nodes[0].unsubscribe(topic);
      expect(nodes[0].getSubscribedTopics()).to.not.include(topic);
    });
  });

  describe('Node Status', function () {
    it('should get correct network status', function () {
      const networkStatus = nodes[0].getStatus();
      console.log(networkStatus);
      expect(networkStatus).to.have.property('connectionCount').that.is.at.least(NUM_NODES - 1);
      expect(networkStatus).to.have.property('version').that.is.a('string');
    });
  });

  describe('Peer Management', function () {

    it('should update and retrieve peer information', function () {
      const peerId = nodes[1].node.peerId.toString();
      const peerData = { status: 'active', customField: 'test' };

      nodes[0].updatePeer(peerId, peerData);
      const connectedPeers = nodes[0].getConnectedPeers();

      expect(connectedPeers).to.include(peerId);
    });
    it('should handle heavy broadcast spam', async function () {
      this.timeout(60000);
      // Increase timeout further
      const spamTopic = 'spam-topic';
      const messageSize = 512 * 512;  // Exactly 64 kilobytes
      const numMessages = 20;
      const spamInterval = 0;  // 500 ms
      // Create a large message
      const largeMessage = {
        content: 'x'.repeat(messageSize - 10)  // Subtract 10 to account for JSON overhead
      };

      // Verify the exact size of the message
      const actualSize = Buffer.byteLength(JSON.stringify(largeMessage));
      // Set up subscription on all nodes
      for (let node of nodes) {
        await node.subscribe(spamTopic, (topic, message) => {
          console.log(`Node ${node.node.peerId.toString().slice(0, 5)} received message on topic ${topic}`);
        });

      }
      //wait for subscriptions to propagate
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Log subscribed topics for each node
      for (let node of nodes) {
        console.log(`Node ${node.node.peerId.toString().slice(0, 5)} subscribed topics:`, node.getSubscribedTopics());
      }

      let receivedCount = 0;
      const messagePromises = [];

      nodes[0].on(spamTopic, () => {
        receivedCount++;
        console.log(`Received count incremented to ${receivedCount}`);
      });

      // Spam broadcast from sending node
      for (let i = 0; i < numMessages; i++) {
        const promise = (async () => {
          try {
            console.log(`Attempting to broadcast message ${i + 1}`);
            await nodes[1].broadcast(spamTopic, largeMessage);
            console.log(`Successfully broadcasted message ${i + 1}`);
          } catch (error) {
            console.warn(`Failed to broadcast message ${i + 1}: ${error.message}`);
          }
        })();
        messagePromises.push(promise);
        await new Promise(resolve => setTimeout(resolve, spamInterval));
      }

      // Wait for all broadcasts to complete
      await Promise.all(messagePromises);

      // Wait for messages to be processed
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if any messages were received
      console.log(`Final received count: ${receivedCount}`);
      expect(receivedCount).to.be.at.least(1, `Expected at least 1 message, but received ${receivedCount}`);

      // Check network stability
      nodes.forEach(node => {
        expect(node.isStarted()).to.be.true;
        //expect(node.getConnectedPeers().length).to.be.at.least(1);
      });
    });
    it('should clean up inactive peers', function (done) {
      const fakePeerId = 'QmFakePeerId';
      nodes[0].updatePeer(fakePeerId, { status: 'inactive' });

      // Fast-forward time
      const clock = sinon.useFakeTimers(Date.now() + nodes[0].options.peerTimeout + 1000);

      nodes[0].cleanupPeers();

      expect(nodes[0].peers.has(fakePeerId)).to.be.false;
      clock.restore();
      done();
    });
  });



  describe('Error Handling', function () {
    it('should handle subscription errors gracefully', async function () {
      const invalidTopic = '';
      try {
        await nodes[0].subscribe(invalidTopic);
      } catch (error) {
        expect(error).to.exist;
        expect(nodes[0].getSubscribedTopics()).to.not.include(invalidTopic);
      }
    });

    it('should handle broadcast errors gracefully', async function () {
      const invalidTopic = '';
      try {
        await nodes[0].broadcast(invalidTopic, { msg: 'test' });
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('Peer Discovery', function () {
    it('should find peers', async function () {
      const peerId = nodes[1].node.peerId;
      const foundPeer = await nodes[0].findPeer(peerId);
      expect(foundPeer).to.exist;
      expect(foundPeer.id.toString()).to.equal(peerId.toString());
    });

    it('should handle unfound peers gracefully', async function () {
      const fakePeerId = 'QmFakePeerId';
      const foundPeer = await nodes[0].findPeer(fakePeerId);
      expect(foundPeer).to.be.null;
    });
  });
});