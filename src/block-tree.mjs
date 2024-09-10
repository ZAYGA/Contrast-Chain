import { LRUCache } from 'lru-cache';
import pino from 'pino';

/**
* @typedef {Object} TreeNode
* @property {string} hash
* @property {string} prevHash
* @property {number} height
* @property {number} score
*/

/**
 * @param {string} hash
 * @param {string} prevHash
 * @param {number} height
 * @param {number} score
 * @returns {TreeNode}
 */
const TreeNode = (hash, prevHash, height, score) => {
    return { hash, prevHash, height, score };
};

class BlockTree {
    constructor(genesisBlockHash, options = {}) {
        const {
            maxBlocks = 10000,
            logLevel = 'silent',
            logDestination = undefined  // undefined means log to console
        } = options;

        this.blocks = new LRUCache({ max: maxBlocks });
        this.root = genesisBlockHash;
        this.leaves = new Set([genesisBlockHash]);

        this.logger = pino({
            level: logLevel,
            transport: logDestination ? { target: 'pino-pretty', options: { destination: logDestination } } : undefined
        });


        // Initialize with genesis block
        this.addBlock({
            hash: genesisBlockHash,
            prevHash: null,
            height: 0,
            score: 0
        });
    }
    /** @param {TreeNode} block */
    addBlock(block) {

        if (block.hash === block.prevHash) {
            console.warn(`Rejected self-referencing block: ${block.hash}`);
            return false;
        }

        if (this.blocks.has(block.hash)) {
            this.logger.warn({ blockHash: block.hash }, 'Block already exists');
            return false;
        }

        this.logger.info({ blockHash: block.hash, height: block.height }, 'Adding block');

        const node = {
            block,
            children: new Set(),
            subtreeScore: block.score
        };

        this.blocks.set(block.hash, node);
        this.leaves.add(block.hash);

        if (!block.prevHash) { return true; } // Genesis block

        const parent = this.blocks.get(block.prevHash);
        if (parent) {
            parent.children.add(block.hash);
            this.leaves.delete(block.prevHash);
            this.#updateSubtreeScores(block.prevHash, block.score);
            this.logger.debug({
                blockHash: block.hash,
                parentHash: block.prevHash,
                score: block.score
            }, 'Block added as child');
        } else {
            this.logger.warn({
                blockHash: block.hash,
                parentHash: block.prevHash
            }, 'Parent block not found');
        }

        return true;
    }
    /**
     * @param {string} hash
     * @param {number} addedScore
     */
    #updateSubtreeScores(hash, addedScore) {
        let current = this.blocks.get(hash);
        while (current) {
            current.subtreeScore += addedScore;
            if (current.block.prevHash) {
                current = this.blocks.get(current.block.prevHash);
            } else {
                break;
            }
        }
    }

    /**
     * @param {string} fromHash
     * @param {string} toHash
     */
    getPath(fromHash, toHash) {
        this.logger.debug({ fromHash, toHash }, 'Finding path');

        /** @type {string[]} */
        const defaultPath = [fromHash];
        if (fromHash === toHash) { return defaultPath; }

        const forwardPath = this.#getForwardPath(fromHash, toHash);
        if (forwardPath) { return forwardPath; }

        const backwardPath = this.#getBackwardPath(fromHash, toHash);
        if (backwardPath) { return backwardPath; }

        this.logger.warn({ fromHash, toHash }, 'No path found');
        return null;
    }
    #getForwardPath(fromHash, toHash) {
        /** @type {string[]} */
        const path = [];
        let currentHash = toHash;

        while (currentHash !== fromHash) {
            const node = this.blocks.get(currentHash);
            if (!node) {
                return null;
            }
            path.unshift(currentHash);
            currentHash = node.block.prevHash;
            if (!currentHash) {
                return null;
            }
        }

        path.unshift(fromHash);
        this.logger.debug({ path }, 'Forward path found');
        return path;
    }
    #getBackwardPath(fromHash, toHash) {
        /** @type {string[]} */
        const path = [fromHash];
        let currentHash = fromHash;

        while (currentHash !== toHash) {
            const node = this.blocks.get(currentHash);
            if (!node) {
                return null;
            }
            currentHash = node.block.prevHash;
            if (!currentHash) {
                return null;
            }
            path.push(currentHash);
        }

        this.logger.debug({ path }, 'Backward path found');
        return path;
    }

    /**
     * @param {string} hash1
     * @param {string} hash2
     */
    getCommonAncestor(hash1, hash2) {
        const path1 = new Set();
        const current = { hash1, hash2 };

        while (current.hash1) {
            path1.add(current.hash1);
            current.hash1 = this.blocks.get(current.hash1)?.block.prevHash;
        }

        while (current.hash2) {
            if (path1.has(current.hash2)) {
                return current.hash2;
            }
            current.hash2 = this.blocks.get(current.hash2)?.block.prevHash;
        }

        return null; // No common ancestor found
    }
    getHeaviestLeaf() {
        this.logger.debug('Finding heaviest leaf');
        const heaviest = { leaf: null, score: -1 };

        for (const leaf of this.leaves) {
            const node = this.blocks.get(leaf);
            this.logger.trace({ leaf, score: node.subtreeScore }, 'Leaf score');

            if (node.subtreeScore > heaviest.score) {
                heaviest.score = node.subtreeScore;
                heaviest.leaf = leaf;
                this.logger.debug({ heaviestLeaf: heaviest.leaf, score: heaviest.score }, 'New heaviest leaf');
            }
        }

        return heaviest.leaf;
    }
    isDescendant(ancestorHash, descendantHash) {
        let current = this.blocks.get(descendantHash);
        while (current) {
            if (current.block.hash === ancestorHash) {
                return true;
            }
            current = this.blocks.get(current.block.prevHash);
        }
        return false;
    }

    getBlockHeight(hash) {
        return this.blocks.get(hash)?.block.height ?? -1;
    }
    getBlockScore(hash) {
        return this.blocks.get(hash)?.subtreeScore ?? 0;
    }

    /** @param {number} heightThreshold */
    pruneOldBlocks(heightThreshold) {
        this.logger.info({ heightThreshold }, 'Pruning blocks');
        const prunedHashes = [];

        for (const [hash, node] of this.blocks.entries()) {
            if (node.block.height < heightThreshold) {
                this.blocks.delete(hash);
                this.leaves.delete(hash);
                prunedHashes.push(hash);
                this.logger.debug({ blockHash: hash, height: node.block.height }, 'Pruned block');
            }
        }

        // Update children sets for remaining blocks
        for (const node of this.blocks.values()) {
            node.children = new Set([...node.children].filter(childHash => !prunedHashes.includes(childHash)));
        }

        this.logger.info({ prunedCount: prunedHashes.length }, 'Pruning completed');
    }

    setLogLevel(level) {
        this.logger.level = level;
    }
}

export { BlockTree, TreeNode };