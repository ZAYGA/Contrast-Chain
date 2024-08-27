import { Level } from 'level';
import MerkleTree from './merkle-tree.mjs';

/**
 * Manages Unspent Transaction Outputs (UTXOs) with optimized operations and Merkle tree integration.
 */
class UTXOManager {
  /**
   * Creates an instance of UTXOManager.
   * @param {string} dbPath - The file path for the LevelDB database.
   */
  constructor(dbPath) {
    /** @type {Level} */
    this.db = new Level(dbPath, { valueEncoding: 'json' });
    
    /** @type {MerkleTree} */
    this.merkleTree = new MerkleTree();
    
    /** @type {Map<string, Object>} */
    this.utxoCache = new Map(); // In-memory cache for frequently accessed UTXOs
    
    /** @type {Array<Object>} */
    this.batchOperations = []; // For batching database operations
    
    /** @type {number} */
    this.batchSize = 1; // Number of operations before committing a batch
  }

  /**
   * Initializes the UTXOManager by opening the database and rebuilding the Merkle tree.
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.db.open();
    await this.rebuildMerkleTree();
  }

  /**
   * Rebuilds the Merkle tree from the existing database entries.
   * @returns {Promise<void>}
   */
  async rebuildMerkleTree() {
    for await (const [key, value] of this.db.iterator()) {
      this.merkleTree.insert(key);
    }
  }

  /**
   * Adds a new UTXO to the set and the Merkle tree.
   * @param {string} txid - Transaction ID.
   * @param {number} index - Index of the UTXO.
   * @param {Object} utxo - The UTXO data.
   * @returns {Promise<void>}
   */
  async addUTXO(txid, index, utxo) {
    const utxoKey = `${txid}:${index}`;
    this.utxoCache.set(utxoKey, utxo);
    this.batchOperations.push({ type: 'put', key: utxoKey, value: utxo });
    this.merkleTree.insert(utxoKey);
    console.log('addUTXO', utxoKey, utxo);
    if (this.batchOperations.length >= this.batchSize) {
      await this.commitBatch();
    }
  }

  /**
   * Removes a UTXO from the set and the Merkle tree.
   * @param {string} txid - Transaction ID.
   * @param {number} index - Index of the UTXO.
   * @returns {Promise<void>}
   */
  async removeUTXO(txid, index) {
    const utxoKey = `${txid}:${index}`;
    this.utxoCache.delete(utxoKey);
    this.batchOperations.push({ type: 'del', key: utxoKey });
    this.merkleTree.remove(utxoKey);

    if (this.batchOperations.length >= this.batchSize) {
      await this.commitBatch();
    }
  }

  /**
   * Retrieves a UTXO by its transaction ID and index.
   * @param {string} txid - Transaction ID.
   * @param {number} index - Index of the UTXO.
   * @returns {Promise<Object|null>} The UTXO data or null if not found.
   */
  async getUTXO(txid, index) {
    const utxoKey = `${txid}:${index}`;
    if (this.utxoCache.has(utxoKey)) {
      return this.utxoCache.get(utxoKey);
    }

    try {
      const utxo = await this.db.get(utxoKey);
      this.utxoCache.set(utxoKey, utxo); // Cache the result
      return utxo;
    } catch (err) {
      if (err.notFound) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Commits the batch operations to the database.
   * @returns {Promise<void>}
   */
  async commitBatch() {
    if (this.batchOperations.length > 0) {
      await this.db.batch(this.batchOperations);
      this.batchOperations = [];
    }
  }

  /**
   * Generates an inclusion proof for a UTXO.
   * @param {string} txid - Transaction ID.
   * @param {number} index - Index of the UTXO.
   * @returns {Object|null} The inclusion proof or null if not found.
   */
  generateInclusionProof(txid, index) {
    const utxoKey = `${txid}:${index}`;
    return this.merkleTree.generateInclusionProof(utxoKey);
  }

  /**
   * Verifies an inclusion proof for a UTXO.
   * @param {string} txid - Transaction ID.
   * @param {number} index - Index of the UTXO.
   * @param {Object} proof - The inclusion proof.
   * @returns {Promise<boolean>} True if the proof is valid, false otherwise.
   */
  async verifyInclusionProof(txid, index, proof) {
    const utxoKey = `${txid}:${index}`;
    const utxo = await this.getUTXO(txid, index);
    if (!utxo) {
      return false;
    }
    const root = this.merkleTree.getRoot();
    return this.merkleTree.verifyInclusionProof(utxoKey, proof, root);
  }
  /**
   * Retrieves all UTXOs for a given address.
   * @param {string} address - The address to retrieve UTXOs for.
   * @returns {Promise<Array<Object>>} An array of UTXO objects for the given address.
   */
  async getUTXOs(address) {
    const utxos = [];
    for await (const [key, utxo] of this.db.iterator()) {
      if (utxo.scriptPubKey === address) {
        const [txid, index] = key.split(':');
        utxos.push({
          txid,
          index: parseInt(index),
          ...utxo
        });
      }
    }
    return utxos;
  }

  async getBalance(address) {
    console.log('getBalance', address);
    let balance = 0;
    const utxos = await this.getUTXOs(address);
    for (const utxo of utxos) {
      console.log('utxo', utxo);
      balance += utxo.amount;
    }
    console.log('balance', balance);
    return balance;
  }
  /**
   * Closes the database and commits any remaining batch operations.
   * @returns {Promise<void>}
   */
  async close() {
    await this.commitBatch(); // Commit any remaining batch operations
    await this.db.close();
  }
}

export default UTXOManager;
export { UTXOManager };