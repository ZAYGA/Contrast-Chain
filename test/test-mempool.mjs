import { expect } from 'chai';
import sinon from 'sinon';
import Mempool from '../src/mempool.mjs';

describe('Mempool', () => {
  let mempool;

  beforeEach(() => {
    mempool = new Mempool({ maxSize: 100, cleanupInterval: 1000, expirationTime: 3600000 });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Constructor', () => {
    it('should create a mempool with default options', () => {
      const defaultMempool = new Mempool();
      expect(defaultMempool.maxSize).to.equal(5000);
      expect(defaultMempool.cleanupInterval).to.equal(3600000);
      expect(defaultMempool.expirationTime).to.equal(24 * 60 * 60 * 1000);
    });

    it('should create a mempool with custom options', () => {
      const customMempool = new Mempool({ maxSize: 200, cleanupInterval: 2000, expirationTime: 7200000 });
      expect(customMempool.maxSize).to.equal(200);
      expect(customMempool.cleanupInterval).to.equal(2000);
      expect(customMempool.expirationTime).to.equal(7200000);
    });
  });

  describe('addTransaction', () => {
    it('should add a valid transaction to the mempool', () => {
      const tx = createTransaction('tx1', 10, 9.9);
      const result = mempool.addTransaction(tx);
      expect(result).to.be.true;
      expect(mempool.getTransaction('tx1')).to.deep.equal(tx);
    });

    it('should not add an invalid transaction', () => {
      const invalidTx = { id: 'invalid' };
      const result = mempool.addTransaction(invalidTx);
      expect(result).to.be.false;
      expect(mempool.getTransaction('invalid')).to.be.undefined;
    });

    it('should not add a duplicate transaction', () => {
      const tx = createTransaction('tx1', 10, 9.9);
      mempool.addTransaction(tx);
      const result = mempool.addTransaction(tx);
      expect(result).to.be.false;
    });

    it('should remove lowest fee transaction when mempool is full', () => {
      const smallMempool = new Mempool({ maxSize: 3 });
      const lowFeeTx = createTransaction('lowFee', 10, 9.99);
      const highFeeTx1 = createTransaction('highFee1', 10, 9.9);
      const highFeeTx2 = createTransaction('highFee2', 10, 9.9);
      const highFeeTx3 = createTransaction('highFee3', 10, 9.9);

      smallMempool.addTransaction(lowFeeTx);
      smallMempool.addTransaction(highFeeTx1);
      smallMempool.addTransaction(highFeeTx2);
      smallMempool.addTransaction(highFeeTx3);

      expect(smallMempool.getTransaction('lowFee')).to.be.undefined;
      expect(smallMempool.getTransaction('highFee3')).to.not.be.undefined;
    });
  });

  describe('removeTransaction', () => {
    it('should remove a transaction from the mempool', () => {
      const tx = createTransaction('tx1', 10, 9.9);
      mempool.addTransaction(tx);
      const result = mempool.removeTransaction('tx1');
      expect(result).to.be.true;
      expect(mempool.getTransaction('tx1')).to.be.undefined;
    });

    it('should return false when removing a non-existent transaction', () => {
      const result = mempool.removeTransaction('nonexistent');
      expect(result).to.be.false;
    });
  });

  describe('getTransactionsByAddress', () => {
    it('should return transactions associated with an address', () => {
      const tx1 = createTransaction('tx1', 10, 9.9, 'addr1', 'addr2');
      const tx2 = createTransaction('tx2', 10, 9.9, 'addr2', 'addr1');
      mempool.addTransaction(tx1);
      mempool.addTransaction(tx2);

      const addr1Txs = mempool.getTransactionsByAddress('addr1');
      expect(addr1Txs).to.have.lengthOf(2);
      expect(addr1Txs).to.include('tx1');
      expect(addr1Txs).to.include('tx2');

      const addr2Txs = mempool.getTransactionsByAddress('addr2');
      expect(addr2Txs).to.have.lengthOf(2);
      expect(addr2Txs).to.include('tx1');
      expect(addr2Txs).to.include('tx2');
    });

    it('should return an empty array for an address with no transactions', () => {
      const txs = mempool.getTransactionsByAddress('unused');
      expect(txs).to.be.an('array').that.is.empty;
    });
  });

  describe('selectTransactionsForBlock', () => {
    it('should select transactions based on fees and block constraints', () => {
      const tx1 = createTransaction('tx1', 10, 9.9);
      const tx2 = createTransaction('tx2', 10, 9.8);
      const tx3 = createTransaction('tx3', 10, 9.95);

      mempool.addTransaction(tx1);
      mempool.addTransaction(tx2);
      mempool.addTransaction(tx3);

      const selectedTxs = mempool.selectTransactionsForBlock(1000, 2);
      expect(selectedTxs).to.have.lengthOf(2);
      expect(selectedTxs[0].id).to.equal('tx2');
      expect(selectedTxs[1].id).to.equal('tx1');
    });

    it('should respect maxBlockSize constraint', () => {
      for (let i = 0; i < 10; i++) {
        mempool.addTransaction(createTransaction(`tx${i}`, 10, 9.9));
      }

      const selectedTxs = mempool.selectTransactionsForBlock(500, 100);
      expect(selectedTxs.length).to.be.lessThan(10);
    });

    it('should respect maxTxCount constraint', () => {
      for (let i = 0; i < 10; i++) {
        mempool.addTransaction(createTransaction(`tx${i}`, 10, 9.9));
      }

      const selectedTxs = mempool.selectTransactionsForBlock(10000, 5);
      expect(selectedTxs).to.have.lengthOf(5);
    });
  });

  describe('cleanup', () => {
    it('should remove expired transactions', () => {
      const clock = sinon.useFakeTimers(Date.now());

      const tx1 = createTransaction('tx1', 10, 9.9);
      mempool.addTransaction(tx1);

      clock.tick(4 * 60 * 60 * 1000); // Advance time by 4 hours

      const tx2 = createTransaction('tx2', 10, 9.9);
      mempool.addTransaction(tx2);

      mempool.cleanup();

      expect(mempool.getTransaction('tx1')).to.be.undefined;
      expect(mempool.getTransaction('tx2')).to.deep.equal(tx2);

      clock.restore();
    });
  });

  describe('getStats', () => {
    it('should return correct mempool statistics', () => {
      const tx1 = createTransaction('tx1', 10, 9.9, 'addr1', 'addr2');
      const tx2 = createTransaction('tx2', 10, 9.9, 'addr2', 'addr3');

      mempool.addTransaction(tx1);
      mempool.addTransaction(tx2);

      const stats = mempool.getStats();
      expect(stats.totalTransactions).to.equal(2);
      expect(stats.totalAddresses).to.equal(3);
      expect(stats.averageFeePerByte).to.be.a('number');
      expect(stats.mempoolSize).to.be.a('number');
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully when adding invalid transactions', () => {
      const invalidTx = { id: 'invalid', from: 'addr1' }; // Missing required fields
      expect(() => mempool.addTransaction(invalidTx)).to.not.throw();
      expect(mempool.getTransaction('invalid')).to.be.undefined;
    });

    it('should handle errors when calculating fee for invalid transaction', () => {
      const invalidTx = { id: 'invalid' };
      const fee = mempool.calculateFeePerByte(invalidTx);
      expect(fee).to.equal(0);
    });
  });

  describe('Performance', () => {
    it('should handle a large number of transactions efficiently', function() {
      this.timeout(5000); // Increase timeout for this test

      const startTime = process.hrtime();

      for (let i = 0; i < 10000; i++) {
        mempool.addTransaction(createTransaction(`tx${i}`, 10, 9.9));
      }

      const endTime = process.hrtime(startTime);
      const duration = endTime[0] * 1000 + endTime[1] / 1e6; // Convert to milliseconds

      console.log(`Time taken to add 10000 transactions: ${duration.toFixed(2)}ms`);
      expect(duration).to.be.below(1000); // Expect it to take less than 1 second
    });
  });
});

function createTransaction(id, inputAmount, outputAmount, fromAddress = 'addr1', toAddress = 'addr2') {
  return {
    id,
    inputs: [{ address: fromAddress, amount: inputAmount }],
    outputs: [{ address: toAddress, amount: outputAmount }]
  };
}