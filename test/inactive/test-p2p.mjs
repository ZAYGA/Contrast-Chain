// Filename: test/p2pnetwork.test.js

import { expect } from 'chai';
import { P2PNetwork } from '../../src/p2p.mjs'; // Adjust the import path accordingly
import utils from '../../src/utils.mjs'; // Adjust the import path accordingly

describe('P2PNetwork', function () {
  this.timeout(30000); // Increase timeout for async operations

  let p2pNetwork;
  let peerNetwork;

  beforeEach(async () => {
    // Initialize P2PNetwork instances with custom options for testing
    p2pNetwork = new P2PNetwork({
      bootstrapNodes: [],
      maxPeers: 5,
      listenAddress: '/ip4/127.0.0.1/tcp/0', // Use port 0 to get a random available port
      logLevel: 'silent',
      logging: false,
    });

    peerNetwork = new P2PNetwork({
      bootstrapNodes: [],
      maxPeers: 5,
      listenAddress: '/ip4/127.0.0.1/tcp/0',
      logLevel: 'silent',
      logging: false,
    });

    // Start both networks
    await p2pNetwork.start();
    await peerNetwork.start();

    // Connect the two nodes
    await p2pNetwork.p2pNode.dial(peerNetwork.p2pNode.getMultiaddrs()[0]);
  });

  afterEach(async () => {


  });

  describe('Constructor', () => {
    it('should initialize with default options', () => {
      const defaultNetwork = new P2PNetwork();
      expect(defaultNetwork.options).to.be.an('object');
      expect(defaultNetwork.options.bootstrapNodes).to.be.an('array');
      expect(defaultNetwork.options.maxPeers).to.equal(50);
      expect(defaultNetwork.options.listenAddress).to.equal('/ip4/0.0.0.0/tcp/7777');
    });

    it('should override default options with provided options', () => {
      const customOptions = {
        maxPeers: 10,
        listenAddress: '/ip4/127.0.0.1/tcp/8000',
      };
      const customNetwork = new P2PNetwork(customOptions);
      expect(customNetwork.options.maxPeers).to.equal(10);
      expect(customNetwork.options.listenAddress).to.equal('/ip4/127.0.0.1/tcp/8000');
    });
  });

  describe('Start and Stop', () => {
    it('should start the network', async () => {
      expect(p2pNetwork.isStarted()).to.be.true;
      expect(p2pNetwork.p2pNode).to.exist;
    });


  });

  describe('PubSub Operations', () => {
    it('should subscribe to a topic and receive messages', async () => {
      const messageHandlerSpy = (topic, message) => {
        expect(topic).to.equal('test_topic');
        expect(message).to.deep.equal({ data: 'Hello, World!' });
      };
      await p2pNetwork.subscribe('test_topic', messageHandlerSpy);

      // Wait a bit to ensure subscription is set up
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Have the peer send a message
      await peerNetwork.broadcast('test_topic', { data: 'Hello, World!' });

      // Wait for message to be received
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it('should unsubscribe from a topic', async () => {
      await p2pNetwork.subscribe('test_topic');
      expect(p2pNetwork.subscriptions.has('test_topic')).to.be.true;

      await p2pNetwork.unsubscribe('test_topic');
      expect(p2pNetwork.subscriptions.has('test_topic')).to.be.false;
    });

    it('should broadcast a message to subscribed peers', async () => {
      const messageHandlerSpy = (topic, message) => {
        expect(topic).to.equal('test_topic');
        expect(message).to.deep.equal({ data: 'Hello, Peers!' });
      };
      await peerNetwork.subscribe('test_topic', messageHandlerSpy);

      // Wait a bit to ensure subscription is set up
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Broadcast message from p2pNetwork
      await p2pNetwork.broadcast('test_topic', { data: 'Hello, Peers!' });

      // Wait for message to be received
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  });

  describe('Peer Management', () => {
    it('should update peer information', () => {
      const peerId = 'QmPeerId';
      const data = { status: 'connected', address: '/ip4/127.0.0.1/tcp/8000' };
      p2pNetwork.updatePeer(peerId, data);

      expect(p2pNetwork.peers.has(peerId)).to.be.true;
      const peerInfo = p2pNetwork.peers.get(peerId);
      expect(peerInfo.status).to.equal('connected');
      expect(peerInfo.address).to.equal('/ip4/127.0.0.1/tcp/8000');
    });

    it('should retrieve connected peers', () => {
      const connectedPeers = p2pNetwork.getConnectedPeers();
      expect(connectedPeers).to.be.an('array').that.is.not.empty;
    });

    it('should retrieve subscribed topics', async () => {
      await p2pNetwork.subscribe('topic1');
      await p2pNetwork.subscribe('topic2');

      const topics = p2pNetwork.getSubscribedTopics();
      expect(topics).to.include('topic1');
      expect(topics).to.include('topic2');
    });
  });

  describe('Status and Utility Methods', () => {
    it('should retrieve network status', () => {
      const status = p2pNetwork.getStatus();
      expect(status).to.have.property('isSyncing', false);
      expect(status).to.have.property('blockHeight', 0);
      expect(status).to.have.property('version', '1.1.0');
      expect(status).to.have.property('connectionCount');
      expect(status).to.have.property('peerId');
    });

    it('should correctly report if the network is started', () => {
      expect(p2pNetwork.isStarted()).to.be.true;
      p2pNetwork.stop();
      expect(p2pNetwork.isStarted()).to.be.false;
    });
  });

  describe('Send and Receive Messages', () => {
    it('should send a message to a specific peer and receive a response', async () => {
      // For this test, we need to implement a simple protocol handler on the peer
      const testProtocol = '/test-protocol/1.0.0';

      // PeerNetwork handles incoming messages
      peerNetwork.p2pNode.handle(testProtocol, async ({ stream }) => {
        // Read the message
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        const receivedData = Buffer.concat(chunks);
        const message = utils.compression.msgpack_Zlib.rawData.fromBinary_v1(receivedData);

        // Send a response
        const response = utils.compression.msgpack_Zlib.rawData.toBinary_v1({ data: 'Response from peer' });
        await stream.sink([response]);
      });

      // p2pNetwork sends a message
      const peerAddr = peerNetwork.p2pNode.getMultiaddrs()[0];
      const stream = await p2pNetwork.p2pNode.dialProtocol(peerAddr, testProtocol);

      const message = utils.compression.msgpack_Zlib.rawData.toBinary_v1({ data: 'Hello, Peer!' });
      await stream.sink([message]);

      // Read the response
      const chunks = [];
      for await (const chunk of stream.source) {
        chunks.push(chunk);
      }
      const receivedData = Buffer.concat(chunks);
      const response = utils.compression.msgpack_Zlib.rawData.fromBinary_v1(receivedData);

      expect(response).to.deep.equal({ data: 'Response from peer' });
    });
  });
});
