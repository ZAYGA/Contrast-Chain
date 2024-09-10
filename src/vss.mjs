import { HashFunctions } from "./conCrypto.mjs";
import { TransactionIO } from "./transaction.mjs";
import utils from "./utils.mjs";

/**
 * @typedef {Object} StakeReference
 * @property {string} address - Example: "WCHMD65Q7qR2uH9XF5dJ"
 * @property {string} anchor - Example: "0:bdadb7ab:0"
 */
/**
 * @param {string} address - Example: "WCHMD65Q7qR2uH9XF5dJ"
 * @param {string} anchor - Example: "0:bdadb7ab:0"
 * @returns {VssRange}
 */
const StakeReference = (address, anchor) => {
    return {
        address,
        anchor,
    };
}

export class spectrumFunctions {
    /** @param {spectrum} spectrum */
    static getHighestUpperBound(spectrum) {
        const keys = Object.keys(spectrum);
        if (keys.length === 0) { return 0; }

        keys.sort((a, b) => parseInt(a) - parseInt(b));
        
        return parseInt(keys[keys.length - 1]);
    }
    /** 
     * @param {spectrum} spectrum
     * @param {number} index - The index to search for
     */
    static getStakeReferenceFromIndex(spectrum, index) {
        const keys = Object.keys(spectrum);
        if (keys.length === 0) { return undefined; }

        keys.sort((a, b) => parseInt(a) - parseInt(b));
        
        for (let i = 0; i < keys.length; i++) {
            const key = parseInt(keys[i]);
            if (key >= index) {
                return spectrum[key];
            }
        }

        return undefined;
    }

    // LOTTERY FUNCTIONS
    /** Will return a number between 0 and maxRange from a blockHash - makes sure the result is unbiased
     * @param {string} blockData
     * @param {number} maxRange
     * @param {number} maxAttempts
     */
    static async hashToIntWithRejection(blockHash, lotteryRound = 0, maxRange = 1000000, maxAttempts = 1000) {

        let nonce = 0;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // Generate a hash including the nonce to get different results if needed
            const hash = await HashFunctions.SHA256(`${lotteryRound}${blockHash}${nonce}`);
            const hashInt = BigInt('0x' + hash);
    
            // Calculate the maximum acceptable range to avoid bias
            const maxAcceptableValue = BigInt(2**256 / maxRange) * BigInt(maxRange);
    
            if (hashInt < maxAcceptableValue) {
                return Number(hashInt % BigInt(maxRange));
            } else {
                nonce++; // Increment the nonce to try a new hash
            }
        }
    
        throw new Error("Max attempts reached. Consider increasing maxAttempts or revising the method.");
    }
}

export class Vss {
    constructor() {
        /** Validator Selection Spectrum (VSS)
         * - Can search key with number, will be converted to string.
         * @example { '100': { address: 'WCHMD65Q7qR2uH9XF5dJ', anchor: '0:bdadb7ab:0' } }
         * @type {Object<string, StakeReference | undefined>} */
        this.spectrum = {};
        /** @type {StakeReference[]} */
        this.legitimacies = [];
    }

    /**
     * @param {TransactionIO} UTXO
     * @param {number | undefined} upperBound
     */
    newStake(UTXO, upperBound) {
        const address = UTXO.address;
        const anchor = UTXO.anchor;
        const amount = UTXO.amount;
        
        if (upperBound) {
            
        } else {
            const lastUpperBound = spectrumFunctions.getHighestUpperBound(this.spectrum);
            // TODO: manage this case even if it's impossible to reach
            if (lastUpperBound + amount >= utils.SETTINGS.maxSupply) { throw new Error('VSS: Max supply reached.'); }
            this.spectrum[lastUpperBound + amount] = StakeReference(address, anchor);
        }
    }

    newStakes(UTXOs) {
        for (let i = 0; i < UTXOs.length; i++) {
            this.newStake(UTXOs[i]);
        }
    }

    /**
     * @param {spectrum} spectrum
     * @param {string} blockHash
     */
    async calculateRoundLegitimacies(blockHash, maxResultingArrayLength = 100) {
        /** @type {StakeReference[]} */
        const roundLegitimacies = [];
        const spectrumLength = Object.keys(this.spectrum).length;

        for (let i = 0; i < maxResultingArrayLength * 4; i++) {
            const maxRange = spectrumFunctions.getHighestUpperBound(this.spectrum);
            // everyone has considered 0 legimacy when not enough stakes
            if (maxRange < 999_999) { this.legitimacies = roundLegitimacies; return; }
            
            const winningNumber = await spectrumFunctions.hashToIntWithRejection(blockHash, i, maxRange);
            // can't be existing winner
            if (roundLegitimacies.find(stake => stake.anchor === spectrumFunctions.getStakeReferenceFromIndex(this.spectrum, winningNumber).anchor)) { continue; }

            roundLegitimacies.push(spectrumFunctions.getStakeReferenceFromIndex(this.spectrum, winningNumber));
            
            if (roundLegitimacies.length >= spectrumLength) { break; } // If all stakes have been selected
            if (roundLegitimacies.length >= maxResultingArrayLength) { break; } // If the array is full
        }

        this.legitimacies = roundLegitimacies;
    }
    /** @param {string} address */
    getAddressLegitimacy(address) {
        const legitimacy = this.legitimacies.findIndex(stakeReference => stakeReference.address === address);
        return legitimacy !== -1 ? legitimacy : this.legitimacies.length; // if not found, return last index + 1
    }
}