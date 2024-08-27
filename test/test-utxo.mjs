import { expect } from 'chai';
import fs from 'fs';
import UTXOManager from '../src/utxo-manager.mjs';

/**
 * Utility function to clear the test database
 * @param {string} path - The path to the database
 */
function clearTestDB(path) {
  if (fs.existsSync(path)) {
    fs.rmSync(path, { recursive: true, force: true });
  }
}

describe('UTXOManager', function () {
  const dbPath = './test-db';
  let utxoManager;

  beforeEach(async function () {
    clearTestDB(dbPath);
    utxoManager = new UTXOManager(dbPath);
    await utxoManager.initialize();
  });

  afterEach(async function () {
    await utxoManager.close();
    clearTestDB(dbPath);
  });

  /**
   * Test adding and retrieving a UTXO
   */
  it('should add a UTXO and retrieve it from the database', async function () {
    const txid = 'tx123';
    const index = 0;
    const utxo = { amount: 100, address: 'addr1' };

    await utxoManager.addUTXO(txid, index, utxo);

    const retrievedUTXO = await utxoManager.getUTXO(txid, index);
    expect(retrievedUTXO).to.deep.equal(utxo);
  });

  /**
   * Test removing a UTXO
   */
  it('should remove a UTXO from the database', async function () {
    const txid = 'tx123';
    const index = 0;
    const utxo = { amount: 100, address: 'addr1' };

    await utxoManager.addUTXO(txid, index, utxo);
    await utxoManager.removeUTXO(txid, index);

    const retrievedUTXO = await utxoManager.getUTXO(txid, index);
    expect(retrievedUTXO).to.be.null;
  });

  /**
   * Test generating and verifying an inclusion proof for an existing UTXO
   */
  it('should generate and verify an inclusion proof for an existing UTXO', async function () {
    const txid = 'tx4';
    const index = 0;
    const utxo = { amount: 100, address: 'addr1' };

    await utxoManager.addUTXO(txid, index, utxo);

    // Add some additional UTXOs to make the Merkle tree more interesting
    for (let i = 0; i < 10; i++) {
      await utxoManager.addUTXO(`tx${i}`, 0, { amount: 50, address: `addr${i}` });
    }

    const inclusionProof = utxoManager.generateInclusionProof(txid, index);
    const isValid = await utxoManager.verifyInclusionProof(txid, index, inclusionProof);

    expect(isValid).to.be.true;
  });

  /**
   * Test verifying an inclusion proof for a non-existent UTXO
   */
  it('should return false when verifying an inclusion proof for a non-existent UTXO', async function () {
    const txid = 'tx123';
    const index = 1; // Non-existent UTXO
    const utxo = { amount: 100, address: 'addr1' };

    await utxoManager.addUTXO(txid, 0, utxo); // Add a different UTXO

    const inclusionProof = utxoManager.generateInclusionProof(txid, index);
    const isValid = await utxoManager.verifyInclusionProof(txid, index, inclusionProof);

    expect(isValid).to.be.false;
  });

  /**
   * Test batch operations
   */
  it('should handle batch operations correctly', async function () {
    const utxos = [];
    for (let i = 0; i < 150; i++) {
      utxos.push({ txid: `tx${i}`, index: 0, utxo: { amount: i, address: `addr${i}` } });
    }

    // Add UTXOs
    for (const { txid, index, utxo } of utxos) {
      await utxoManager.addUTXO(txid, index, utxo);
    }

    // Verify all UTXOs are added
    for (const { txid, index, utxo } of utxos) {
      const retrievedUTXO = await utxoManager.getUTXO(txid, index);
      expect(retrievedUTXO).to.deep.equal(utxo);
    }

    // Remove some UTXOs
    for (let i = 0; i < 50; i++) {
      await utxoManager.removeUTXO(`tx${i}`, 0);
    }

    // Verify removed UTXOs are gone and others still exist
    for (let i = 0; i < 150; i++) {
      const retrievedUTXO = await utxoManager.getUTXO(`tx${i}`, 0);
      if (i < 50) {
        expect(retrievedUTXO).to.be.null;
      } else {
        expect(retrievedUTXO).to.deep.equal({ amount: i, address: `addr${i}` });
      }
    }
  });

  /**
   * Test cache functionality
   */
  it('should use cache for repeated UTXO retrievals', async function () {
    const txid = 'tx123';
    const index = 0;
    const utxo = { amount: 100, address: 'addr1' };

    await utxoManager.addUTXO(txid, index, utxo);

    // First retrieval should cache the UTXO
    const firstRetrievalStart = process.hrtime();
    await utxoManager.getUTXO(txid, index);
    const firstRetrievalEnd = process.hrtime(firstRetrievalStart);

    // Second retrieval should use the cache
    const secondRetrievalStart = process.hrtime();
    await utxoManager.getUTXO(txid, index);
    const secondRetrievalEnd = process.hrtime(secondRetrievalStart);

    // Convert to nanoseconds for more precise comparison
    const firstRetrievalTime = firstRetrievalEnd[0] * 1e9 + firstRetrievalEnd[1];
    const secondRetrievalTime = secondRetrievalEnd[0] * 1e9 + secondRetrievalEnd[1];

    // The second retrieval should be significantly faster due to caching
    expect(secondRetrievalTime).to.be.below(firstRetrievalTime);
  });
});