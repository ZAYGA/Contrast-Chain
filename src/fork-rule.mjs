export class ForkChoiceRule {
    constructor(genesisBlockHash) {
        this.genesisBlockHash = genesisBlockHash;
    }

    findBestBlock(blockTree) {
        let bestBlock = this.genesisBlockHash;
        let bestScore = 0;
        let bestHeight = 0;

        for (const [blockHash, blockInfo] of blockTree) {
            const chainScore = this.calculateChainScore(blockTree, blockHash);
            const chainHeight = this.calculateChainHeight(blockTree, blockHash);

            if (chainScore > bestScore || (chainScore === bestScore && chainHeight > bestHeight)) {
                bestBlock = blockHash;
                bestScore = chainScore;
                bestHeight = chainHeight;
            }
        }

        console.log(`Best block found: ${bestBlock} with chain score ${bestScore} and height ${bestHeight}`);
        return bestBlock;
    }

    calculateChainScore(blockTree, blockHash) {
        let score = 0;
        let currentHash = blockHash;

        while (currentHash !== this.genesisBlockHash) {
            const blockInfo = blockTree.get(currentHash);
            if (!blockInfo) break;
            score += blockInfo.block.score;
            currentHash = blockInfo.block.previousHash;
        }

        return score;
    }

    calculateChainHeight(blockTree, blockHash) {
        let height = 0;
        let currentHash = blockHash;

        while (currentHash !== this.genesisBlockHash) {
            const blockInfo = blockTree.get(currentHash);
            if (!blockInfo) break;
            height++;
            currentHash = blockInfo.block.previousHash;
        }

        return height;
    }
}

export default ForkChoiceRule;