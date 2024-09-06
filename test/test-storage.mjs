import { expect } from 'chai';
import sinon from 'sinon';
import { Blockchain } from '../src/blockchain.mjs';

describe('Blockchain', function () {
    let blockchain;
    let mockBlockTree;
    let mockForkChoiceRule;
    let mockUtxoCache;
    let mockSnapshotManager;
    let mockDb;
    let mockLogger;

    beforeEach(function () {
        // Set up mock objects for each test
        mockBlockTree = {
            addBlock: sinon.stub(),
            getBlockHeight: sinon.stub().returns(0)
        };
        mockForkChoiceRule = {
            findBestBlock: sinon.stub().returns('newTipHash'),
            shouldReorg: sinon.stub().returns(false),
            getReorgPath: sinon.stub().returns(null)
        };
        mockUtxoCache = {
            digestFinalizedBlocks: sinon.stub().resolves()
        };
        mockSnapshotManager = {
            takeSnapshot: sinon.stub(),
            restoreSnapshot: sinon.stub().resolves()
        };
        mockDb = {
            put: sinon.stub().resolves(),
            get: sinon.stub().resolves(),
            open: sinon.stub().resolves(),
            close: sinon.stub().resolves()
        };
        mockLogger = {
            info: sinon.stub(),
            debug: sinon.stub(),
            error: sinon.stub()
        };

        // Create a new Blockchain instance for each test
        blockchain = new Blockchain('./databases/test-db' + Math.random(), { logLevel: 'silent' });
        blockchain.blockTree = mockBlockTree;
        blockchain.forkChoiceRule = mockForkChoiceRule;
        blockchain.utxoCache = mockUtxoCache;
        blockchain.snapshotManager = mockSnapshotManager;
        blockchain.db = mockDb;
        blockchain.logger = mockLogger;
    });

    describe('Initialization', function () {
        it('should initialize the blockchain correctly', async function () {
            // Test the initialization process
            await blockchain.init();
            expect(mockDb.open.calledOnce).to.be.true;
            expect(mockLogger.info.calledWith('Blockchain initialized successfully')).to.be.true;
        });

        it('should handle initialization errors gracefully', async function () {
            // Test error handling during initialization
            mockDb.open.rejects(new Error('DB open error'));
            try {
                await blockchain.init();
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.equal('DB open error');
                expect(mockLogger.error.calledOnce).to.be.true;
            }
        });
    });

    describe('Block Addition', function () {
        it('should add a valid block to the blockchain', async function () {
            // Test adding a valid block
            const mockBlock = createMockBlock(1);
            await blockchain.addConfirmedBlock(mockBlock);
            expect(blockchain.inMemoryBlocks.get(mockBlock.hash)).to.deep.equal(mockBlock);
            expect(mockBlockTree.addBlock.calledOnce).to.be.true;
            expect(mockUtxoCache.digestFinalizedBlocks.calledOnce).to.be.true;
        });
        it('should handle adding blocks out of order', async function () {
            const block1 = createMockBlock(1);
            const block3 = createMockBlock(3);
            await blockchain.addConfirmedBlock(block1);

            // Mock the validateBlock method to throw the expected error
            blockchain.validateBlock = sinon.stub().throws(new Error('Invalid block height'));

            try {
                await blockchain.addConfirmedBlock(block3);
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.equal('Invalid block height');
            }
        });

        it('should take a snapshot at the specified interval', async function () {
            // Test snapshot creation at specified intervals
            blockchain.snapshotInterval = 2;
            const mockBlock = createMockBlock(3);
            await blockchain.addConfirmedBlock(mockBlock);
            expect(mockSnapshotManager.takeSnapshot.calledOnce).to.be.true;
        });

        it('should persist oldest block to disk when exceeding max in-memory blocks', async function () {
            // Test persisting blocks to disk when memory limit is reached
            blockchain.maxInMemoryBlocks = 2;
            await blockchain.addConfirmedBlock(createMockBlock(1));
            await blockchain.addConfirmedBlock(createMockBlock(2));
            await blockchain.addConfirmedBlock(createMockBlock(3));

            expect(blockchain.inMemoryBlocks.size).to.equal(2);
            expect(mockDb.put.calledOnce).to.be.true;
        });
    });

    describe('Block Retrieval', function () {
        it('should return block from in-memory storage if present', async function () {
            // Test retrieving a block from memory
            const mockBlock = createMockBlock(1);
            blockchain.inMemoryBlocks.set(mockBlock.hash, mockBlock);
            const result = await blockchain.getBlock(mockBlock.hash);
            expect(result).to.deep.equal(mockBlock);
        });

        it('should fetch block from disk if not in memory', async function () {
            // Test retrieving a block from disk
            const mockBlock = createMockBlock(1);
            mockDb.get.resolves(JSON.stringify(mockBlock));
            const result = await blockchain.getBlock(mockBlock.hash);
            expect(result).to.deep.equal(mockBlock);
        });

        it('should throw an error if block is not found', async function () {
            // Test error handling for non-existent blocks
            mockDb.get.rejects(new Error('Not found'));
            try {
                await blockchain.getBlock('nonexistentHash');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('Block not found');
            }
        });
    });

    describe('Chain Reorganization', function () {
        it('should not perform reorg if not necessary', async function () {
            // Test when reorganization is not needed
            blockchain.lastBlock = createMockBlock(1);
            await blockchain.checkAndHandleReorg();
            expect(mockForkChoiceRule.shouldReorg.calledOnce).to.be.true;
            expect(blockchain.lastBlock.hash).to.equal(blockchain.lastBlock.hash);
        });

        it('should perform reorg when necessary', async function () {
            // Setup initial state
            blockchain.lastBlock = createMockBlock(1);
            blockchain.currentHeight = 1;

            // Mock ForkChoiceRule
            mockForkChoiceRule.shouldReorg.returns(true);
            mockForkChoiceRule.getReorgPath.returns({
                revert: ['hash1'],
                apply: ['hash2', 'hash3']
            });

            // Mock BlockTree
            mockBlockTree.getBlockHeight.returns(0); // Assuming this is called for the common ancestor

            // Mock getBlock method
            blockchain.getBlock = sinon.stub();
            blockchain.getBlock.withArgs('hash2').resolves(createMockBlock(2));
            blockchain.getBlock.withArgs('hash3').resolves(createMockBlock(3));

            // Mock applyBlock method
            blockchain.applyBlock = sinon.stub().resolves();

            // Mock revertBlock method
            blockchain.revertBlock = sinon.stub().resolves();

            // Perform the reorg
            await blockchain.checkAndHandleReorg();

            // Assertions
            expect(mockForkChoiceRule.shouldReorg.calledOnce).to.be.true;
            expect(mockForkChoiceRule.getReorgPath.calledOnce).to.be.true;
            expect(mockSnapshotManager.restoreSnapshot.calledOnce).to.be.true;
            expect(mockSnapshotManager.restoreSnapshot.calledWith(0)).to.be.true;

            expect(blockchain.applyBlock.calledTwice).to.be.true;
            expect(blockchain.applyBlock.firstCall.calledWith(sinon.match({ hash: 'hash2' }))).to.be.true;
            expect(blockchain.applyBlock.secondCall.calledWith(sinon.match({ hash: 'hash3' }))).to.be.true;
        });
    });

    describe('Database Operations', function () {
        it('should close the database correctly', async function () {
            // Test database closing
            await blockchain.close();
            expect(mockDb.close.calledOnce).to.be.true;
        });

        it('should handle errors when closing the database', async function () {
            // Test error handling during database closure
            mockDb.close.rejects(new Error('Close error'));
            try {
                await blockchain.close();
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.equal('Close error');
            }
        });
    });

    // Helper function to create mock blocks
    function createMockBlock(index) {
        return {
            hash: `hash${index}`,
            prevHash: index === 1 ? 'genesisHash' : `hash${index - 1}`,
            index: index,
            supply: 1000 * index,
            coinBase: 50,
            difficulty: 1,
            legitimacy: 0,
            posTimestamp: Date.now() - 1000,
            timestamp: Date.now(),
            nonce: `nonce${index}`,
            Txs: []
        };
    }
});