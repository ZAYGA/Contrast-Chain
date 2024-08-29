import { expect } from 'chai';
import sinon from 'sinon';
import { P2PNetwork } from '../src/p2p.mjs';  // Adjust the import path as needed

describe('P2PNetwork', function() {
  this.timeout(30000);  // Increase timeout for network operations

  let nodes = [];
  const NUM_NODES = 3;

  before(async function() {
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

  after(async function() {
    // Stop all nodes
    await Promise.all(nodes.map(node => node.stop()));
  });

  describe('Node Startup and Connection', function() {
    it('should start and connect nodes', function(done) {
      setTimeout(() => {
        nodes.forEach(node => {
          expect(node.isStarted()).to.be.true;
          expect(node.getConnectedPeers().length).to.be.at.least(1);
        });
        done();
      }, 500);  // Give some time for nodes to discover each other
    });

    it('should have correct node status after startup', function() {
      nodes.forEach(node => {
        const status = node.getNodeStatus();
        expect(status).to.have.property('isSyncing', false);
        expect(status).to.have.property('blockHeight', 0);
        expect(status).to.have.property('version', '1.1.0');
        expect(status).to.have.property('connectionCount').that.is.at.least(1);
        expect(status).to.have.property('peerId').that.is.a('string');
      });
    });
  });

  describe('Pubsub Functionality', function() {
    it('should subscribe and publish messages', function(done) {
      const testTopic = 'test-topic';
      const testMessage = { content: 'Hello, P2P!' };

      nodes[0].subscribe(testTopic, (message, from) => {
        expect(message).to.deep.equal(testMessage);
        expect(from).to.not.equal(nodes[0].node.peerId.toString());
        done();
      });

      setTimeout(() => {
        nodes[1].broadcast(testTopic, testMessage);
      }, 200);
    });

    it('should handle multiple subscriptions', function(done) {
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

    it('should unsubscribe from topics', async function() {
      const topic = 'unsubscribe-test';
      await nodes[0].subscribe(topic);
      expect(nodes[0].getSubscribedTopics()).to.include(topic);
      
      await nodes[0].unsubscribe(topic);
      expect(nodes[0].getSubscribedTopics()).to.not.include(topic);
    });
  });

  describe('Node Status', function() {
    it('should get correct network status', function() {
      const networkStatus = nodes[0].getNodeStatus();
      console.log(networkStatus);
      expect(networkStatus).to.have.property('connectionCount').that.is.at.least(NUM_NODES - 1);
      expect(networkStatus).to.have.property('version').that.is.a('string');
    });
  });

  describe('Peer Management', function() {
    it('should handle peer announcements', function(done) {
      const announceTopic = 'peer:announce';
      let announcementsReceived = 0;

      nodes.forEach(node => {
        node.on(announceTopic, (message) => {
          expect(message).to.have.property('peerId');
          expect(message).to.have.property('status');
          announcementsReceived++;

          if (announcementsReceived === NUM_NODES - 1) {
            done();
          }
        });
      });

      nodes[0].announcePeer();
    });

    it('should update and retrieve peer information', function() {
      const peerId = nodes[1].node.peerId.toString();
      const peerData = { status: 'active', customField: 'test' };

      nodes[0].updatePeer(peerId, peerData);
      const connectedPeers = nodes[0].getConnectedPeers();

      expect(connectedPeers).to.include(peerId);
    });

    it('should clean up inactive peers', function(done) {
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



  describe('Error Handling', function() {
    it('should handle subscription errors gracefully', async function() {
      const invalidTopic = '';
      try {
        await nodes[0].subscribe(invalidTopic);
      } catch (error) {
        expect(error).to.exist;
        expect(nodes[0].getSubscribedTopics()).to.not.include(invalidTopic);
      }
    });

    it('should handle broadcast errors gracefully', async function() {
      const invalidTopic = '';
      try {
        await nodes[0].broadcast(invalidTopic, { msg: 'test' });
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('Peer Discovery', function() {
    it('should find peers', async function() {
      const peerId = nodes[1].node.peerId;
      const foundPeer = await nodes[0].findPeer(peerId);
      expect(foundPeer).to.exist;
      expect(foundPeer.id.toString()).to.equal(peerId.toString());
    });

    it('should handle unfound peers gracefully', async function() {
      const fakePeerId = 'QmFakePeerId';
      const foundPeer = await nodes[0].findPeer(fakePeerId);
      expect(foundPeer).to.be.null;
    });
  });
});