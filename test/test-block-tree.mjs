import { expect } from 'chai';
import sinon from 'sinon';
import { BlockTree } from '../src/block-tree.mjs';

describe('BlockTree', function () {
    let blockTree;
    const genesisHash = '0000';

    beforeEach(function () {
        blockTree = new BlockTree(genesisHash, { maxBlocks: 5, logLevel: 'silent' });
    });

    afterEach(function () {
        sinon.restore();
    });

    describe('constructor', function () {
        it('should initialize with genesis block', function () {
            expect(blockTree.root).to.equal(genesisHash);
            expect(blockTree.leaves.has(genesisHash)).to.be.true;
            expect(blockTree.blocks.has(genesisHash)).to.be.true;
        });

        it('should use default options if not provided', function () {
            const defaultTree = new BlockTree(genesisHash);
            expect(defaultTree.blocks.max).to.equal(10000);
        });

        it('should use provided options', function () {
            const customTree = new BlockTree(genesisHash, { maxBlocks: 100, logLevel: 'debug' });
            expect(customTree.blocks.max).to.equal(100);
            expect(customTree.logger.level).to.equal('debug');
        });
    });

    describe('addBlock', function () {
        it('should add a block successfully', function () {
            const block = { hash: '0001', prevHash: genesisHash, height: 1, score: 1 };
            expect(blockTree.addBlock(block)).to.be.true;
            expect(blockTree.blocks.has('0001')).to.be.true;
            expect(blockTree.leaves.has('0001')).to.be.true;
            expect(blockTree.leaves.has(genesisHash)).to.be.false;
        });

        it('should not add duplicate blocks', function () {
            const block = { hash: '0001', prevHash: genesisHash, height: 1, score: 1 };
            expect(blockTree.addBlock(block)).to.be.true;
            expect(blockTree.addBlock(block)).to.be.false;
        });

        it('should handle orphan blocks', function () {
            const orphanBlock = { hash: '0002', prevHash: '0001', height: 2, score: 1 };
            expect(blockTree.addBlock(orphanBlock)).to.be.true;
            expect(blockTree.blocks.has('0002')).to.be.true;
            expect(blockTree.leaves.has('0002')).to.be.true;
        });

        it('should update subtree scores', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.addBlock({ hash: '0002', prevHash: '0001', height: 2, score: 2 });
            expect(blockTree.getBlockScore(genesisHash)).to.equal(3);
        });

        it('should handle LRU cache eviction', function () {
            for (let i = 1; i <= 6; i++) {
                blockTree.addBlock({ hash: `000${i}`, prevHash: genesisHash, height: 1, score: 1 });
            }
            expect(blockTree.blocks.has('0001')).to.be.false;
            expect(blockTree.blocks.has('0006')).to.be.true;
        });
    });

    describe('getHeaviestLeaf', function () {
        it('should return the leaf with highest subtree score', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.addBlock({ hash: '0002', prevHash: '0001', height: 2, score: 2 });
            blockTree.addBlock({ hash: '0003', prevHash: genesisHash, height: 1, score: 4 });
            expect(blockTree.getHeaviestLeaf()).to.equal('0003');
        });

        it('should return genesis hash if no other blocks', function () {
            expect(blockTree.getHeaviestLeaf()).to.equal(genesisHash);
        });
    });

    describe('getPath', function () {
        it('should return correct forward path between two blocks', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.addBlock({ hash: '0002', prevHash: '0001', height: 2, score: 1 });
            const path = blockTree.getPath(genesisHash, '0002');
            expect(path).to.deep.equal([genesisHash, '0001', '0002']);
        });

        it('should return correct backward path between two blocks', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.addBlock({ hash: '0002', prevHash: '0001', height: 2, score: 1 });
            const path = blockTree.getPath('0002', genesisHash);
            expect(path).to.deep.equal(['0002', '0001', genesisHash]);
        });

        it('should return null if no path exists', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            const path = blockTree.getPath('0002', '0003');
            expect(path).to.be.null;
        });

        it('should return a single-element array for same start and end', function () {
            const path = blockTree.getPath(genesisHash, genesisHash);
            expect(path).to.deep.equal([genesisHash]);
        });
    });

    describe('getCommonAncestor', function () {
        it('should find common ancestor of two blocks', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.addBlock({ hash: '0002', prevHash: '0001', height: 2, score: 1 });
            blockTree.addBlock({ hash: '0003', prevHash: '0001', height: 2, score: 1 });
            expect(blockTree.getCommonAncestor('0002', '0003')).to.equal('0001');
        });

        it('should return null if no common ancestor', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            expect(blockTree.getCommonAncestor('0001', '0002')).to.be.null;
        });

        it('should return the block itself if it is the common ancestor', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            expect(blockTree.getCommonAncestor('0001', '0001')).to.equal('0001');
        });
    });

    describe('isDescendant', function () {
        it('should correctly identify descendants', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.addBlock({ hash: '0002', prevHash: '0001', height: 2, score: 1 });
            expect(blockTree.isDescendant(genesisHash, '0002')).to.be.true;
            expect(blockTree.isDescendant('0002', genesisHash)).to.be.false;
        });

        it('should return false for non-existent blocks', function () {
            expect(blockTree.isDescendant('nonexistent', 'alsoNonexistent')).to.be.false;
        });

        it('should return true if block is descendant of itself', function () {
            expect(blockTree.isDescendant(genesisHash, genesisHash)).to.be.true;
        });
    });

    describe('getBlockHeight', function () {
        it('should return correct block height', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            expect(blockTree.getBlockHeight('0001')).to.equal(1);
            expect(blockTree.getBlockHeight('non-existent')).to.equal(-1);
        });
    });

    describe('getBlockScore', function () {
        it('should return correct block score', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 5 });
            expect(blockTree.getBlockScore('0001')).to.equal(5);
            expect(blockTree.getBlockScore('non-existent')).to.equal(0);
        });
    });

    describe('pruneOldBlocks', function () {
        it('should prune blocks below the given height', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.addBlock({ hash: '0002', prevHash: '0001', height: 2, score: 1 });
            blockTree.addBlock({ hash: '0003', prevHash: '0002', height: 3, score: 1 });
            blockTree.pruneOldBlocks(2);
            expect(blockTree.blocks.has(genesisHash)).to.be.false;
            expect(blockTree.blocks.has('0001')).to.be.false;
            expect(blockTree.blocks.has('0002')).to.be.true;
            expect(blockTree.blocks.has('0003')).to.be.true;
        });

        it('should update leaves after pruning', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.addBlock({ hash: '0002', prevHash: '0001', height: 2, score: 1 });
            blockTree.pruneOldBlocks(2);
            expect(blockTree.leaves.has(genesisHash)).to.be.false;
            expect(blockTree.leaves.has('0001')).to.be.false;
            expect(blockTree.leaves.has('0002')).to.be.true;
        });

        it('should not prune blocks if all are above threshold', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.pruneOldBlocks(0);
            expect(blockTree.blocks.has(genesisHash)).to.be.true;
            expect(blockTree.blocks.has('0001')).to.be.true;
        });
    });

    describe('setLogLevel', function () {
        it('should change the log level', function () {
            blockTree.setLogLevel('debug');
            expect(blockTree.logger.level).to.equal('debug');
        });
    });

    describe('logging', function () {
        let infoSpy, debugSpy;

        beforeEach(function () {
            infoSpy = sinon.spy(blockTree.logger, 'info');
            debugSpy = sinon.spy(blockTree.logger, 'debug');
        });

        it('should log when adding a block', function () {
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            expect(infoSpy.calledOnce).to.be.true;
            const loggedObject = infoSpy.firstCall.args[0];
            expect(loggedObject).to.include({ blockHash: '0001', height: 1 });
        });

        it('should log when pruning blocks', function () {
            console.log('Current log level:', blockTree.logger.level);

            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            blockTree.addBlock({ hash: '0002', prevHash: '0001', height: 2, score: 1 });
            blockTree.addBlock({ hash: '0003', prevHash: '0002', height: 3, score: 1 });

            infoSpy.resetHistory();
            debugSpy.resetHistory();

            console.log('Blocks before pruning:', Array.from(blockTree.blocks.keys()));

            blockTree.pruneOldBlocks(2);

            console.log('Blocks after pruning:', Array.from(blockTree.blocks.keys()));
            console.log('Info spy called:', infoSpy.called);
            console.log('Debug spy called:', debugSpy.called);

            if (infoSpy.called) {
                console.log('Info log args:', infoSpy.firstCall.args);
            }
            if (debugSpy.called) {
                console.log('Debug log args:', debugSpy.firstCall.args);
            }

            expect(infoSpy.called || debugSpy.called, 'Either info or debug log should be called').to.be.true;

            if (infoSpy.called) {
                const loggedObject = infoSpy.firstCall.args[0];
                expect(loggedObject).to.include({ heightThreshold: 2 });
            } else if (debugSpy.called) {
                const loggedObject = debugSpy.firstCall.args[0];
                expect(loggedObject).to.include({ heightThreshold: 2 });
            }
        });

        it('should not log when log level is set to silent', function () {
            blockTree.setLogLevel('silent');
            blockTree.addBlock({ hash: '0001', prevHash: genesisHash, height: 1, score: 1 });
            expect(infoSpy.called).to.be.false;
            expect(debugSpy.called).to.be.false;
        });
    });

});