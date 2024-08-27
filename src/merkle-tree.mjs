
import crypto from 'crypto';

class MerkleTree {
    constructor() {
      this.leaves = [];
      this.tree = [];
    }
  
    // Hash a value using SHA-256
    hash(value) {
      return crypto.createHash('sha256').update(value).digest('hex');
    }
  
    // Insert a new leaf into the tree
    insert(leaf) {
      const hashedLeaf = this.hash(leaf);
      this.leaves.push(hashedLeaf);
      this.buildTree();
    }
  
    // Remove a leaf from the tree
    remove(leaf) {
      const hashedLeaf = this.hash(leaf);
      this.leaves = this.leaves.filter(l => l !== hashedLeaf);
      this.buildTree();
    }
  
    // Build the Merkle tree from the leaves
    buildTree() {
      let currentLevel = this.leaves;
      this.tree = [currentLevel];
  
      while (currentLevel.length > 1) {
        const nextLevel = [];
  
        for (let i = 0; i < currentLevel.length; i += 2) {
          const left = currentLevel[i];
          const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];
          const parentHash = this.hash(left + right);
          nextLevel.push(parentHash);
        }
  
        currentLevel = nextLevel;
        this.tree.push(currentLevel);
      }
    }
  
    // Get the root of the tree
    getRoot() {
      return this.tree.length ? this.tree[this.tree.length - 1][0] : null;
    }
  
    // Generate an inclusion proof for a given leaf
    generateInclusionProof(leaf) {
      const hashedLeaf = this.hash(leaf);
      let index = this.leaves.indexOf(hashedLeaf);
  
      if (index === -1) return null;
  
      const proof = [];
      let currentLevel = this.leaves;
  
      for (let level = 0; level < this.tree.length - 1; level++) {
        const isRightNode = index % 2 === 1;
        const siblingIndex = isRightNode ? index - 1 : index + 1;
  
        proof.push({
          sibling: currentLevel[siblingIndex] || currentLevel[index],
          direction: isRightNode ? 'left' : 'right'
        });
  
        index = Math.floor(index / 2);
        currentLevel = this.tree[level + 1];
      }
      console.log("Generated proof:", proof);
      return proof;
    }
  
    // Verify an inclusion proof
    async verifyInclusionProof(leaf, proof, root) {
      let computedHash = this.hash(leaf);
      console.log("Computed hash:", computedHash);
      for (const { sibling, direction } of proof) {
        if (direction === 'left') {
          computedHash = this.hash(sibling + computedHash);
        } else {
          computedHash = this.hash(computedHash + sibling);
        }
      }
      console.log("Computed root:", computedHash);
      console.log("Expected root:", root);
      let isValid = computedHash === root;
      console.log("Is valid:", isValid);
      return isValid;
    }
  }

  export default MerkleTree;