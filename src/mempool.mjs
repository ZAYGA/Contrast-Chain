import { PriorityQueue } from '@datastructures-js/priority-queue';
import pkg from 'bloom-filters';
const { BloomFilter } = pkg;

class Mempool {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 5000;
    this.cleanupInterval = options.cleanupInterval || 3600000;
    this.expirationTime = options.expirationTime || 24 * 60 * 60 * 1000; // 24 hours

    this.transactions = new Map();
    this.addressIndex = new Map();
    this.feeQueue = new PriorityQueue((a, b) => b.feePerByte - a.feePerByte); // Max heap
    this.timeQueue = new PriorityQueue((a, b) => a.timestamp - b.timestamp); // Min heap
    this.bloomFilter = new BloomFilter(this.maxSize * 10, 1); // 1% false positive rate
    this.lastCleanup = Date.now();

    // Periodic cleanup
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  addTransaction(transaction) {
    if (!this.isValidTransaction(transaction)) {
      return false;
    }

    const txId = transaction.id;

    if (this.bloomFilter.has(txId) || this.transactions.has(txId)) {
      return false; // Transaction likely already exists
    }

    if (this.transactions.size >= this.maxSize) {
      this.removeLowestFeeTx();
    }

    this.transactions.set(txId, transaction);
    this.bloomFilter.add(txId);

    const feePerByte = this.calculateFeePerByte(transaction);
    const timestamp = Date.now();

    this.feeQueue.enqueue({ id: txId, feePerByte });
    this.timeQueue.enqueue({ id: txId, timestamp });
    this.updateAddressIndex(transaction);

    return true;
  }

  removeTransaction(txId) {
    const tx = this.transactions.get(txId);
    if (!tx) return false;

    this.transactions.delete(txId);
    this.updateAddressIndex(tx, true);

    return true;
  }

  getTransaction(txId) {
    return this.transactions.get(txId);
  }

  selectTransactionsForBlock(maxBlockSize, maxTxCount) {
    const selectedTxs = [];
    let currentSize = 0;
    const tempFeeQueue = new PriorityQueue((a, b) => b.feePerByte - a.feePerByte);
    this.feeQueue.toArray().forEach(item => tempFeeQueue.enqueue(item));

    while (selectedTxs.length < maxTxCount && currentSize < maxBlockSize && !tempFeeQueue.isEmpty()) {
      const { id } = tempFeeQueue.dequeue();
      const tx = this.getTransaction(id);
      
      if (tx && currentSize + this.getTransactionSize(tx) <= maxBlockSize) {
        selectedTxs.push(tx);
        currentSize += this.getTransactionSize(tx);
        this.removeTransaction(id);
      }
    }

    return selectedTxs;
  }

  cleanup() {
    const now = Date.now();
    const expiredThreshold = now - this.expirationTime;

    while (!this.timeQueue.isEmpty() && this.timeQueue.front().timestamp < expiredThreshold) {
      const { id } = this.timeQueue.dequeue();
      this.removeTransaction(id);
    }

    this.rebuildQueues();
  }

  rebuildQueues() {
    this.feeQueue.clear();
    this.timeQueue.clear();

    for (const [id, tx] of this.transactions) {
      const feePerByte = this.calculateFeePerByte(tx);
      const timestamp = tx.timestamp || Date.now();
      this.feeQueue.enqueue({ id, feePerByte });
      this.timeQueue.enqueue({ id, timestamp });
    }
  }

  removeLowestFeeTx() {
    if (this.feeQueue.isEmpty()) return;
    const { id } = this.feeQueue.dequeue();
    this.removeTransaction(id);
  }

  updateAddressIndex(transaction, isRemoval = false) {
    const updateIndex = (address) => {
      if (!this.addressIndex.has(address)) {
        this.addressIndex.set(address, new Set());
      }
      const txSet = this.addressIndex.get(address);
      isRemoval ? txSet.delete(transaction.id) : txSet.add(transaction.id);
      if (txSet.size === 0) this.addressIndex.delete(address);
    };

    transaction.inputs.forEach(input => updateIndex(input.address));
    transaction.outputs.forEach(output => updateIndex(output.address));
  }

  getTransactionsByAddress(address) {
    return Array.from(this.addressIndex.get(address) || []);
  }

  isValidTransaction(transaction) {
    return transaction && transaction.id && transaction.inputs && transaction.outputs;
  }

  calculateFeePerByte(transaction) {
    const size = this.getTransactionSize(transaction);
    const inputAmount = transaction.inputs.reduce((sum, input) => sum + (input.amount || 0), 0);
    const outputAmount = transaction.outputs.reduce((sum, output) => sum + output.amount, 0);
    const fee = inputAmount - outputAmount;
    return fee / size;
  }

  getTransactionSize(transaction) {
    return JSON.stringify(transaction).length;
  }

  getStats() {
    return {
      totalTransactions: this.transactions.size,
      totalAddresses: this.addressIndex.size,
      averageFeePerByte: this.calculateAverageFeePerByte(),
      mempoolSize: this.getMempoolSize()
    };
  }

  calculateAverageFeePerByte() {
    if (this.transactions.size === 0) return 0;
    let totalFeePerByte = 0;
    for (const tx of this.transactions.values()) {
      totalFeePerByte += this.calculateFeePerByte(tx);
    }
    return totalFeePerByte / this.transactions.size;
  }

  getMempoolSize() {
    return Buffer.from(JSON.stringify(Array.from(this.transactions.values()))).length;
  }
}

export default Mempool;
export { Mempool };