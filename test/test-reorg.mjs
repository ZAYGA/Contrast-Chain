import { expect } from 'chai';
import { BlockTree } from '../src/block-tree.mjs';
import { ForkChoiceRule } from '../src/fork-rule.mjs';

describe('BlockTree and ForkChoiceRule', () => {
    let blockTree;
    let forkChoiceRule;

    beforeEach(() => {
        blockTree = new BlockTree('genesis');
        forkChoiceRule = new ForkChoiceRule(blockTree);
    });

    describe('BlockTree', () => {
        /**
         * Genesis Block Initialization Test
         *
         * In blockchain systems, the genesis block is the first block of the chain and serves
         * as the foundation for the entire blockchain. It's crucial to ensure that:
         * 1. The root of the tree is correctly set to the genesis block.
         * 2. The genesis block is initially the only leaf (tip) of the blockchain.
         * 3. The leaves set contains only the genesis block hash.
         *
         * This setup is essential for the proper functioning of the blockchain, as all subsequent
         * blocks will be built upon this initial state.
         */
        it('should initialize with a genesis block', () => {
            expect(blockTree.root).to.equal('genesis');
            expect(blockTree.leaves.size).to.equal(1);
            expect(blockTree.leaves.has('genesis')).to.be.true;
        });

        /**
         * Block Addition Test
         *
         * This test verifies the correct addition of new blocks to the blockchain. It ensures:
         * 1. New blocks are properly added to the block tree.
         * 2. The total number of blocks in the tree is accurate.
         * 3. The leaves (tips) of the blockchain are updated correctly.
         *
         * Proper block addition is fundamental to growing the blockchain and maintaining its
         * integrity. Each new block must be linked to its parent, and the tree structure must
         * be updated to reflect the new state of the chain.
         */
        it('should add blocks correctly', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2', prevHash: 'block1', height: 2, score: 1 });

            expect(blockTree.blocks.size).to.equal(3); // genesis + 2 new blocks
            expect(blockTree.leaves.size).to.equal(1);
            expect(blockTree.leaves.has('block2')).to.be.true;
        });

        /**
         * Fork Handling Test
         *
         * This test is crucial for blockchain systems that allow temporary forks. It verifies:
         * 1. The system can maintain multiple valid chain tips simultaneously.
         * 2. Forked blocks are correctly added to the tree.
         * 3. The leaves set accurately reflects all current chain tips.
         *
         * Fork handling is essential for dealing with:
         * - Network partitions
         * - Competing miners or validators
         * - Temporary coexistence of different protocol versions
         *
         * Proper fork management ensures the blockchain can resolve conflicts and converge
         * on a single, agreed-upon chain state.
         */
        it('should handle forks correctly', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 2 });

            expect(blockTree.leaves.size).to.equal(2);
            expect(blockTree.leaves.has('block2A')).to.be.true;
            expect(blockTree.leaves.has('block2B')).to.be.true;
        });

        /**
         * Subtree Score Calculation Test
         *
         * This test verifies the correct calculation of cumulative scores for each subtree. It's critical for:
         * 1. Determining the "best" chain in fork situations.
         * 2. Implementing consensus mechanisms based on cumulative difficulty or other metrics.
         *
         * The subtree score represents:
         * - In PoW: Cumulative work or difficulty
         * - In PoS: Cumulative stake weight
         * - In other systems: Any consensus-related cumulative metric
         *
         * Accurate subtree score calculation is fundamental for fork choice rules and
         * ensuring all nodes converge on the same chain state.
         */
        it('should calculate subtree scores correctly', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2', prevHash: 'block1', height: 2, score: 2 });

            const genesisNode = blockTree.blocks.get('genesis');
            const block1Node = blockTree.blocks.get('block1');
            const block2Node = blockTree.blocks.get('block2');

            expect(genesisNode.subtreeScore).to.equal(3); // 0 + 1 + 2
            expect(block1Node.subtreeScore).to.equal(3); // 1 + 2
            expect(block2Node.subtreeScore).to.equal(2);
        });

        /**
         * Heaviest Leaf Identification Test
         *
         * This test ensures the system can correctly identify the chain tip with the highest
         * cumulative score. It's crucial for:
         * 1. Implementing the "heaviest chain" rule in consensus mechanisms.
         * 2. Determining the current best chain when multiple forks exist.
         *
         * The heaviest leaf concept is analogous to:
         * - Bitcoin's "longest chain" rule
         * - Ethereum's "heaviest chain" rule
         *
         * Correctly identifying the heaviest leaf is essential for maintaining consensus
         * and determining the current accepted state of the blockchain.
         */
        it('should find the heaviest leaf correctly', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 2 });

            const heaviestLeaf = blockTree.getHeaviestLeaf();
            expect(heaviestLeaf).to.equal('block2B');
        });

        /**
         * Path Finding Test
         *
         * This test verifies the system's ability to find the correct path between two blocks.
         * It's important for:
         * 1. Traversing the blockchain for historical data retrieval.
         * 2. Calculating the blocks involved in a chain reorganization.
         *
         * Efficient path finding is crucial for:
         * - Block synchronization between nodes
         * - Implementing light clients
         * - Executing chain reorganizations
         *
         * Accurate path finding ensures that nodes can efficiently navigate the blockchain's
         * structure, which is essential for maintaining consensus and servicing queries.
         */
        it('should find the correct path between blocks', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block3', prevHash: 'block2', height: 3, score: 1 });

            const path = blockTree.getPath('genesis', 'block3');
            expect(path).to.deep.equal(['genesis', 'block1', 'block2', 'block3']);
        });

        /**
         * Common Ancestor Finding Test
         *
         * This test ensures the system can correctly identify the common ancestor of two blocks.
         * It's critical for:
         * 1. Determining the fork point in chain reorganizations.
         * 2. Calculating the least common ancestor in merge mining scenarios.
         *
         * Finding the common ancestor is crucial for:
         * - Efficient chain reorganizations
         * - Resolving conflicts between competing chains
         * - Implementing certain cross-chain protocols
         *
         * Accurate common ancestor identification is fundamental for maintaining blockchain
         * consistency and handling various fork scenarios.
         */
        it('should find the common ancestor correctly', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block3A', prevHash: 'block2A', height: 3, score: 1 });
            blockTree.addBlock({ hash: 'block3B', prevHash: 'block2B', height: 3, score: 1 });

            const commonAncestor = blockTree.getCommonAncestor('block3A', 'block3B');
            expect(commonAncestor).to.equal('block1');
        });
    });

    describe('ForkChoiceRule', () => {
        /**
         * Best Block Identification Test
         *
         * This test verifies that the fork choice rule correctly identifies the best block
         * according to the defined criteria (in this case, the highest score). It's crucial for:
         * 1. Implementing the core consensus mechanism of the blockchain.
         * 2. Ensuring all nodes converge on the same chain tip.
         *
         * The best block concept is fundamental to:
         * - Maintaining a consistent global state across the network
         * - Resolving temporary forks
         * - Determining the current accepted history of transactions
         *
         * Correct best block identification is essential for the overall consistency and
         * security of the blockchain network.
         */
        it('should find the best block correctly', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 2 });

            const bestBlock = forkChoiceRule.findBestBlock();
            expect(bestBlock).to.equal('block2B');
        });

        /**
         * Reorganization Decision Test (Higher Score)
         *
         * This test ensures the system correctly decides to reorganize when a new chain tip
         * has a higher score. It's critical for:
         * 1. Implementing the "heaviest chain" rule in consensus mechanisms.
         * 2. Ensuring the network converges on the chain with the most accumulated work/stake.
         *
         * Proper reorganization decisions are crucial for:
         * - Maintaining consensus across the network
         * - Resolving temporary forks
         * - Protecting against certain types of attacks (e.g., selfish mining)
         *
         * This mechanism is key to the self-healing nature of blockchain systems, allowing
         * them to recover from temporary inconsistencies and converge on a single, agreed-upon state.
         */
        it('should decide to reorganize when new tip has higher score', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 2 });

            const shouldReorg = forkChoiceRule.shouldReorg('block2A', 'block2B');
            expect(shouldReorg).to.be.true;
        });

        /**
         * Reorganization Decision Test (Lower Score)
         *
         * This test verifies that the system correctly decides not to reorganize when the
         * new chain tip has a lower score. It's important for:
         * 1. Maintaining stability in the face of competing chains.
         * 2. Preventing unnecessary reorganizations that could lead to inconsistencies.
         *
         * Avoiding unnecessary reorganizations is crucial for:
         * - Maintaining network stability
         * - Reducing the risk of double-spend attacks
         * - Minimizing computational overhead in processing competing chains
         *
         * This test ensures the system adheres to the principle of following the chain
         * with the most accumulated work/stake, which is fundamental to blockchain security.
         */
        it('should not reorganize when new tip has lower score', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 2 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 1 });

            const shouldReorg = forkChoiceRule.shouldReorg('block2A', 'block2B');
            expect(shouldReorg).to.be.false;
        });

        /**
         * Reorganization Decision Test (Equal Score, Higher Block)
         *
         * This test ensures the system prefers the chain with the higher block when scores
         * are equal. It's important for:
         * 1. Breaking ties in fork situations.
         * 2. Encouraging the growth of the longest chain.
         *
         * Preferring higher blocks in equal-score situations is crucial for:
         * - Ensuring deterministic behavior in fork resolution
         * - Incentivizing miners/validators to build on the latest blocks
         * - Reducing the likelihood of sustained forks
         *
         * This tiebreaker mechanism helps maintain a clear, unambiguous chain of blocks,
         * which is essential for network consensus and overall blockchain integrity.
         */
        it('should prefer higher block when scores are equal', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block3B', prevHash: 'block2B', height: 3, score: 1 });

            const shouldReorg = forkChoiceRule.shouldReorg('block2A', 'block3B');
            expect(shouldReorg).to.be.true;
        });

        /**
                 * Reorganization Path Calculation Test (continued)
                 *
                 * - Ensuring consistency in the blockchain state after reorganizations
                 *
                 * The reorg path includes two key components:
                 * 1. Revert: Blocks to be removed from the current chain
                 * 2. Apply: Blocks to be added from the new chain
                 *
                 * This information is critical for nodes to correctly update their local state
                 * and maintain consensus with the network.
                 */
        it('should calculate reorg path correctly', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block3A', prevHash: 'block2A', height: 3, score: 1 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 2 });
            blockTree.addBlock({ hash: 'block3B', prevHash: 'block2B', height: 3, score: 2 });

            const reorgPath = forkChoiceRule.getReorgPath('block3A', 'block3B');
            expect(reorgPath).to.deep.equal({
                revert: ['block3A', 'block2A'],
                apply: ['block2B', 'block3B']
            });
        });
    });

    describe('Complex scenarios', () => {
        /**
         * Deep Reorganization Test
         *
         * This test simulates a scenario where a significant portion of the blockchain
         * needs to be reorganized. It's critical for:
         * 1. Ensuring the system can handle major chain reorganizations.
         * 2. Verifying the correct behavior in extreme fork scenarios.
         *
         * Deep reorganizations can occur due to:
         * - Prolonged network partitions
         * - 51% attacks
         * - Significant differences in mining power or stake between competing chains
         *
         * Proper handling of deep reorganizations is crucial for:
         * - Maintaining network integrity and security
         * - Recovering from major network disruptions
         * - Ensuring the blockchain can self-heal from extreme inconsistencies
         *
         * This test verifies that the system can correctly identify the need for a deep
         * reorganization and calculate the correct path for this reorganization.
         */
        it('should handle a deep reorganization', () => {
            // Build a longer chain
            for (let i = 1; i <= 5; i++) {
                blockTree.addBlock({ hash: `block${i}A`, prevHash: i === 1 ? 'genesis' : `block${i - 1}A`, height: i, score: 1 });
            }

            // Build a competing chain with higher score
            for (let i = 1; i <= 6; i++) {
                blockTree.addBlock({ hash: `block${i}B`, prevHash: i === 1 ? 'genesis' : `block${i - 1}B`, height: i, score: 2 });
            }

            const shouldReorg = forkChoiceRule.shouldReorg('block5A', 'block6B');
            expect(shouldReorg).to.be.true;

            const reorgPath = forkChoiceRule.getReorgPath('block5A', 'block6B');
            expect(reorgPath.revert).to.deep.equal(['block5A', 'block4A', 'block3A', 'block2A', 'block1A']);
            expect(reorgPath.apply).to.deep.equal(['block1B', 'block2B', 'block3B', 'block4B', 'block5B', 'block6B']);
        });

        /**
         * Multiple Forks and Best Chain Selection Test
         *
         * This test simulates a complex scenario with multiple competing forks and ensures
         * the system can correctly identify the best chain. It's crucial for:
         * 1. Verifying the robustness of the fork choice rule in complex scenarios.
         * 2. Ensuring the system can navigate through multiple competing chains.
         *
         * Multiple fork scenarios can arise due to:
         * - Network latency and temporary partitions
         * - Presence of multiple mining pools or validator groups
         * - Deliberate attempts to create confusion in the network
         *
         * Correct handling of multiple forks is essential for:
         * - Maintaining a consistent global state across the network
         * - Preventing chain splits and ensuring eventual convergence
         * - Resisting certain types of attacks (e.g., balancing attack in PoS systems)
         *
         * This test verifies that even in a complex fork scenario, the system can:
         * 1. Identify the objectively best chain based on cumulative score
         * 2. Calculate the correct reorganization path to switch to this best chain
         */
        it('should handle multiple forks and find the best chain', () => {
            blockTree.addBlock({ hash: 'block1', prevHash: 'genesis', height: 1, score: 1 });
            blockTree.addBlock({ hash: 'block2A', prevHash: 'block1', height: 2, score: 1 });
            blockTree.addBlock({ hash: 'block2B', prevHash: 'block1', height: 2, score: 2 });
            blockTree.addBlock({ hash: 'block2C', prevHash: 'block1', height: 2, score: 3 });
            blockTree.addBlock({ hash: 'block3A', prevHash: 'block2A', height: 3, score: 2 });
            blockTree.addBlock({ hash: 'block3B', prevHash: 'block2B', height: 3, score: 1 });
            blockTree.addBlock({ hash: 'block3C', prevHash: 'block2C', height: 3, score: 1 });
            blockTree.addBlock({ hash: 'block4A', prevHash: 'block3A', height: 4, score: 3 });

            const bestBlock = forkChoiceRule.findBestBlock();
            expect(bestBlock).to.equal('block4A');

            const reorgPath = forkChoiceRule.getReorgPath('block3C', 'block4A');
            expect(reorgPath).to.deep.equal({
                revert: ['block3C', 'block2C'],
                apply: ['block2A', 'block3A', 'block4A']
            });
        });
    });
});