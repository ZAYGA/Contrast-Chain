import { expect } from 'chai';
import sinon from 'sinon';
import { BlockchainStorage } from '../src/blockchain.mjs';


describe('BlockchainStorage', function () {
    let blockchainStorage;
    let mockBlockTree;
    let mockForkChoiceRule;
    let mockUtxoCache;

    beforeEach(function () {

        mockBlockTree = {
            addBlock: sinon.stub()
        };
        mockForkChoiceRule = {
            findBestBlock: sinon.stub().returns('newTipHash'),
            shouldReorg: sinon.stub().returns(false),
            getReorgPath: sinon.stub().returns(null)
        };
        mockUtxoCache = {
            digestFinalizedBlocks: sinon.stub().resolves()
        };

        blockchainStorage = new BlockchainStorage('./test-db' + Math.random());
        blockchainStorage.blockTree = mockBlockTree;
        blockchainStorage.forkChoiceRule = mockForkChoiceRule;
        blockchainStorage.utxoCache = mockUtxoCache;
    });

    describe('addBlock', function () {
        it('should add a block to in-memory storage', async function () {
            const mockBlock = { hash: 'mockHash', prevHash: 'mockPrevHash', index: 1 };
            await blockchainStorage.addBlock(mockBlock);
            expect(blockchainStorage.inMemoryBlocks.get('mockHash')).to.deep.equal(mockBlock);
        });

        it('should persist oldest block to disk when exceeding max in-memory blocks', async function () {
            blockchainStorage.maxInMemoryBlocks = 2;
            const mockBlock1 = { hash: 'hash1', prevHash: 'prevHash1', index: 1 };
            const mockBlock2 = { hash: 'hash2', prevHash: 'hash1', index: 2 };
            const mockBlock3 = { hash: 'hash3', prevHash: 'hash2', index: 3 };

            await blockchainStorage.addBlock(mockBlock1);
            await blockchainStorage.addBlock(mockBlock2);
            await blockchainStorage.addBlock(mockBlock3);

            expect(blockchainStorage.inMemoryBlocks.size).to.equal(2);
            expect(blockchainStorage.inMemoryBlocks.get('hash2')).to.deep.equal(mockBlock2);
            expect(blockchainStorage.inMemoryBlocks.get('hash3')).to.deep.equal(mockBlock3);

        });

        it('should update block tree', async function () {
            const mockBlock = { hash: 'mockHash', prevHash: 'mockPrevHash', index: 1 };
            await blockchainStorage.addBlock(mockBlock);
            expect(mockBlockTree.addBlock.calledOnce).to.be.true;
        });

        it('should update UTXO cache', async function () {
            const mockBlock = { hash: 'mockHash', prevHash: 'mockPrevHash', index: 1 };
            await blockchainStorage.addBlock(mockBlock);
            expect(mockUtxoCache.digestFinalizedBlocks.calledOnce).to.be.true;
        });
    });

    describe('getBlock', function () {
        it('should return block from in-memory storage if present', async function () {
            const mockBlock = { hash: 'mockHash', prevHash: 'mockPrevHash', index: 1 };
            blockchainStorage.inMemoryBlocks.set('mockHash', mockBlock);
            const result = await blockchainStorage.getBlock('mockHash');
            expect(result).to.deep.equal(mockBlock);
        });

        it('should fetch block from disk if not in memory', async function () {

            const mockBlock = {
                hash: 'mockHash', prevHash: 'mockPrevHash', index: 1,
                coinBase: 'mockCoinbase', timestamp: 1234567890, Txs: [], legitimacy: 'mockLegitimacy',
                nonce: 'mockNonce', posTimestamp: 1234567890, supply: 100, difficulty: 1
            };
            blockchainStorage.addBlock(mockBlock);
            blockchainStorage.persistBlockToDisk(mockBlock);
            blockchainStorage.inMemoryBlocks.delete('mockHash');
            const result = await blockchainStorage.getBlock('mockHash');
            expect(result).to.deep.equal(mockBlock);
        });
    });

    describe('checkAndHandleReorg', function () {
        it('should not perform reorg if not necessary', async function () {
            blockchainStorage.lastBlock = { hash: 'currentTipHash' };
            await blockchainStorage.checkAndHandleReorg();
            expect(mockForkChoiceRule.shouldReorg.calledOnce).to.be.true;
            expect(blockchainStorage.lastBlock.hash).to.equal('currentTipHash');
        });

        it('should perform reorg if necessary', async function () {
            blockchainStorage.lastBlock = { hash: 'currentTipHash' };
            mockForkChoiceRule.shouldReorg.returns(true);
            mockForkChoiceRule.getReorgPath.returns({
                revert: ['hash1'],
                apply: ['hash2', 'hash3']
            });
            blockchainStorage.revertBlock = sinon.stub().resolves();
            blockchainStorage.applyBlock = sinon.stub().resolves();
            blockchainStorage.getBlock = sinon.stub().resolves({ hash: 'hash3', index: 3 });

            await blockchainStorage.checkAndHandleReorg();

            expect(blockchainStorage.revertBlock.calledOnce).to.be.true;
            expect(blockchainStorage.applyBlock.calledTwice).to.be.true;
            expect(blockchainStorage.lastBlock.hash).to.equal('hash3');
            expect(blockchainStorage.currentHeight).to.equal(3);
        });
    });
});