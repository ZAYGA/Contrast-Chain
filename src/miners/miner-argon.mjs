import argon2 from 'argon2';
import { Miner } from '../miner.mjs';

class ArgonMiner extends Miner {
    constructor(difficulty = 1) {
        super(difficulty);
        this.miningParams = {
            argon2: {
                time: 2,
                mem: 2**18,
                parallelism: 1,
                type: 2,
                hashLen: 32,
            },
            nonceLength: 4,
        };
        this.fixedSalt = Buffer.from('FixedSaltForMining'); // Fixed salt for deterministic results
    }

    async isValidProof(block, nonce) {
        const hash = await this.calculateHash(block.index, block.previousHash, block.timestamp, block.data, nonce);
        console.log('Hash:', hash);
        console.log('Difficulty:', this.difficulty);

        const hashBits = this.hexToBinary(hash);
        
        try {
            this.verifyBlockHashConformToDifficulty(hashBits, this.difficulty);
            console.log('isValid: true');
            return true;
        } catch (error) {
            console.log('isValid: false');
            console.log('Reason:', error.message);
            return false;
        }
    }

    async calculateHash(index, previousHash, timestamp, data, nonce) {
        const content = `${index}${previousHash}${timestamp}${data}${nonce}`;
        
        const { time, mem, parallelism, type, hashLen } = this.miningParams.argon2;
        
        const hash = await argon2.hash(content, {
            type: argon2.argon2id,
            memoryCost: mem,
            timeCost: time,
            parallelism: parallelism,
            hashLength: hashLen,
            salt: this.fixedSalt,
            raw: true
        });

        const hexHash = Buffer.from(hash).toString('hex');
        return hexHash;
    }

    generateRandomNonce() {
        const Uint8 = new Uint8Array(this.miningParams.nonceLength);
        crypto.getRandomValues(Uint8);
        return Array.from(Uint8).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async mine(block) {
        let nonce = this.generateRandomNonce();
        while (!(await this.isValidProof(block, nonce))) {
            nonce = this.generateRandomNonce();
        }
        return nonce;
    }

    getDiffAndAdjust(difficulty) {
        const zeros = Math.floor(difficulty / 16);
        const adjust = difficulty % 16;
        return { zeros, adjust };
    }

    verifyBlockHashConformToDifficulty(hashBitsAsString, difficulty) {
        if (typeof hashBitsAsString !== 'string') { throw new Error('Invalid hashBitsAsString'); }
        if (typeof difficulty !== 'number') { throw new Error('Invalid difficulty type'); }

        if (difficulty < 1) { throw new Error('Invalid difficulty < 1'); }
        if (difficulty > hashBitsAsString.length) { throw new Error('Invalid difficulty > hashBitsAsString.length'); }

        const { zeros, adjust } = this.getDiffAndAdjust(difficulty);
    
        const condition1 = this.binaryStringStartsWithZeros(hashBitsAsString, zeros);
        if (!condition1) { throw new Error(`unlucky--(condition 1)=> hash does not start with ${zeros} zeros`); }
        
        const next5Bits = hashBitsAsString.substring(zeros, zeros + 5);
        const condition2 = this.binaryStringSupOrEqual(next5Bits, adjust);
        if (!condition2) { throw new Error(`unlucky--(condition 2)=> hash does not meet the condition: ${next5Bits} >= ${adjust}`); }
    }

    binaryStringStartsWithZeros(string, zeros) {
        if (typeof string !== 'string') { return false; }
        if (typeof zeros !== 'number') { return false; }
        if (zeros < 0) { return false; }

        const target = '0'.repeat(zeros);
        return string.startsWith(target);
    }

    binaryStringSupOrEqual(string, minValue) {
        if (typeof string !== 'string') { return false; }
        if (typeof minValue !== 'number') { return false; }
        if (minValue < 0) { return false; }

        const intValue = parseInt(string, 2);
        return intValue >= minValue;
    }

    hexToBinary(hex) {
        let binary = '';
        for (let i = 0; i < hex.length; i++) {
            binary += parseInt(hex[i], 16).toString(2).padStart(4, '0');
        }
        return binary;
    }
}

export { ArgonMiner };