import { expect } from 'chai';
import sinon from 'sinon';
import { NetworkManager } from '../../src/network-manager.mjs';

describe('NetworkManager', () => {
  let networkManager;
  let mockNode;
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    
    mockNode = {
      peerId: { toString: () => 'mockNodeId' },
      services: {
        pubsub: {
          subscribe: sinon.stub(),
          publish: sinon.stub().resolves(),
          unsubscribe: sinon.stub()
        }
      }
    };

    networkManager = new NetworkManager(mockNode, {
      maxPeers: 10,
      announceInterval: 1000,
      cleanupInterval: 5000,
      peerTimeout: 10000
    });
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with correct properties', () => {
      expect(networkManager.node).to.equal(mockNode);
      expect(networkManager.maxPeers).to.equal(10);
      expect(networkManager.announceInterval).to.equal(1000);
      expect(networkManager.cleanupInterval).to.equal(5000);
      expect(networkManager.peerTimeout).to.equal(10000);
    });

    it('should set up listeners for peer announcements, peer list requests, and network status requests', () => {
      expect(mockNode.services.pubsub.subscribe.calledWith('peer-announce')).to.be.true;
      expect(mockNode.services.pubsub.subscribe.calledWith('peer-list-request')).to.be.true;
      expect(mockNode.services.pubsub.subscribe.calledWith('network-status-request')).to.be.true;
    });
  });

  describe('Peer Announcement', () => {
    it('should announce peer periodically', async () => {
      await clock.tickAsync(1000);
      expect(mockNode.services.pubsub.publish.calledOnce).to.be.true;
      expect(mockNode.services.pubsub.publish.firstCall.args[0]).to.equal('peer-announce');
      
      const announcement = JSON.parse(mockNode.services.pubsub.publish.firstCall.args[1]);
      expect(announcement.peerId).to.equal('mockNodeId');
      expect(announcement).to.have.property('timestamp');
      expect(announcement).to.have.property('status');
    });
  });

  describe('Peer List Request', () => {
    it('should handle peer list requests', async () => {
      const requestMessage = { data: Buffer.from('requestingPeerId') };
      await networkManager.handlePeerListRequest(requestMessage);
      
      expect(mockNode.services.pubsub.publish.calledOnce).to.be.true;
      expect(mockNode.services.pubsub.publish.firstCall.args[0]).to.equal('peer-list-response-requestingPeerId');
      
      const response = JSON.parse(mockNode.services.pubsub.publish.firstCall.args[1]);
      expect(response).to.be.an('array');
    });
  });

  describe('Network Status Request', () => {
    it('should handle network status requests', async () => {
      const requestMessage = { data: Buffer.from('requestingPeerId') };
      await networkManager.handleNetworkStatusRequest(requestMessage);
      
      expect(mockNode.services.pubsub.publish.calledOnce).to.be.true;
      expect(mockNode.services.pubsub.publish.firstCall.args[0]).to.equal('network-status-response-requestingPeerId');
      
      const response = JSON.parse(mockNode.services.pubsub.publish.firstCall.args[1]);
      expect(response).to.have.property('totalPeers');
      expect(response).to.have.property('averageBlockHeight');
      expect(response).to.have.property('networkVersion');
    });
  });

  describe('Peer Management', () => {
    it('should update peer information', () => {
      const peerData = { peerId: 'peer1', status: { blockHeight: 100 } };
      networkManager.updatePeer('peer1', peerData);
      
      const storedPeer = networkManager.peers.get('peer1');
      expect(storedPeer).to.exist;
      expect(storedPeer.status.blockHeight).to.equal(100);
      expect(storedPeer.lastSeen).to.be.a('number');
    });

    it('should clean up inactive peers', () => {
      // Add two peers
      networkManager.updatePeer('peer1', { status: { blockHeight: 100 } });
      networkManager.updatePeer('peer2', { status: { blockHeight: 200 } });
      
      // Advance time by 5 seconds
      clock.tick(5000);
      
      // Update peer2 to simulate activity
      networkManager.updatePeer('peer2', { status: { blockHeight: 201 } });
      
      // Advance time by another 6 seconds (total 11 seconds)
      clock.tick(6000);
      
      // Clean up peers
      networkManager.cleanupPeers();
      
      // peer1 should be removed (inactive for 11 seconds)
      // peer2 should remain (only inactive for 6 seconds)
      expect(networkManager.peers.has('peer1')).to.be.false;
      expect(networkManager.peers.has('peer2')).to.be.true;
    });
  });

  describe('Network Status Calculation', () => {
    it('should calculate average block height correctly', () => {
      networkManager.updatePeer('peer1', { status: { blockHeight: 100 } });
      networkManager.updatePeer('peer2', { status: { blockHeight: 200 } });
      networkManager.updatePeer('peer3', { status: { blockHeight: 300 } });
      
      expect(networkManager.calculateAverageBlockHeight()).to.equal(200);
    });

    it('should get network version correctly', () => {
      networkManager.updatePeer('peer1', { status: { version: '1.0.0' } });
      networkManager.updatePeer('peer2', { status: { version: '1.0.1' } });
      networkManager.updatePeer('peer3', { status: { version: '1.0.0' } });
      
      expect(networkManager.getNetworkVersion()).to.equal('1.0.0, 1.0.1');
    });
  });

  describe('Peer List and Network Status Requests', () => {
    it('should request peer list and handle response', async () => {
      const mockPeerList = [{ peerId: 'peer1', status: {} }, { peerId: 'peer2', status: {} }];
      
      mockNode.services.pubsub.publish.resolves();
      mockNode.services.pubsub.subscribe.callsFake((topic, callback) => {
        if (topic.startsWith('peer-list-response')) {
          callback({ data: Buffer.from(JSON.stringify(mockPeerList)) });
        }
      });

      const peerList = await networkManager.requestPeerList();
      
      expect(peerList).to.deep.equal(mockPeerList);
      expect(mockNode.services.pubsub.publish.calledWith('peer-list-request', 'mockNodeId')).to.be.true;
      expect(mockNode.services.pubsub.unsubscribe.calledOnce).to.be.true;
    });

    it('should request network status and handle response', async () => {
      const mockNetworkStatus = { totalPeers: 5, averageBlockHeight: 1000, networkVersion: '1.0.0' };
      
      mockNode.services.pubsub.publish.resolves();
      mockNode.services.pubsub.subscribe.callsFake((topic, callback) => {
        if (topic.startsWith('network-status-response')) {
          callback({ data: Buffer.from(JSON.stringify(mockNetworkStatus)) });
        }
      });

      const networkStatus = await networkManager.requestNetworkStatus();
      
      expect(networkStatus).to.deep.equal(mockNetworkStatus);
      expect(mockNode.services.pubsub.publish.calledWith('network-status-request', 'mockNodeId')).to.be.true;
      expect(mockNode.services.pubsub.unsubscribe.calledOnce).to.be.true;
    });
  });
});