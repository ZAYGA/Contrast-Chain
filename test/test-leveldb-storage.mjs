import { expect } from 'chai';
import LevelDBStorage from '../src/leveldb-storage.mjs';
import FlexibleSerializer from '../src/flexible-serializer.mjs';
import os from 'os';
import path from 'path';

describe('LevelDBStorage', () => {
  let storage;
  let tempDbPath;
  let serializer;

  beforeEach(async () => {
    tempDbPath = path.join(os.tmpdir(), 'test-leveldb-' + Date.now());
    storage = new LevelDBStorage(tempDbPath);
    await storage.open();
    
    // Create a FlexibleSerializer instance for testing
    serializer = new FlexibleSerializer('../protos/block.proto');
    serializer.registerType('Block', 'contrast.Block');
    serializer.registerType('Transaction', 'contrast.Transaction');
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('Basic operations', () => {
    it('should put and get a string value', async () => {
      await storage.put('key1', 'value1', 'string');
      const value = await storage.get('key1', 'string');
      expect(value).to.equal('value1');
    });

    it('should put and get a number value', async () => {
      await storage.put('key2', 42, 'number');
      const value = await storage.get('key2', 'number');
      expect(value).to.equal(42);
    });

    it('should delete a value', async () => {
      await storage.put('key3', 'value3', 'string');
      await storage.del('key3');
      try {
        await storage.get('key3', 'string');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.notFound).to.be.true;
      }
    });

    it('should handle batch operations', async () => {
      const batch = [
        { type: 'put', key: 'batch1', value: 'batchvalue1', dataType: 'string' },
        { type: 'put', key: 'batch2', value: 'batchvalue2', dataType: 'string' },
        { type: 'del', key: 'batch1' }
      ];
      await storage.batch(batch);

      const value2 = await storage.get('batch2', 'string');
      expect(value2).to.equal('batchvalue2');

      try {
        await storage.get('batch1', 'string');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.notFound).to.be.true;
      }
    });
  });

  describe('Block operations', () => {
    const testBlock = {
      index: 1,
      hash: 'abc123',
      previousHash: '000000000000000000000000000000000000000000000000000000000000',
      timestamp: 1625097600000,
      data: 'Test Block Data',
      nonce: 12345
    };

    it('should set and get the latest block', async () => {
      await storage.setLatestBlock(testBlock);
      const latestBlock = await storage.getLatestBlock();
      expect(latestBlock).to.deep.equal(testBlock);
    });

    it('should save and retrieve a block by hash', async () => {
      await storage.saveBlock(testBlock);
      const retrievedBlock = await storage.getBlockByHash('abc123');
      expect(retrievedBlock).to.deep.equal(testBlock);
    });

    it('should save and retrieve a block by height', async () => {
        await storage.saveBlock(testBlock);
        const retrievedBlock = await storage.getBlockByHeight(1);
        expect(retrievedBlock).to.deep.equal(testBlock);
      });

    it('should return null for non-existent block height', async () => {
      const nonExistentBlock = await storage.getBlockByHeight(999);
      expect(nonExistentBlock).to.be.null;
    });
  });

  describe('Transaction operations', () => {
    const testTransaction = {
      id: 'tx123',
      from: 'sender123',
      to: 'recipient456',
      amount: 100,
      timestamp: 1625097600000
    };

    it('should save and retrieve a transaction', async () => {
      await storage.saveTransaction(testTransaction);
      const retrievedTx = await storage.getTransaction('tx123');
      expect(retrievedTx).to.deep.equal(testTransaction);
    });
  });

  describe('Account state operations', () => {
    const testAccountState = {
      balance: 1000,
      nonce: 5
    };

    it('should update and retrieve account state', async () => {
      const address = 'addr123';
      await storage.updateAccountState(address, testAccountState);
      const retrievedState = await storage.getAccountState(address);
      expect(retrievedState).to.deep.equal(testAccountState);
    });
  });

  describe('Error handling', () => {
    it('should throw an error when getting a non-existent key', async () => {
      try {
        await storage.get('nonexistent', 'string');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.notFound).to.be.true;
      }
    });

    it('should handle errors in batch operations', async () => {
      const batch = [
        { type: 'put', key: 'error1', value: 'errorvalue1', dataType: 'string' },
        { type: 'invalid', key: 'error2', value: 'errorvalue2', dataType: 'string' }
      ];
      try {
        await storage.batch(batch);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid operation: batch operation must have a type property of either "put" or "del"');
      }
    });
  });
  describe('Read stream', () => {
    it('should create a read stream', async () => {
      await storage.put('stream1', 'value1', 'string');
      await storage.put('stream2', 'value2', 'string');
      await storage.put('stream3', 'value3', 'string');

      const items = [];
      const iterator = storage.createReadStream();
      for await (const [key, value] of iterator) {
        const { type, value: parsedValue } = JSON.parse(value.toString());
        items.push({ key, value: parsedValue });
      }

      expect(items).to.have.lengthOf(3);
      expect(items[0].key).to.equal('stream1');
      expect(items[0].value).to.equal('value1');
    });
  });

  describe('Account state operations', () => {
    const testAccountState = {
      balance: 1000,
      nonce: 5
    };

    it('should update and retrieve account state', async () => {
      const address = 'addr123';
      await storage.updateAccountState(address, testAccountState);
      const retrievedState = await storage.getAccountState(address);
      expect(retrievedState).to.deep.equal(testAccountState);
    });
  });
});