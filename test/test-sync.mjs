import { expect } from 'chai';
import sinon from 'sinon';
import { SyncManager } from '../src/sync-manager.mjs';

describe('SyncManager', () => {
  let syncManager;
  let mockBlockchainNode;
  let mockNetworkManager;
  let mockBlockManager;

  beforeEach(() => {
    console.log('Setting up test environment...');
    mockBlockchainNode = {
      handle: sinon.stub(),
      dialProtocol: sinon.stub()
    };
    mockNetworkManager = {
      getPeers: sinon.stub().resolves(['peer1', 'peer2', 'peer3'])
    };
    mockBlockManager = {
      getLatestBlockNumber: sinon.stub().returns(100),
      getLatestBlockHash: sinon.stub().returns('latestHash'),
      isValidBlock: sinon.stub().returns(true),
      addBlock: sinon.stub().resolves(),
      getBlockByHeight: sinon.stub().callsFake((height) => ({ height, hash: `hash${height}` }))
    };

    syncManager = new SyncManager(mockBlockchainNode, mockNetworkManager, mockBlockManager);
    console.log('SyncManager instance created');
  });

  afterEach(() => {
    console.log('Cleaning up test environment...');
    sinon.restore();
  });

  describe('syncBlockchain', () => {
    it('should sync blockchain when behind', async () => {
      console.log('Starting test: syncBlockchain when behind');

      // Mock isNodeBehind to return true
      sinon.stub(syncManager, 'isNodeBehind').resolves(true);
      console.log('Mocked isNodeBehind to return true');

      // Mock performSync
      sinon.stub(syncManager, 'performSync').resolves();
      console.log('Mocked performSync');

      // Set up event listeners
      const syncStartedSpy = sinon.spy();
      const syncFinishedSpy = sinon.spy();
      syncManager.on('syncStarted', syncStartedSpy);
      syncManager.on('syncFinished', syncFinishedSpy);
      console.log('Set up event listeners');

      await syncManager.syncBlockchain();
      console.log('syncBlockchain method called');

      expect(syncManager.isNodeBehind.calledOnce).to.be.true;
      console.log('isNodeBehind was called once');

      expect(syncManager.performSync.calledOnce).to.be.true;
      console.log('performSync was called once');

      expect(syncStartedSpy.calledOnce).to.be.true;
      console.log('syncStarted event was emitted');

      expect(syncFinishedSpy.calledOnce).to.be.true;
      console.log('syncFinished event was emitted');

      expect(syncManager.isSyncing).to.be.false;
      console.log('isSyncing flag is false after sync');
    });

    it('should not sync blockchain when not behind', async () => {
      console.log('Starting test: syncBlockchain when not behind');

      // Mock isNodeBehind to return false
      sinon.stub(syncManager, 'isNodeBehind').resolves(false);
      console.log('Mocked isNodeBehind to return false');

      // Mock performSync
      sinon.stub(syncManager, 'performSync').resolves();
      console.log('Mocked performSync');

      await syncManager.syncBlockchain();
      console.log('syncBlockchain method called');

      expect(syncManager.isNodeBehind.calledOnce).to.be.true;
      console.log('isNodeBehind was called once');

      expect(syncManager.performSync.called).to.be.false;
      console.log('performSync was not called');

      expect(syncManager.isSyncing).to.be.false;
      console.log('isSyncing flag is false after sync check');
    });
  });

  describe('isNodeBehind', () => {
    it('should return true when node is behind in height', async () => {
      console.log('Starting test: isNodeBehind when behind in height');

      mockBlockManager.getLatestBlockNumber.returns(100);
      console.log('Mocked local block height: 100');

      sinon.stub(syncManager, 'getPeerStatuses').resolves([
        { height: 110, hash: 'hash1' },
        { height: 115, hash: 'hash2' }
      ]);
      console.log('Mocked peer statuses with higher heights');

      const result = await syncManager.isNodeBehind();
      console.log(`isNodeBehind result: ${result}`);

      expect(result).to.be.true;
    });

    it('should return true when node has different hash at same height', async () => {
      console.log('Starting test: isNodeBehind when hash differs');

      mockBlockManager.getLatestBlockNumber.returns(100);
      mockBlockManager.getLatestBlockHash.returns('localHash');
      console.log('Mocked local block height: 100, hash: localHash');

      sinon.stub(syncManager, 'getPeerStatuses').resolves([
        { height: 100, hash: 'peerHash1' },
        { height: 100, hash: 'peerHash1' },
        { height: 100, hash: 'peerHash2' }
      ]);
      console.log('Mocked peer statuses with same height but different hash');

      const result = await syncManager.isNodeBehind();
      console.log(`isNodeBehind result: ${result}`);

      expect(result).to.be.true;
    });
  });

  describe('performSync', () => {
    it('should sync blocks from current height to max peer height', async () => {
      console.log('Starting test: performSync');

      mockBlockManager.getLatestBlockNumber.returns(100);
      console.log('Mocked local block height: 100');

      sinon.stub(syncManager, 'getPeerStatuses').resolves([
        { height: 110, hash: 'hash1' },
        { height: 115, hash: 'hash2' }
      ]);
      console.log('Mocked peer statuses with max height 115');

      sinon.stub(syncManager, 'syncBlocks').resolves();
      console.log('Mocked syncBlocks method');

      await syncManager.performSync();
      console.log('performSync method called');

      expect(syncManager.syncBlocks.calledWith(101, 115)).to.be.true;
      console.log('syncBlocks was called with correct range: 101 to 115');
    });
  });

  // Add more test cases for other methods as needed...

});