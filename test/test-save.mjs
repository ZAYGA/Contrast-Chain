import { expect } from 'chai';
import sinon from 'sinon';
import { Blockchain } from '../src/blockchain.mjs';
import { Block, BlockData } from '../src/block.mjs';
import { Transaction, TransactionIO } from '../src/transaction.mjs';
import utils from '../src/utils.mjs';
import LevelUp from 'levelup';
import MemDown from 'memdown';

describe('Blockchain Save and Load Tests', function () {
    let blockchain;
    let mockP2P;
    let dbPath;

    function generateRandomHex(length) {
        return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    }

    beforeEach(function () {
        dbPath = './test-db' + Math.random();
        mockP2P = {
            // Add any necessary mock methods
        };
    });

    afterEach(async function () {
        if (blockchain) {
            await blockchain.close();
        }
        sinon.restore();
    });

    function createValidBlock(index, prevHash, prevSupply) {
        const timestamp = Date.now();
        const coinbaseTxId = generateRandomHex(8);
        const coinbaseReward = utils.blockchainSettings.blockReward / Math.pow(2, Math.floor(index / utils.blockchainSettings.halvingInterval));
        const newSupply = prevSupply + coinbaseReward;
        const anchor = utils.anchor.fromReferences(index, coinbaseTxId, 0);
        const transactions = [
            {
                id: coinbaseTxId,
                inputs: [generateRandomHex(64)],
                outputs: [
                    {
                        amount: coinbaseReward,
                        address: "testAddress",
                        rule: "sig_v1",
                        version: 1,
                        anchor: anchor
                    }
                ],
                witnesses: []
            }
        ];

        return BlockData(index, prevSupply, coinbaseReward, 1, 0, prevHash, transactions, timestamp, timestamp, `block${index}Hash`, index.toString());
        // Should be ? :
        //return BlockData(index, newSupply, coinbaseReward, 1, 0, prevHash, transactions, timestamp, timestamp, `block${index}Hash`, index.toString());
    }

    describe('Initialization and Genesis Block', function () {
        it('should initialize with genesis block when not loading from disk', async function () {
            blockchain = new Blockchain(dbPath, mockP2P, { loadFromDisk: false });
            await blockchain.init();

            expect(blockchain.currentHeight).to.equal(0);
            expect(blockchain.lastBlock).to.not.be.null;
            expect(blockchain.lastBlock.index).to.equal(0);
        });
    });

    describe('Save and Load Functionality', function () {
        it('should save blocks to disk', async function () {
            blockchain = new Blockchain(dbPath, mockP2P, { loadFromDisk: false });
            await blockchain.init();

            const genesisSupply = blockchain.lastBlock.supply;
            const block1 = createValidBlock(1, blockchain.lastBlock.hash, genesisSupply);
            const block2 = createValidBlock(2, block1.hash, genesisSupply + block1.coinBase);

            await blockchain.addConfirmedBlock(block1);
            await blockchain.addConfirmedBlock(block2);

            // Use getBlock instead of getBlockFromDisk
            const savedBlock1 = await blockchain.getBlock(block1.hash);
            const savedBlock2 = await blockchain.getBlock(block2.hash);

            expect(savedBlock1.index).to.equal(block1.index);
            expect(savedBlock2.index).to.equal(block2.index);
        });



        it('should load blockchain from disk', async function () {
            // First, create and save some blocks
            blockchain = new Blockchain(dbPath, mockP2P, { loadFromDisk: false });
            await blockchain.init();

            const genesisSupply = blockchain.lastBlock.supply;
            const block1 = createValidBlock(1, blockchain.lastBlock.hash, genesisSupply);
            const block2 = createValidBlock(2, block1.hash, genesisSupply + block1.coinBase);

            await blockchain.addConfirmedBlock(block1);
            await blockchain.addConfirmedBlock(block2);

            // Close the first blockchain instance
            await blockchain.close();

            // Now, create a new blockchain instance and load from disk
            const loadedBlockchain = new Blockchain(dbPath, mockP2P, { loadFromDisk: true });
            await loadedBlockchain.init();

            await new Promise((resolve) => setTimeout(resolve, 6000));

            expect(loadedBlockchain.currentHeight).to.equal(2);
            expect(loadedBlockchain.lastBlock.index).to.equal(2);

            const loadedBlock1 = await loadedBlockchain.getBlock(block1.hash);
            expect(loadedBlock1.index).to.equal(block1.index);

            // Close the loaded blockchain instance
            await loadedBlockchain.close();
        });
    });

    return;

    describe('Error Handling', function () {
        it('should handle errors when loading from disk fails', async function () {
            const db = LevelUp(MemDown());
            sinon.stub(db, 'get').rejects(new Error('Database error'));
            sinon.stub(LevelUp, 'prototype').returns(db);

            blockchain = new Blockchain(dbPath, mockP2P, { loadFromDisk: true });

            await blockchain.init();

            expect(blockchain.currentHeight).to.equal(0);
            expect(blockchain.lastBlock).to.not.be.null;
            expect(blockchain.lastBlock.index).to.equal(0);

            // Close the blockchain instance
            await blockchain.close();
        });
    });
});