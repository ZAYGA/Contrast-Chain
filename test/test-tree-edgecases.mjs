import { expect } from 'chai';
import { BlockTree } from '../src/block-tree.mjs';
import { ForkChoiceRule } from '../src/fork-rule.mjs';

describe('BlockTree and ForkChoiceRule - Additional Tests', () => {
    let blockTree;
    let forkChoiceRule;

    beforeEach(() => {
        blockTree = new BlockTree('genesis');
        forkChoiceRule = new ForkChoiceRule(blockTree);
    });

    describe('BlockTree - Edge Cases', () => {
        it('should reject a block that references itself as parent', () => {
            const selfReferencingBlock = { hash: 'selfRef', prevHash: 'selfRef', height: 1, score: 1 };
            const result = blockTree.addBlock(selfReferencingBlock);
            expect(result).to.be.false;
            expect(blockTree.blocks.has('selfRef')).to.be.false;
        });

        it('should reject a block creating a short cycle', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            const cyclicBlock = { hash: 'block2', prevHash: 'block2', height: 2, score: 1 };
            const result = blockTree.addBlock(cyclicBlock);
            expect(result).to.be.false;
            expect(blockTree.blocks.has('block2')).to.be.false;
        });

        it('should handle extremely long chains', () => {
            const chainLength = 10000;
            let prevHash = 'genesis';
            for (let i = 1; i <= chainLength; i++) {
                const hash = `block${i}`;
                blockTree.addBlock({ hash, prevHash, height: i, score: 1 });
                prevHash = hash;
            }
            expect(blockTree.blocks.size).to.equal(chainLength);
            expect(blockTree.getBlockHeight(`block${chainLength}`)).to.equal(chainLength);
        });
    });

    describe('BlockTree - Additional Functionalities', () => {
        it('should correctly prune old blocks', () => {
            for (let i = 1; i <= 5; i++) {
                blockTree.addBlock({ hash: `block${i}`, prevHash: i === 1 ? 'genesis' : `block${i - 1}`, height: i, score: 1 });
            }
            blockTree.pruneOldBlocks(3);
            expect(blockTree.blocks.has('genesis')).to.be.false;
            expect(blockTree.blocks.has('block1')).to.be.false;
            expect(blockTree.blocks.has('block2')).to.be.false;
            expect(blockTree.blocks.has('block3')).to.be.true;
            expect(blockTree.blocks.has('block4')).to.be.true;
            expect(blockTree.blocks.has('block5')).to.be.true;
        });

        it('should handle pruning when no blocks are old enough', () => {
            for (let i = 1; i <= 3; i++) {
                blockTree.addBlock({ hash: `block${i}`, prevHash: i === 1 ? 'genesis' : `block${i - 1}`, height: i, score: 1 });
            }
            blockTree.pruneOldBlocks(1);
            expect(blockTree.blocks.size).to.equal(3); //  3 blocks
        });
    });

    describe('ForkChoiceRule - Edge Cases', () => {
        it('should handle reorganization with equal scores but prefer longer chain', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block3B', prevHash: 'block2B', height: 3, score: 1 });

            const shouldReorg = forkChoiceRule.shouldReorg('block2A', 'block3B');
            expect(shouldReorg).to.be.true;
        });

        it('should not reorganize when new chain is longer but has lower score', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 10 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 10 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block3B', prevHash: 'block2B', height: 3, score: 1 });
            blockTree.addBlock({ hash: 'block4B', prevHash: 'block3B', height: 4, score: 1 });

            const shouldReorg = forkChoiceRule.shouldReorg('block2A', 'block4B');
            expect(shouldReorg).to.be.false;
        });
    });

    describe('ForkChoiceRule - Additional Functionalities', () => {
        it('should correctly identify the best block after a deep reorganization', () => {
            // Build initial chain
            for (let i = 1; i <= 5; i++) {
                blockTree.addBlock({ hash: `block${i}A`, prevHash: i === 1 ? 'genesis' : `block${i - 1}A`, height: i, score: 1 });
            }

            // Build competing chain with higher score
            for (let i = 1; i <= 6; i++) {
                blockTree.addBlock({ hash: `block${i}B`, prevHash: i === 1 ? 'genesis' : `block${i - 1}B`, height: i, score: 2 });
            }

            const bestBlock = forkChoiceRule.findBestBlock();
            expect(bestBlock).to.equal('block6B');
        });

        it('should handle reorganization when common ancestor is genesis', () => {
            blockTree.addBlock({ hash: 'block1A', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1A', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block1B', prevHash: 'genesis', height: 1, score: 2 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1B', height: 2, score: 2 });

            const reorgPath = forkChoiceRule.getReorgPath('block2A', 'block2B');
            expect(reorgPath).to.deep.equal({
                revert: ['block2A', 'block1A'],
                apply: ['block1B', 'block2B']
            });
        });
    });
});