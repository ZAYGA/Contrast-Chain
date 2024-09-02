export class ForkChoiceRule {
    constructor(blockTree) {
        this.blockTree = blockTree;
    }

    findBestBlock() {
        return this.blockTree.getHeaviestLeaf();
    }

    shouldReorg(currentTip, newTip) {
        const commonAncestor = this.blockTree.getCommonAncestor(currentTip, newTip);
        if (!commonAncestor) return false;

        const currentTipScore = this.blockTree.getBlockScore(currentTip);
        const newTipScore = this.blockTree.getBlockScore(newTip);

        if (newTipScore > currentTipScore) {
            return true;
        } else if (newTipScore === currentTipScore) {
            return this.blockTree.getBlockHeight(newTip) > this.blockTree.getBlockHeight(currentTip);
        }

        return false;
    }

    getReorgPath(currentTip, newTip) {
        const commonAncestor = this.blockTree.getCommonAncestor(currentTip, newTip);
        if (!commonAncestor) {
            return null;
        }

        const revertPath = this.blockTree.getPath(currentTip, commonAncestor);
        const applyPath = this.blockTree.getPath(commonAncestor, newTip);

        if (!revertPath || !applyPath) {
            return null;
        }

        return {
            revert: revertPath.slice(0, -1), // Exclude common ancestor
            apply: applyPath.slice(1) // Exclude common ancestor
        };
    }
}